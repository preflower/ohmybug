import { access, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

import type { ConfigValue, Issue, RuntimeProject } from "@oh-my-bug/core";
import type {
  BranchInfo,
  ModuleStateStore,
  WorkspaceProvider,
  WorkspaceProviderFactory,
  WorkspaceProviderInspection,
} from "@oh-my-bug/module-api";
import { z } from "zod";

import { gitRefExists, runGit, tryRunGit } from "./git-client.js";

const MODULE_ID = "workspace-git";

const gitWorkspaceConfigSchema = z.object({
  baseBranch: z.string().trim().min(1),
  delivery: z.enum(["local", "remote"]),
  remote: z.string().trim().min(1).optional(),
}).strict().refine(
  (value) => value.delivery === "local" || Boolean(value.remote),
  { message: "GIT_REMOTE_REQUIRED" },
);

type GitWorkspaceConfig = z.infer<typeof gitWorkspaceConfigSchema>;

export interface GitWorkspaceState {
  issueId: string;
  repositoryPath: string;
  projectRelativePath: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  delivery: "local" | "remote";
  remote?: string;
  branchInfo?: BranchInfo;
}

export interface GitWorkspaceFactoryOptions {
  state: ModuleStateStore;
  worktreeRoot: string;
}

export function gitWorkspaceFactory(
  options: GitWorkspaceFactoryOptions,
): WorkspaceProviderFactory {
  return {
    id: "git",
    manifest: {
      id: "git",
      name: "Git Worktree",
      configFields: [
        {
          key: "baseBranch",
          type: "string",
          label: "基线分支",
          required: true,
          defaultValue: "main",
        },
        {
          key: "delivery",
          type: "string",
          label: "交付方式",
          required: true,
          defaultValue: "local",
        },
        {
          key: "remote",
          type: "string",
          label: "远程仓库",
          required: false,
          defaultValue: "origin",
        },
      ],
    },
    inspectProject(projectPath) {
      return inspectGitProject(projectPath);
    },
    validate(config) {
      parseConfiguration(config);
    },
    create(config) {
      return new GitWorkspaceProvider(options, structuredClone(config));
    },
  };
}

export async function inspectGitProject(
  projectPath: string,
): Promise<WorkspaceProviderInspection> {
  const repositoryPath = await tryRunGit(
    projectPath,
    ["rev-parse", "--show-toplevel"],
    [128],
  );
  if (!repositoryPath) {
    return { available: false, reason: "所选目录不在 Git 仓库中" };
  }

  const remoteOutput = await runGit(repositoryPath, ["remote"]);
  const remotes = remoteOutput.split(/\r?\n/).map((remote) => remote.trim()).filter(Boolean);
  const branch = await runGit(repositoryPath, ["branch", "--show-current"]);
  const branchRemote = branch
    ? await tryRunGit(repositoryPath, ["config", "--get", `branch.${branch}.remote`])
    : undefined;
  const remoteName = branchRemote && branchRemote !== "." && remotes.includes(branchRemote)
    ? branchRemote
    : remotes.includes("origin")
      ? "origin"
      : remotes.length === 1
        ? remotes[0]
        : undefined;

  if (!remoteName) {
    const reason = remotes.length === 0
      ? "当前 Git 仓库未配置远程仓库"
      : "当前 Git 仓库有多个远程仓库，且未配置默认上游";
    return {
      available: true,
      fields: { pushToRemote: { enabled: false, reason } },
      properties: [],
    };
  }

  const remoteUrl = await runGit(repositoryPath, ["remote", "get-url", remoteName]);
  return {
    available: true,
    configPatch: { remote: remoteName },
    fields: { pushToRemote: { enabled: true } },
    properties: [{
      key: "remoteUrl",
      label: "远程仓库",
      value: remoteUrl,
      description: `Git remote: ${remoteName}`,
    }],
  };
}

class GitWorkspaceProvider implements WorkspaceProvider {
  readonly id = "git";

  constructor(
    private readonly options: GitWorkspaceFactoryOptions,
    private readonly rawConfiguration: Record<string, ConfigValue>,
  ) {}

  async acquire(input: { issue: Issue; project: RuntimeProject }): Promise<{
    projectPath: string;
    resourceId: string;
  }> {
    const resourceId = `git:${input.issue.id}`;
    const saved = this.options.state.get<GitWorkspaceState>(MODULE_ID, resourceId);
    if (saved) {
      assertSavedState(saved, input.issue, resourceId);
      await this.restoreWorktree(saved);
      return {
        projectPath: join(saved.worktreePath, saved.projectRelativePath),
        resourceId,
      };
    }

    const configuration = parseConfiguration(this.rawConfiguration);
    const projectPath = await realpath(input.project.path);
    const repositoryPath = await realpath(await runGit(projectPath, [
      "rev-parse",
      "--show-toplevel",
    ]));
    const projectRelativePath = relative(repositoryPath, projectPath);
    if (
      isAbsolute(projectRelativePath) ||
      projectRelativePath.split(/[\\/]/)[0] === ".."
    ) {
      throw new Error("PROJECT_OUTSIDE_GIT_REPOSITORY");
    }
    const baseCommit = await runGit(repositoryPath, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${configuration.baseBranch}^{commit}`,
    ]);
    const branch = `ohmybug/${input.issue.identifier.toLowerCase()}`;
    const worktreePath = join(
      this.options.worktreeRoot,
      input.project.id,
      input.issue.id,
    );
    await mkdir(join(this.options.worktreeRoot, input.project.id), { recursive: true });
    if (await gitRefExists(repositoryPath, `refs/heads/${branch}`)) {
      await runGit(repositoryPath, ["worktree", "prune"]);
      await runGit(repositoryPath, ["worktree", "add", worktreePath, branch]);
    } else {
      await runGit(repositoryPath, ["worktree", "add", "-b", branch, worktreePath, baseCommit]);
    }

    const state: GitWorkspaceState = {
      issueId: input.issue.id,
      repositoryPath,
      projectRelativePath,
      worktreePath,
      branch,
      baseBranch: configuration.baseBranch,
      baseCommit,
      delivery: configuration.delivery,
      ...(configuration.remote ? { remote: configuration.remote } : {}),
    };
    this.options.state.set(MODULE_ID, resourceId, state);
    return { projectPath: join(worktreePath, projectRelativePath), resourceId };
  }

  async publish(input: {
    issue: Issue;
    resourceId: string;
  }): Promise<BranchInfo> {
    const state = this.getSavedState(input.issue, input.resourceId);
    if (state.branchInfo) return state.branchInfo;
    if (input.issue.status !== "APPROVED") {
      throw new Error("GIT_WORKSPACE_NOT_APPROVED");
    }

    const changes = await runGit(state.worktreePath, ["status", "--porcelain"]);
    if (changes) {
      await runGit(state.worktreePath, ["add", "-A"]);
      await runGit(state.worktreePath, [
        "commit",
        "-m",
        `${input.issue.identifier}: ${input.issue.title}`,
      ]);
    }
    const commit = await runGit(state.worktreePath, ["rev-parse", "HEAD"]);
    if (state.delivery === "remote") {
      await runGit(state.worktreePath, [
        "push",
        state.remote!,
        `refs/heads/${state.branch}:refs/heads/${state.branch}`,
      ]);
    }

    const branchInfo: BranchInfo = {
      name: state.branch,
      commit,
      ...(state.delivery === "remote" ? { remote: state.remote } : {}),
    };
    this.options.state.set(MODULE_ID, input.resourceId, {
      ...state,
      branchInfo,
    });
    return branchInfo;
  }

  async release(input: { issue: Issue; resourceId: string }): Promise<void> {
    const state = this.getSavedState(input.issue, input.resourceId);
    if (!(await pathExists(state.worktreePath))) {
      await runGit(state.repositoryPath, ["worktree", "prune"]);
      return;
    }
    await runGit(state.repositoryPath, ["worktree", "remove", state.worktreePath]);
  }

  private async restoreWorktree(state: GitWorkspaceState): Promise<void> {
    if (await pathExists(state.worktreePath)) return;
    await mkdir(dirname(state.worktreePath), { recursive: true });
    await runGit(state.repositoryPath, ["worktree", "prune"]);
    await runGit(state.repositoryPath, [
      "worktree",
      "add",
      state.worktreePath,
      state.branch,
    ]);
  }

  private getSavedState(issue: Issue, resourceId: string): GitWorkspaceState {
    const state = this.options.state.get<GitWorkspaceState>(MODULE_ID, resourceId);
    if (!state) throw new Error("GIT_WORKSPACE_STATE_NOT_FOUND");
    assertSavedState(state, issue, resourceId);
    return state;
  }
}

function parseConfiguration(config: Record<string, ConfigValue>): GitWorkspaceConfig {
  const parsed = gitWorkspaceConfigSchema.safeParse(config);
  if (parsed.success) return parsed.data;
  if (parsed.error.issues.some((issue) => issue.message === "GIT_REMOTE_REQUIRED")) {
    throw new Error("GIT_REMOTE_REQUIRED");
  }
  throw new Error("GIT_WORKSPACE_CONFIG_INVALID", { cause: parsed.error });
}

function assertSavedState(
  state: GitWorkspaceState,
  issue: Issue,
  resourceId: string,
): void {
  if (state.issueId !== issue.id || resourceId !== `git:${state.issueId}`) {
    throw new Error("GIT_WORKSPACE_STATE_MISMATCH");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
