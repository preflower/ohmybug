import { access, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

import type {
  ConfigValue,
  FinalizationRecoveryResult,
  Issue,
  RepairResult,
  RuntimeProject,
  WorkspaceFinalizationDiagnostic,
  WorkspaceFinalizationStep,
} from "@oh-my-bug/core";
import type {
  BranchInfo,
  ModuleStateStore,
  WorkspaceBranchDiscovery,
  WorkspaceFinalizationRecoveryContext,
  WorkspaceFinalizationRecoveryValidation,
  WorkspaceProvider,
  WorkspaceProviderFactory,
  WorkspaceProviderInspection,
  WorkspaceRepairObservation,
} from "@oh-my-bug/module-api";
import { z } from "zod";

import { GitCommandError, gitRefExists, runGit, tryRunGit } from "./git-client.js";
import {
  GitAutomaticMergeConflictError,
  finalizeGitMergeRecovery,
  normalizeGitFinalizationRecoveryState,
  parseMergeTreeConflictOutput,
  prepareGitMergeRecovery,
  validateGitMergeRecovery,
  type GitFinalizationRecoveryState,
  type GitMergeFailureRecord,
} from "./merge-recovery.js";
import {
  assertPublicationPreflight,
  finalizationError,
  prepareGitFinalizationRecovery,
  readGitWorkspaceStatus,
  validateGitFinalizationRecovery,
  type GitFinalizationFingerprint,
} from "./finalization-recovery.js";
import {
  assertInitializedSubmodulesClean,
  assertNoHiddenIndexEntries,
  assertNoUndeclaredGitlinks,
  assertWorktreeAndSubmodulesClean,
  observeGitRepair,
  validateGitRepair,
} from "./repair-integration.js";

const MODULE_ID = "workspace-git";

const currentGitWorkspaceConfigSchema = z.object({
  baseBranch: z.string().trim().min(1),
  pushToRemote: z.boolean(),
  mergeToBaseBranch: z.boolean().default(false),
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
  mergeToBaseBranch: boolean;
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
  mergeToBaseBranch?: boolean;
  /** Persisted before remote publication became a Boolean capability. */
  delivery?: "local" | "remote";
  remote?: string;
  remoteUrl?: string;
  branchInfo?: BranchInfo;
  lastMergeFailure?: GitMergeFailureRecord;
  finalizationRecovery?: GitFinalizationRecoveryState | GitFinalizationFingerprint;
}

export interface GitWorkspaceFactoryOptions {
  state: ModuleStateStore;
  worktreeRoot: string;
}

interface GitProjectContext {
  repositoryPath: string;
  fetchRemote?: { name: string; url: string };
  publicationRemotes: Array<{ name: string; url: string }>;
  fetchUnavailableReason?: string;
}

const FETCH_TIMEOUT_MS = 15_000;

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
        {
          key: "mergeToBaseBranch",
          type: "boolean",
          label: "完成后合并到基线分支",
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
      if (parsed.pushToRemote) {
        await runGit(repositoryPath, ["remote", "get-url", parsed.remote!]);
      }
      if (
        parsed.mergeToBaseBranch &&
        !(await gitRefExists(repositoryPath, `refs/heads/${parsed.baseBranch}`))
      ) {
        throw new Error("GIT_AUTO_MERGE_REQUIRES_LOCAL_BASE_BRANCH");
      }
      if (parsed.mergeToBaseBranch) {
        await assertGitSupportsAutomaticMerge(repositoryPath);
      }
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

  if (!context.fetchRemote) {
    const reason = context.fetchUnavailableReason!;
    return {
      available: true,
      fields: { pushToRemote: { enabled: false, reason } },
      properties: [],
      branches,
    };
  }

  return {
    available: true,
    configPatch: { remote: context.fetchRemote.name },
    fields: { pushToRemote: { enabled: true } },
    properties: [{
      key: "remoteUrl",
      label: "远程仓库",
      value: context.fetchRemote.url,
      description: `Git remote: ${context.fetchRemote.name}`,
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
  if (input.refreshRemote && context.fetchRemote) {
    try {
      await runGit(
        context.repositoryPath,
        ["fetch", "--prune", context.fetchRemote.name],
        { nonInteractive: true, timeoutMs: FETCH_TIMEOUT_MS },
      );
    } catch (error) {
      refreshError = error instanceof Error ? error.message : "GIT_COMMAND_FAILED:fetch";
    }
  }
  const remoteBranches = context.fetchRemote
    ? (await listRefs(context.repositoryPath, `refs/remotes/${context.fetchRemote.name}`))
        .filter((ref) => ref !== `${context.fetchRemote!.name}/HEAD`)
    : [];
  return {
    localBranches,
    remoteBranches,
    publicationRemotes: context.publicationRemotes,
    ...(context.fetchRemote ? { fetchRemote: context.fetchRemote } : {}),
    ...(context.fetchUnavailableReason
      ? { fetchUnavailableReason: context.fetchUnavailableReason }
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
  const publicationRemotes = await Promise.all(remotes.map(async (name) => ({
    name,
    url: await runGit(repositoryPath, ["remote", "get-url", name]),
  })));
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
      publicationRemotes,
      fetchUnavailableReason: remotes.length === 0
        ? "当前 Git 仓库未配置远程仓库"
        : "当前 Git 仓库有多个远程仓库，且未配置默认上游",
    };
  }
  return {
    repositoryPath,
    publicationRemotes,
    fetchRemote: publicationRemotes.find((remote) => remote.name === name)!,
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
      mergeToBaseBranch: configuration.mergeToBaseBranch,
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

  async observeRepair(input: {
    issue: Issue;
    resourceId: string;
  }): Promise<WorkspaceRepairObservation> {
    return observeGitRepair(this.getSavedState(input.issue, input.resourceId));
  }

  async validateRepair(input: {
    issue: Issue;
    resourceId: string;
    observation: WorkspaceRepairObservation;
    result: RepairResult;
  }) {
    return validateGitRepair({
      state: this.getSavedState(input.issue, input.resourceId),
      observation: input.observation,
      result: input.result,
    });
  }

  async publish(input: {
    issue: Issue;
    resourceId: string;
  }): Promise<BranchInfo> {
    const state = this.getSavedState(input.issue, input.resourceId);
    if (state.branchInfo) return state.branchInfo;
    if (input.issue.status !== "FINALIZING") {
      throw new Error("GIT_WORKSPACE_NOT_FINALIZING");
    }

    let step: WorkspaceFinalizationStep = "status";
    let recovery: GitFinalizationRecoveryState | undefined;
    try {
      if (looksLikePersistedMergeRecovery(state.finalizationRecovery)) step = "merge";
      recovery = normalizeGitFinalizationRecoveryState(state.finalizationRecovery);
      let commit: string;
      if (recovery?.kind === "MERGE_CONFLICT" && recovery.session.candidateTree) {
        step = "merge";
        commit = await finalizeGitMergeRecovery({
          worktreePath: state.worktreePath,
          baseRef: `refs/heads/${state.baseBranch}`,
          session: recovery.session,
          deliveryToken: recoveryDeliveryToken(input.issue),
        });
        this.options.state.set(MODULE_ID, input.resourceId, {
          ...state,
          finalizationRecovery: recovery,
        });
      } else {
        await assertNoHiddenIndexEntries(state.worktreePath);
        await assertInitializedSubmodulesClean(state.worktreePath);
        const changes = await runGit(state.worktreePath, [
          "status",
          "--porcelain",
          "--untracked-files=all",
          "--ignore-submodules=none",
        ]);
        if (changes) {
          step = "add";
          await assertPublicationPreflight(state.worktreePath);
          await runGit(state.worktreePath, ["add", "-A"]);
          await assertNoUndeclaredGitlinks(state.worktreePath);
          await assertInitializedSubmodulesClean(state.worktreePath);
          step = "commit";
          await runGit(state.worktreePath, [
            "commit",
            "-m",
            `${input.issue.identifier}: ${input.issue.title}`,
          ]);
        }
        commit = await runGit(state.worktreePath, ["rev-parse", "HEAD"]);
      }
      const pushToRemote = shouldPushToRemote(state);
      if (pushToRemote) {
        step = "push";
        await runGit(state.worktreePath, [
          "push",
          state.remote!,
          `refs/heads/${state.branch}:refs/heads/${state.branch}`,
        ]);
      }
      if (state.mergeToBaseBranch) {
        step = "merge";
        await mergeIntoBaseBranch(
          state,
          commit,
          recovery?.kind === "MERGE_CONFLICT"
            ? recovery.session.baseCommit
            : undefined,
        );
      }

      const branchInfo: BranchInfo = {
        name: state.branch,
        commit,
        ...(pushToRemote ? { remote: state.remote } : {}),
      };
      const {
        finalizationRecovery: _recovery,
        lastMergeFailure: _lastMergeFailure,
        ...completedState
      } = state;
      this.options.state.set(MODULE_ID, input.resourceId, {
        ...completedState,
        branchInfo,
      });
      return branchInfo;
    } catch (error) {
      if (error instanceof GitAutomaticMergeConflictError || recovery?.kind === "MERGE_CONFLICT") {
        this.options.state.set(MODULE_ID, input.resourceId, {
          ...state,
          ...(recovery?.kind === "MERGE_CONFLICT"
            ? { finalizationRecovery: recovery }
            : {}),
          ...(error instanceof GitAutomaticMergeConflictError
            ? {
                lastMergeFailure: {
                  baseCommit: error.baseCommit,
                  issueCommit: error.issueCommit,
                  conflictPaths: error.conflictPaths,
                  mergeMessages: error.mergeMessages,
                },
              }
            : {}),
        });
      }
      throw finalizationError({
        error,
        providerId: this.id,
        step,
        worktreePath: state.worktreePath,
      });
    }
  }

  async prepareFinalizationRecovery(input: {
    issue: Issue;
    resourceId: string;
    diagnostic: WorkspaceFinalizationDiagnostic;
    attemptId: string;
  }): Promise<WorkspaceFinalizationRecoveryContext> {
    const state = this.getSavedState(input.issue, input.resourceId);
    const fingerprintRef = `${input.resourceId}:finalization:${input.attemptId}`;
    if (input.diagnostic.step === "merge") {
      let prepared;
      try {
        prepared = await prepareGitMergeRecovery({
          worktreePath: state.worktreePath,
          baseBranch: state.baseBranch,
          issueBranch: state.branch,
          diagnostic: input.diagnostic,
          attemptId: input.attemptId,
          fingerprintRef,
          lastMergeFailure: state.lastMergeFailure,
          existing: state.finalizationRecovery,
        });
      } catch (error) {
        if (!isInvalidMergeRecoveryState(error)) throw error;
        const [issueCommit, baseCommit, workspaceStatus] = await Promise.all([
          runGit(state.worktreePath, ["rev-parse", "HEAD"]),
          tryRunGit(
            state.worktreePath,
            ["rev-parse", `refs/heads/${state.baseBranch}`],
            [128],
          ),
          readGitWorkspaceStatus(state.worktreePath),
        ]);
        return {
          fingerprintRef,
          workspaceStatus,
          fingerprintSummary: "persisted merge recovery state is malformed",
          recoveryKind: "MERGE_ENVIRONMENT",
          merge: {
            kind: "MERGE_ENVIRONMENT",
            baseBranch: state.baseBranch,
            ...(baseCommit ? { baseCommit } : {}),
            issueBranch: state.branch,
            issueCommit,
            conflictPaths: input.diagnostic.relatedPaths.slice(0, 50),
            mergeMessages: ["Persisted merge recovery state could not be decoded"],
            mergePrepared: false,
          },
        };
      }
      if (prepared.recovery) {
        this.options.state.set(MODULE_ID, input.resourceId, {
          ...state,
          finalizationRecovery: prepared.recovery,
        });
      }
      return prepared.context;
    }
    const prepared = await prepareGitFinalizationRecovery({
      worktreePath: state.worktreePath,
      diagnostic: input.diagnostic,
      attemptId: input.attemptId,
      fingerprintRef,
    });
    this.options.state.set(MODULE_ID, input.resourceId, {
      ...state,
      finalizationRecovery: {
        version: 1,
        kind: "GENERATED_ARTIFACT_CLEANUP",
        fingerprint: prepared.fingerprint,
      },
    });
    return prepared.context;
  }

  async validateFinalizationRecovery(input: {
    issue: Issue;
    resourceId: string;
    fingerprintRef: string;
    result: FinalizationRecoveryResult;
  }): Promise<WorkspaceFinalizationRecoveryValidation> {
    const state = this.getSavedState(input.issue, input.resourceId);
    let recovery;
    try {
      recovery = normalizeGitFinalizationRecoveryState(state.finalizationRecovery);
    } catch (error) {
      if (!isInvalidMergeRecoveryState(error)) throw error;
      return {
        kind: "UNSAFE",
        changedPaths: [],
        reason: "GIT_MERGE_RECOVERY_STATE_INVALID",
      };
    }
    if (
      recovery?.kind === "MERGE_CONFLICT"
      && recovery.session.fingerprintRef === input.fingerprintRef
    ) {
      const validation = await validateGitMergeRecovery({
        worktreePath: state.worktreePath,
        session: recovery.session,
        result: input.result,
      });
      this.options.state.set(MODULE_ID, input.resourceId, {
        ...state,
        finalizationRecovery: recovery,
      });
      return validation;
    }
    const fingerprint = recovery?.kind === "GENERATED_ARTIFACT_CLEANUP"
      ? recovery.fingerprint
      : recovery?.kind === "MERGE_ENVIRONMENT"
        ? recovery.fingerprint
        : undefined;
    if (!fingerprint || fingerprint.fingerprintRef !== input.fingerprintRef) {
      return {
        kind: "UNSAFE",
        changedPaths: [],
        reason: "FINALIZATION_RECOVERY_FINGERPRINT_NOT_FOUND",
      };
    }
    const diagnosticCode = input.issue.finalizationRecovery?.diagnostic?.code;
    const validation = await validateGitFinalizationRecovery({
      worktreePath: state.worktreePath,
      fingerprint,
      includeRefs: recovery?.kind === "MERGE_ENVIRONMENT",
      ...(recovery?.kind === "MERGE_ENVIRONMENT"
        && recovery.repositoryStateWithoutBaseHash
        && diagnosticCode === "GIT_AUTO_MERGE_REQUIRES_LOCAL_BASE_BRANCH"
        && recovery.merge.baseCommit === undefined
        ? {
            allowedRepositoryStateChange: {
              excludedRefs: [`refs/heads/${state.baseBranch}`],
              expectedHash: recovery.repositoryStateWithoutBaseHash,
            },
          }
        : {}),
    });
    if (recovery?.kind !== "MERGE_ENVIRONMENT" || validation.kind === "UNSAFE") {
      return validation;
    }
    const unresolvedReason = await unresolvedMergeEnvironmentReason(
      state,
      diagnosticCode,
    );
    if (unresolvedReason) {
      return { kind: "UNSAFE", changedPaths: validation.changedPaths, reason: unresolvedReason };
    }
    if (validation.kind === "UNCHANGED") {
      const preflightReason = await automaticMergePreflightReason(state);
      if (preflightReason) {
        return { kind: "UNSAFE", changedPaths: [], reason: preflightReason };
      }
    }
    return validation;
  }

  async bindFinalizationRecoveryDelivery(input: {
    issue: Issue;
    resourceId: string;
    fingerprintRef: string;
  }): Promise<void> {
    const state = this.getSavedState(input.issue, input.resourceId);
    const recovery = normalizeGitFinalizationRecoveryState(state.finalizationRecovery);
    if (
      recovery?.kind !== "MERGE_CONFLICT"
      || recovery.session.fingerprintRef !== input.fingerprintRef
    ) return;
    const deliveryToken = recoveryDeliveryToken(input.issue);
    if (!deliveryToken) throw new Error("GIT_MERGE_RECOVERY_DELIVERY_TOKEN_REQUIRED");
    recovery.session.deliveryToken = deliveryToken;
    this.options.state.set(MODULE_ID, input.resourceId, {
      ...state,
      finalizationRecovery: recovery,
    });
  }

  async release(input: { issue: Issue; resourceId: string }): Promise<void> {
    const state = this.getSavedState(input.issue, input.resourceId);
    try {
      if (!(await pathExists(state.worktreePath))) {
        await runGit(state.repositoryPath, ["worktree", "prune"]);
        return;
      }
      await assertWorktreeAndSubmodulesClean(state.worktreePath);
      await runGit(state.repositoryPath, [
        "worktree",
        "remove",
        "--force",
        state.worktreePath,
      ]);
    } catch (error) {
      throw finalizationError({
        error,
        providerId: this.id,
        step: "release",
        worktreePath: state.worktreePath,
      });
    }
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
      mergeToBaseBranch: false,
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

function isInvalidMergeRecoveryState(error: unknown): boolean {
  return error instanceof Error && error.message === "GIT_MERGE_RECOVERY_STATE_INVALID";
}

function looksLikePersistedMergeRecovery(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "kind" in value
    && (value.kind === "MERGE_CONFLICT" || value.kind === "MERGE_ENVIRONMENT");
}

function recoveryDeliveryToken(issue: Issue): string | undefined {
  const draft = issue.repair?.deliveryDraft;
  return draft
    ? JSON.stringify([
        draft.repairIteration,
        draft.implementationCompletedAt,
        draft.summary,
      ])
    : undefined;
}

const MAX_BASE_ADVANCE_ATTEMPTS = 3;

export async function retryOnBaseAdvance<T>(
  readBase: () => Promise<string>,
  attempt: (baseCommit: string) => Promise<T>,
  maxAttempts = MAX_BASE_ADVANCE_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let number = 0; number < maxAttempts; number += 1) {
    const observedBase = await readBase();
    try {
      return await attempt(observedBase);
    } catch (error) {
      if (await readBase() === observedBase) throw error;
      lastError = error;
    }
  }
  throw new Error("GIT_AUTO_MERGE_FAILED", { cause: lastError });
}

async function mergeIntoBaseBranch(
  state: GitWorkspaceState,
  commit: string,
  expectedBaseCommit?: string,
): Promise<void> {
  await assertGitSupportsAutomaticMerge(state.repositoryPath);
  const baseRef = `refs/heads/${state.baseBranch}`;
  if (!(await gitRefExists(state.repositoryPath, baseRef))) {
    throw new Error("GIT_AUTO_MERGE_REQUIRES_LOCAL_BASE_BRANCH");
  }
  if (await tryRunGit(
    state.repositoryPath,
    ["merge-base", "--is-ancestor", commit, baseRef],
  ) !== undefined) {
    return;
  }

  const listed = await runGit(state.repositoryPath, ["worktree", "list", "--porcelain", "-z"]);
  const checkedOutPath = worktreePathForBranch(listed, baseRef);

  const readBase = () => runGit(state.repositoryPath, ["rev-parse", baseRef]);
  const attemptMerge = async (baseCommit: string): Promise<void> => {
    if (await tryRunGit(
      state.repositoryPath,
      ["merge-base", "--is-ancestor", commit, baseCommit],
    ) !== undefined) {
      return;
    }
    const resultCommit = await createAutomaticMergeCommit(
      state.repositoryPath,
      baseCommit,
      commit,
      state.branch,
      state.baseBranch,
    );
    if (checkedOutPath !== undefined) {
      try {
        await assertBaseCheckoutMergeSafe(
          state.repositoryPath,
          checkedOutPath,
          baseCommit,
          resultCommit,
        );
      } catch (error) {
        if (error instanceof Error && error.message === "GIT_WORKTREE_NOT_CLEAN") {
          throw new Error("GIT_AUTO_MERGE_BASE_DIRTY", { cause: error });
        }
        throw error;
      }
      try {
        await runGit(checkedOutPath, ["merge", "--ff-only", resultCommit]);
      } catch (error) {
        throw new Error("GIT_AUTO_MERGE_BASE_DIRTY", { cause: error });
      }
      return;
    }
    try {
      await runGit(state.repositoryPath, [
        "update-ref",
        baseRef,
        resultCommit,
        baseCommit,
      ]);
    } catch (error) {
      throw new Error("GIT_AUTO_MERGE_FAILED", { cause: error });
    }
  };

  if (expectedBaseCommit !== undefined) {
    const baseCommit = await readBase();
    if (baseCommit !== expectedBaseCommit) {
      throw new Error("GIT_AUTO_MERGE_BASE_MOVED");
    }
    try {
      await attemptMerge(baseCommit);
    } catch (error) {
      if (await readBase() !== baseCommit) {
        throw new Error("GIT_AUTO_MERGE_BASE_MOVED", { cause: error });
      }
      throw error;
    }
    return;
  }

  await retryOnBaseAdvance(readBase, attemptMerge);
}

async function assertGitSupportsAutomaticMerge(repositoryPath: string): Promise<void> {
  const version = await runGit(repositoryPath, ["version"]);
  if (!gitVersionSupportsAutomaticMerge(version)) {
    throw new Error("GIT_AUTO_MERGE_REQUIRES_GIT_2_38");
  }
}

async function unresolvedMergeEnvironmentReason(
  state: GitWorkspaceState,
  diagnosticCode: string | undefined,
): Promise<string | undefined> {
  const baseRef = `refs/heads/${state.baseBranch}`;
  if (diagnosticCode === "GIT_AUTO_MERGE_REQUIRES_LOCAL_BASE_BRANCH") {
    return await gitRefExists(state.repositoryPath, baseRef)
      ? undefined
      : diagnosticCode;
  }
  if (diagnosticCode === "GIT_AUTO_MERGE_REQUIRES_GIT_2_38") {
    try {
      await assertGitSupportsAutomaticMerge(state.repositoryPath);
      return undefined;
    } catch {
      return diagnosticCode;
    }
  }
  if (diagnosticCode === "GIT_AUTO_MERGE_BASE_DIRTY") {
    return await automaticMergePreflightReason(state);
  }
  return "GIT_MERGE_ENVIRONMENT_UNRESOLVED";
}

async function automaticMergePreflightReason(
  state: GitWorkspaceState,
): Promise<string | undefined> {
  const baseRef = `refs/heads/${state.baseBranch}`;
  try {
    await assertGitSupportsAutomaticMerge(state.repositoryPath);
  } catch {
    return "GIT_AUTO_MERGE_REQUIRES_GIT_2_38";
  }
  if (!(await gitRefExists(state.repositoryPath, baseRef))) {
    return "GIT_AUTO_MERGE_REQUIRES_LOCAL_BASE_BRANCH";
  }
  try {
    const listed = await runGit(state.repositoryPath, ["worktree", "list", "--porcelain", "-z"]);
    const checkedOutPath = worktreePathForBranch(listed, baseRef);
    const [baseCommit, issueCommit] = await Promise.all([
      runGit(state.repositoryPath, ["rev-parse", baseRef]),
      runGit(state.worktreePath, ["rev-parse", "HEAD"]),
    ]);
    const treeOutput = await runGit(state.repositoryPath, [
      "merge-tree",
      "--write-tree",
      baseCommit,
      issueCommit,
    ]);
    const resultTree = treeOutput.split("\n", 1)[0]?.trim();
    if (!resultTree) return "GIT_MERGE_ENVIRONMENT_UNRESOLVED";
    if (checkedOutPath) {
      try {
        await assertBaseCheckoutMergeSafe(
          state.repositoryPath,
          checkedOutPath,
          baseCommit,
          resultTree,
        );
      } catch {
        return "GIT_AUTO_MERGE_BASE_DIRTY";
      }
    }
    return undefined;
  } catch (error) {
    return error instanceof GitCommandError && error.exitCode === 1
      ? "GIT_AUTO_MERGE_CONFLICT"
      : "GIT_MERGE_ENVIRONMENT_UNRESOLVED";
  }
}

export function gitVersionSupportsAutomaticMerge(versionOutput: string): boolean {
  const match = /^git version (\d+)\.(\d+)(?:\.|\s|$)/.exec(versionOutput.trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 2 || (major === 2 && minor >= 38);
}

async function createAutomaticMergeCommit(
  repositoryPath: string,
  baseCommit: string,
  issueCommit: string,
  issueBranch: string,
  baseBranch: string,
): Promise<string> {
  if (await tryRunGit(
    repositoryPath,
    ["merge-base", "--is-ancestor", baseCommit, issueCommit],
  ) !== undefined) {
    return issueCommit;
  }

  let tree: string;
  try {
    tree = await runGit(repositoryPath, ["merge-tree", "--write-tree", baseCommit, issueCommit]);
  } catch (error) {
    if (gitErrorExitCode(error) === 1) {
      const commandError = error instanceof GitCommandError ? error : undefined;
      const parsed = parseMergeTreeConflictOutput(
        commandError?.stdout ?? "",
        commandError?.stderr ?? "",
      );
      throw new GitAutomaticMergeConflictError(
        parsed.conflictPaths,
        parsed.mergeMessages,
        baseCommit,
        issueCommit,
        error,
      );
    }
    throw new Error("GIT_AUTO_MERGE_FAILED", { cause: error });
  }

  const treeObject = tree.split("\n", 1)[0]?.trim();
  if (!treeObject) throw new Error("GIT_AUTO_MERGE_FAILED");
  try {
    return await runGit(repositoryPath, [
      "commit-tree",
      treeObject,
      "-p",
      baseCommit,
      "-p",
      issueCommit,
      "-m",
      `Merge ${issueBranch} into ${baseBranch}`,
    ]);
  } catch (error) {
    throw new Error("GIT_AUTO_MERGE_FAILED", { cause: error });
  }
}

function gitErrorExitCode(error: unknown): number | undefined {
  const processError = error instanceof Error ? error.cause : undefined;
  if (!processError || typeof processError !== "object" || !("code" in processError)) {
    return undefined;
  }
  return typeof processError.code === "number" ? processError.code : undefined;
}

async function assertBaseCheckoutMergeSafe(
  repositoryPath: string,
  worktreePath: string,
  baseCommit: string,
  resultObject: string,
): Promise<void> {
  await assertNoHiddenIndexEntries(worktreePath);
  await assertInitializedSubmodulesClean(worktreePath);

  const [mergePaths, trackedOutput, untrackedOutput] = await Promise.all([
    getChangedPaths(repositoryPath, baseCommit, resultObject),
    runGit(worktreePath, ["diff", "--name-only", "--no-renames", "-z", "HEAD"]),
    runGit(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const localPaths = [
    ...parseNulPaths(trackedOutput),
    ...parseNulPaths(untrackedOutput),
  ];
  if (localPaths.some((localPath) =>
    mergePaths.some((mergePath) => gitPathsOverlap(localPath, mergePath)))) {
    throw new Error("GIT_WORKTREE_NOT_CLEAN");
  }

  await assertNoIgnoredMergeCollisions(
    repositoryPath,
    worktreePath,
    baseCommit,
    resultObject,
  );
  await assertNoInitializedGitlinkUpdates(
    repositoryPath,
    worktreePath,
    baseCommit,
    resultObject,
  );
}

function parseNulPaths(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

function gitPathsOverlap(left: string, right: string): boolean {
  return left === right
    || left.startsWith(`${right}/`)
    || right.startsWith(`${left}/`);
}

async function assertNoIgnoredMergeCollisions(
  repositoryPath: string,
  worktreePath: string,
  baseCommit: string,
  resultCommit: string,
): Promise<void> {
  const changedPaths = await getChangedPaths(repositoryPath, baseCommit, resultCommit);
  const pathsAndParents = new Set<string>();
  for (const path of changedPaths) {
    const segments = path.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      pathsAndParents.add(segments.slice(0, index).join("/"));
    }
  }
  const pathspecs = [...pathsAndParents].map((path) => `:(literal)${path}`);
  for (let offset = 0; offset < pathspecs.length; offset += 128) {
    const ignored = await runGit(worktreePath, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
      "--",
      ...pathspecs.slice(offset, offset + 128),
    ]);
    if (ignored) throw new Error("GIT_WORKTREE_NOT_CLEAN");
  }
}

async function assertNoInitializedGitlinkUpdates(
  repositoryPath: string,
  worktreePath: string,
  baseCommit: string,
  resultCommit: string,
): Promise<void> {
  const before = await getCommitGitlinks(repositoryPath, baseCommit);
  const after = await getCommitGitlinks(repositoryPath, resultCommit);
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(path) === after.get(path)) continue;
    if (await pathExists(join(worktreePath, path, ".git"))) {
      throw new Error("GIT_WORKTREE_NOT_CLEAN");
    }
  }
}

async function getChangedPaths(
  repositoryPath: string,
  before: string,
  after: string,
): Promise<string[]> {
  const output = await runGit(repositoryPath, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    before,
    after,
  ]);
  return parseNulPaths(output);
}

async function getCommitGitlinks(
  repositoryPath: string,
  commit: string,
): Promise<Map<string, string>> {
  const entries = await runGit(repositoryPath, ["ls-tree", "-r", "-z", commit]);
  const gitlinks = new Map<string, string>();
  for (const entry of entries.split("\0")) {
    const separator = entry.indexOf("\t");
    if (separator === -1) continue;
    const [mode, , object] = entry.slice(0, separator).split(" ");
    if (mode === "160000" && object) gitlinks.set(entry.slice(separator + 1), object);
  }
  return gitlinks;
}

function worktreePathForBranch(list: string, branchRef: string): string | undefined {
  let worktreePath: string | undefined;
  for (const field of list.split("\0")) {
    if (field.startsWith("worktree ")) {
      worktreePath = field.slice("worktree ".length);
    } else if (field === `branch ${branchRef}`) {
      return worktreePath;
    } else if (!field) {
      worktreePath = undefined;
    }
  }
  return undefined;
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
