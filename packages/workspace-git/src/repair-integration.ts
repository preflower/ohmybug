import { access, lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import type { RepairResult } from "@oh-my-bug/core";
import type {
  WorkspaceRepairObservation,
  WorkspaceRepairValidation,
} from "@oh-my-bug/module-api";

import { assertPublicationPreflight } from "./finalization-recovery.js";
import { runGit, tryRunGit } from "./git-client.js";

export interface GitRepairWorkspaceState {
  repositoryPath: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  mergeToBaseBranch?: boolean;
}

export async function observeGitRepair(
  state: GitRepairWorkspaceState,
): Promise<WorkspaceRepairObservation> {
  if (!state.mergeToBaseBranch) return { required: false };
  return {
    required: true,
    baseBranch: state.baseBranch,
    baseCommit: await runGit(state.repositoryPath, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      "refs/heads/" + state.baseBranch + "^{commit}",
    ]),
    issueBranch: state.branch,
  };
}

export async function validateGitRepair(input: {
  state: GitRepairWorkspaceState;
  observation: WorkspaceRepairObservation;
  result: RepairResult;
}): Promise<WorkspaceRepairValidation> {
  const { state, observation, result } = input;
  const branch = await currentBranch(state.worktreePath);
  if (branch !== state.branch || (observation.issueBranch && branch !== observation.issueBranch)) {
    throw new Error("GIT_REPAIR_WRONG_BRANCH");
  }
  const head = await runGit(state.worktreePath, ["rev-parse", "--verify", "HEAD^{commit}"]);

  if (result.kind === "BUSINESS_DECISION_REQUIRED") {
    if (!observation.required) throw new Error("GIT_REPAIR_BASE_MISMATCH");
    assertObservedBase(observation, result.decision.baseCommit);
    if (result.decision.issueCommit !== head) throw new Error("GIT_REPAIR_HEAD_MISMATCH");
    await assertNoForeignOperationState(state.worktreePath, true);
    const unmerged = await unmergedPaths(state.worktreePath);
    if (unmerged.length === 0 || !samePaths(unmerged, result.decision.conflictPaths)) {
      throw new Error("GIT_REPAIR_UNRESOLVED_MERGE");
    }
    return { kind: "BUSINESS_DECISION_REQUIRED" };
  }

  if (
    result.verification.length === 0
    || result.verification.some((item) => item.outcome === "FAILED")
  ) {
    throw new Error("GIT_REPAIR_VERIFICATION_REQUIRED");
  }
  if (observation.required) {
    if (!result.integration) throw new Error("GIT_REPAIR_BASE_MISMATCH");
    assertObservedBase(observation, result.integration.baseCommit);
    if (result.integration.issueCommit !== head) throw new Error("GIT_REPAIR_HEAD_MISMATCH");
  } else if (result.integration) {
    throw new Error("GIT_REPAIR_BASE_MISMATCH");
  }

  await assertNoForeignOperationState(state.worktreePath, false);
  if ((await unmergedPaths(state.worktreePath)).length > 0) {
    throw new Error("GIT_REPAIR_UNRESOLVED_MERGE");
  }
  if (observation.required) {
    const ancestor = await tryRunGit(
      state.worktreePath,
      ["merge-base", "--is-ancestor", observation.baseCommit!, head],
      [1],
    );
    if (ancestor === undefined) throw new Error("GIT_REPAIR_BASE_NOT_ANCESTOR");
  }
  await assertRepairWorktreeSafe(state.worktreePath);
  return {
    kind: "DELIVERY_READY",
    branch: { name: state.branch, commit: head },
  };
}

function assertObservedBase(
  observation: WorkspaceRepairObservation,
  returnedBase: string,
): void {
  if (
    !observation.required
    || !observation.baseCommit
    || returnedBase !== observation.baseCommit
  ) {
    throw new Error("GIT_REPAIR_BASE_MISMATCH");
  }
}

async function currentBranch(worktreePath: string): Promise<string | undefined> {
  return tryRunGit(worktreePath, ["symbolic-ref", "--quiet", "--short", "HEAD"], [1, 128]);
}

async function unmergedPaths(worktreePath: string): Promise<string[]> {
  const entries = await runGit(worktreePath, ["ls-files", "-u", "-z"]);
  return [...new Set(entries.split("\0").flatMap((entry) => {
    const separator = entry.indexOf("\t");
    return separator === -1 ? [] : [entry.slice(separator + 1)];
  }))].sort();
}

function samePaths(left: string[], right: string[]): boolean {
  const normalized = [...new Set(right)].sort();
  return left.length === normalized.length
    && left.every((path, index) => path === normalized[index]);
}

async function assertNoForeignOperationState(
  worktreePath: string,
  allowMerge: boolean,
): Promise<void> {
  const names = [
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-apply",
    "rebase-merge",
    "sequencer",
  ];
  if (!allowMerge) names.push("MERGE_HEAD");
  for (const name of names) {
    const path = await runGit(worktreePath, ["rev-parse", "--git-path", name]);
    if (await pathExists(path)) throw new Error("GIT_REPAIR_UNRESOLVED_MERGE");
  }
}

async function assertRepairWorktreeSafe(worktreePath: string): Promise<void> {
  try {
    await assertPublicationPreflight(worktreePath);
  } catch (error) {
    if (error instanceof Error && error.message === "GIT_GENERATED_ARTIFACTS_PRESENT") {
      throw new Error("GIT_REPAIR_GENERATED_ARTIFACTS_PRESENT", { cause: error });
    }
    throw new Error("GIT_REPAIR_WORKTREE_DIRTY", { cause: error });
  }
  try {
    await assertNoHiddenIndexEntries(worktreePath);
    await assertNoUndeclaredGitlinks(worktreePath);
    await assertInitializedSubmodulesClean(worktreePath);
    const changes = await runGit(worktreePath, [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]);
    if (changes) throw new Error("GIT_WORKTREE_NOT_CLEAN");
  } catch (error) {
    throw new Error("GIT_REPAIR_WORKTREE_DIRTY", { cause: error });
  }
}

export async function assertNoHiddenIndexEntries(worktreePath: string): Promise<void> {
  const entries = await runGit(worktreePath, ["ls-files", "-v", "-z"]);
  if (entries.split("\0").some((entry) => /^[a-zS] /.test(entry))) {
    throw new Error("GIT_WORKTREE_NOT_CLEAN");
  }
}

export async function assertInitializedSubmodulesClean(
  worktreePath: string,
  visited = new Set<string>(),
): Promise<void> {
  visited.add(await realpath(worktreePath));
  for (const gitlink of await getIndexGitlinks(worktreePath)) {
    const submodulePath = join(worktreePath, gitlink);
    if (!(await gitlinkDirectoryExists(submodulePath))) continue;
    if (await pathExists(join(submodulePath, ".git"))) {
      await assertWorktreeAndSubmodulesClean(submodulePath, visited);
    } else if ((await readdir(submodulePath)).length > 0) {
      throw new Error("GIT_WORKTREE_NOT_CLEAN");
    }
  }
}

export async function assertWorktreeAndSubmodulesClean(
  worktreePath: string,
  visited = new Set<string>(),
): Promise<void> {
  const canonicalPath = await realpath(worktreePath);
  if (visited.has(canonicalPath)) return;
  visited.add(canonicalPath);
  await assertNoHiddenIndexEntries(worktreePath);
  await assertInitializedSubmodulesClean(worktreePath, visited);
  const changes = await runGit(worktreePath, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  if (changes) throw new Error("GIT_WORKTREE_NOT_CLEAN");
}

export async function assertNoUndeclaredGitlinks(worktreePath: string): Promise<void> {
  try {
    const gitlinks = await getIndexGitlinks(worktreePath);
    if (gitlinks.length === 0) return;
    const mappings = await tryRunGit(
      worktreePath,
      ["config", "-z", "--blob", ":.gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
      [1],
    );
    const declaredPaths = new Set(
      mappings?.split("\0").flatMap((mapping) => {
        const separator = mapping.indexOf("\n");
        return separator === -1 ? [] : [mapping.slice(separator + 1)];
      }) ?? [],
    );
    if (gitlinks.some((path) => !declaredPaths.has(path))) {
      throw new Error("UNDECLARED_GITLINK");
    }
  } catch (error) {
    throw new Error("GIT_EMBEDDED_REPOSITORY_NOT_ALLOWED", { cause: error });
  }
}

async function getIndexGitlinks(worktreePath: string): Promise<string[]> {
  const entries = await runGit(worktreePath, ["ls-files", "--stage", "-z"]);
  return entries.split("\0").flatMap((entry) => {
    const separator = entry.indexOf("\t");
    if (separator === -1) return [];
    const [mode, , stage] = entry.slice(0, separator).split(" ");
    return mode === "160000" && stage === "0" ? [entry.slice(separator + 1)] : [];
  });
}

async function gitlinkDirectoryExists(path: string): Promise<boolean> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  if (!stats.isDirectory()) throw new Error("GIT_WORKTREE_NOT_CLEAN");
  return true;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
