import { access, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

import type { ConfigValue, Issue, RuntimeProject } from "@oh-my-bug/core";
import type {
  BranchInfo,
  ModuleStateStore,
  WorkspaceBranchDiscovery,
  WorkspaceProvider,
  WorkspaceProviderFactory,
  WorkspaceProviderInspection,
} from "@oh-my-bug/module-api";
import { z } from "zod";

import { gitRefExists, runGit, tryRunGit } from "./git-client.js";

const MODULE_ID = "workspace-git";

const currentGitWorkspaceConfigSchema = z.object({
  baseBranch: z.string().trim().min(1),
  pushToRemote: z.boolean(),
  remote: z.string().trim().min(1).optional(),
}).strict().refine(
  (value) => !value.pushToRemote || Boolean(value.remote),
  { message: "GIT_REMOTE_REQUIRED" },
);

const legacyGitWorkspaceConfigSchema = z.object({
  baseBranch: z.string().trim().min(1),
  delivery: z.enum(["local", "remote"]),
  remote: z.string().trim().min(1).optional(),
}).strict().refine(
  (value) => value.delivery === "local" || Boolean(value.remote),
  { message: "GIT_REMOTE_REQUIRED" },
);

interface GitWorkspaceConfig {
  baseBranch: string;
  pushToRemote: boolean;
  remote?: string;
}

export interface GitWorkspaceState {
  issueId: string;
  repositoryPath: string;
  projectRelativePath: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  pushToRemote?: boolean;
  /** Persisted before remote publication became a Boolean capability. */
  delivery?: "local" | "remote";
  remote?: string;
  remoteUrl?: string;
  branchInfo?: BranchInfo;
}

export interface GitWorkspaceFactoryOptions {
  state: ModuleStateStore;
  worktreeRoot: string;
}

interface GitProjectContext {
  repositoryPath: string;
  remote?: { name: string; url: string };
  remoteUnavailableReason?: string;
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
          key: "pushToRemote",
          type: "boolean",
          label: "完成后推送到远程",
          required: true,
          defaultValue: false,
        },
      ],
    },
    inspectProject(projectPath) {
      return inspectGitProject(projectPath);
    },
    inspectProjectBranches(projectPath, input) {
      return inspectGitProjectBranches(projectPath, input);
    },
    validate(config) {
      parseConfiguration(config);
    },
    async validateProjectConfiguration(projectPath, config) {
      const parsed = parseConfiguration(config);
      const repositoryPath = await runGit(projectPath, ["rev-parse", "--show-toplevel"]);
      await runGit(repositoryPath, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${parsed.baseBranch}^{commit}`,
      ]);
    },
    create(config) {
      return new GitWorkspaceProvider(options, structuredClone(config));
    },
  };
}

export async function inspectGitProject(
  projectPath: string,
): Promise<WorkspaceProviderInspection> {
  const context = await readGitProjectContext(projectPath);
  if (!context) {
    return { available: false, reason: "所选目录不在 Git 仓库中" };
  }
  const branches = await discoverGitProjectBranches(context, { refreshRemote: false });

  if (!context.remote) {
    const reason = context.remoteUnavailableReason!;
    return {
      available: true,
      fields: { pushToRemote: { enabled: false, reason } },
      properties: [],
      branches,
    };
  }

  return {
    available: true,
    configPatch: { remote: context.remote.name },
    fields: { pushToRemote: { enabled: true } },
    properties: [{
      key: "remoteUrl",
      label: "远程仓库",
      value: context.remote.url,
      description: `Git remote: ${context.remote.name}`,
    }],
    branches,
  };
}

async function inspectGitProjectBranches(
  projectPath: string,
  input: { refreshRemote: boolean },
): Promise<WorkspaceBranchDiscovery> {
  const context = await readGitProjectContext(projectPath);
  if (!context) throw new Error("WORKSPACE_GIT_NOT_AVAILABLE");
  return discoverGitProjectBranches(context, input);
}

async function discoverGitProjectBranches(
  context: GitProjectContext,
  input: { refreshRemote: boolean },
): Promise<WorkspaceBranchDiscovery> {
  const localBranches = await listRefs(context.repositoryPath, "refs/heads");
  let refreshError: string | undefined;
  if (input.refreshRemote && context.remote) {
    try {
      await runGit(context.repositoryPath, ["fetch", "--prune", context.remote.name]);
    } catch (error) {
      refreshError = error instanceof Error ? error.message : "GIT_COMMAND_FAILED:fetch";
    }
  }
  const remoteBranches = context.remote
    ? (await listRefs(context.repositoryPath, `refs/remotes/${context.remote.name}`))
        .filter((ref) => ref !== `${context.remote!.name}/HEAD`)
    : [];
  return {
    localBranches,
    remoteBranches,
    ...(context.remote ? { remote: context.remote } : {}),
    ...(context.remoteUnavailableReason
      ? { remoteUnavailableReason: context.remoteUnavailableReason }
      : {}),
    ...(refreshError ? { refreshError } : {}),
  };
}

async function readGitProjectContext(
  projectPath: string,
): Promise<GitProjectContext | undefined> {
  const repositoryPath = await tryRunGit(
    projectPath,
    ["rev-parse", "--show-toplevel"],
    [128],
  );
  if (!repositoryPath) return undefined;
  const remotes = (await runGit(repositoryPath, ["remote"]))
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const branch = await runGit(repositoryPath, ["branch", "--show-current"]);
  const tracked = branch
    ? await tryRunGit(repositoryPath, ["config", "--get", `branch.${branch}.remote`])
    : undefined;
  const name = tracked && tracked !== "." && remotes.includes(tracked)
    ? tracked
    : remotes.includes("origin")
      ? "origin"
      : remotes.length === 1
        ? remotes[0]
        : undefined;
  if (!name) {
    return {
      repositoryPath,
      remoteUnavailableReason: remotes.length === 0
        ? "当前 Git 仓库未配置远程仓库"
        : "当前 Git 仓库有多个远程仓库，且未配置默认上游",
    };
  }
  return {
    repositoryPath,
    remote: {
      name,
      url: await runGit(repositoryPath, ["remote", "get-url", name]),
    },
  };
}

async function listRefs(repositoryPath: string, prefix: string): Promise<string[]> {
  const displayPrefix = prefix.startsWith("refs/remotes/") ? "refs/remotes" : prefix;
  const output = await runGit(repositoryPath, [
    "for-each-ref",
    "--format=%(refname)",
    prefix,
  ]);
  return output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.startsWith(`${displayPrefix}/`)
      ? value.slice(displayPrefix.length + 1)
      : value)
    .sort();
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

    const remoteUrl = configuration.pushToRemote
      ? await tryRunGit(
          repositoryPath,
          ["remote", "get-url", configuration.remote!],
          [2],
        )
      : undefined;
    const state: GitWorkspaceState = {
      issueId: input.issue.id,
      repositoryPath,
      projectRelativePath,
      worktreePath,
      branch,
      baseBranch: configuration.baseBranch,
      baseCommit,
      pushToRemote: configuration.pushToRemote,
      ...(configuration.remote ? { remote: configuration.remote } : {}),
      ...(remoteUrl ? { remoteUrl } : {}),
    };
    this.options.state.set(MODULE_ID, resourceId, state);
    return { projectPath: join(worktreePath, projectRelativePath), resourceId };
  }

  async describe(input: {
    issue: Issue;
    resourceId: string;
  }): Promise<{ branch: string }> {
    const state = this.getSavedState(input.issue, input.resourceId);
    return { branch: state.branch };
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
    const pushToRemote = shouldPushToRemote(state);
    if (pushToRemote) {
      await runGit(state.worktreePath, [
        "push",
        state.remote!,
        `refs/heads/${state.branch}:refs/heads/${state.branch}`,
      ]);
    }

    const branchInfo: BranchInfo = {
      name: state.branch,
      commit,
      ...(pushToRemote ? { remote: state.remote } : {}),
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
  const current = currentGitWorkspaceConfigSchema.safeParse(config);
  if (current.success) return current.data;
  const legacy = legacyGitWorkspaceConfigSchema.safeParse(config);
  if (legacy.success) {
    return {
      baseBranch: legacy.data.baseBranch,
      pushToRemote: legacy.data.delivery === "remote",
      ...(legacy.data.remote ? { remote: legacy.data.remote } : {}),
    };
  }
  if (
    current.error.issues.some((issue) => issue.message === "GIT_REMOTE_REQUIRED") ||
    legacy.error.issues.some((issue) => issue.message === "GIT_REMOTE_REQUIRED")
  ) {
    throw new Error("GIT_REMOTE_REQUIRED");
  }
  throw new Error("GIT_WORKSPACE_CONFIG_INVALID", {
    cause: new AggregateError([current.error, legacy.error]),
  });
}

function shouldPushToRemote(state: GitWorkspaceState): boolean {
  return state.pushToRemote ?? state.delivery === "remote";
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
