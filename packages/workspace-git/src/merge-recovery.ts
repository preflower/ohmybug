const MAX_CONFLICT_PATHS = 50;
const MAX_MERGE_MESSAGES = 20;
const MAX_MERGE_MESSAGE_LENGTH = 1_000;

export interface ParsedMergeConflictOutput {
  conflictPaths: string[];
  mergeMessages: string[];
}

export class GitAutomaticMergeConflictError extends Error {
  constructor(
    readonly conflictPaths: string[],
    readonly mergeMessages: string[],
    readonly baseCommit: string,
    readonly issueCommit: string,
    cause: unknown,
  ) {
    super("GIT_AUTO_MERGE_CONFLICT", { cause });
    this.name = "GitAutomaticMergeConflictError";
  }
}

export interface GitMergeFailureRecord {
  baseCommit: string;
  issueCommit: string;
  conflictPaths: string[];
  mergeMessages: string[];
}

export interface GitMergeRecoverySession {
  version: 1;
  attemptId: string;
  fingerprintRef: string;
  baseBranch: string;
  baseCommit: string;
  issueBranch: string;
  issueCommit: string;
  conflictPaths: string[];
  mergeMessages: string[];
  mergeHead: string;
  conflictStages: string;
  preparedFingerprint: GitFinalizationFingerprint;
  candidateTree?: string;
  validatedPaths?: string[];
}

export type GitFinalizationRecoveryState =
  | {
      version: 1;
      kind: "GENERATED_ARTIFACT_CLEANUP";
      fingerprint: GitFinalizationFingerprint;
    }
  | {
      version: 1;
      kind: "MERGE_CONFLICT";
      session: GitMergeRecoverySession;
    }
  | {
      version: 1;
      kind: "MERGE_ENVIRONMENT";
      fingerprint: GitFinalizationFingerprint;
      merge: FinalizationRecoveryMergeContext;
    };

export function normalizeGitFinalizationRecoveryState(
  value: GitFinalizationRecoveryState | GitFinalizationFingerprint | undefined,
): GitFinalizationRecoveryState | undefined {
  if (!value) return undefined;
  if ("version" in value) return value;
  return { version: 1, kind: "GENERATED_ARTIFACT_CLEANUP", fingerprint: value };
}

export async function prepareGitMergeRecovery(input: {
  worktreePath: string;
  baseBranch: string;
  issueBranch: string;
  diagnostic: WorkspaceFinalizationDiagnostic;
  attemptId: string;
  fingerprintRef: string;
  lastMergeFailure?: GitMergeFailureRecord;
  existing?: GitFinalizationRecoveryState | GitFinalizationFingerprint;
}): Promise<{
  recovery: GitFinalizationRecoveryState;
  context: WorkspaceFinalizationRecoveryContext;
}> {
  const issueCommit = await runGit(input.worktreePath, ["rev-parse", "HEAD"]);
  const existing = normalizeGitFinalizationRecoveryState(input.existing);
  if (
    existing?.kind === "MERGE_CONFLICT"
    && existing.session.attemptId === input.attemptId
  ) {
    const mergeHead = await tryRunGit(
      input.worktreePath,
      ["rev-parse", "-q", "MERGE_HEAD"],
      [128],
    );
    if (
      mergeHead === existing.session.baseCommit
      && issueCommit === existing.session.issueCommit
    ) {
      return {
        recovery: existing,
        context: await conflictContext(input.worktreePath, existing.session),
      };
    }
  }

  const observedBase = input.lastMergeFailure?.baseCommit
    ?? await tryRunGit(input.worktreePath, [
      "rev-parse",
      `refs/heads/${input.baseBranch}`,
    ], [128]);
  const environment = async (messages: string[]): Promise<{
    recovery: GitFinalizationRecoveryState;
    context: WorkspaceFinalizationRecoveryContext;
  }> => {
    const merge: FinalizationRecoveryMergeContext = {
      kind: "MERGE_ENVIRONMENT",
      baseBranch: input.baseBranch,
      ...(observedBase ? { baseCommit: observedBase } : {}),
      issueBranch: input.issueBranch,
      issueCommit,
      conflictPaths: input.diagnostic.relatedPaths.slice(0, MAX_CONFLICT_PATHS),
      mergeMessages: messages.slice(0, MAX_MERGE_MESSAGES),
      mergePrepared: false,
    };
    const fingerprint = await captureGitFinalizationFingerprint({
      worktreePath: input.worktreePath,
      diagnosticPaths: [],
      fingerprintRef: input.fingerprintRef,
      attemptId: input.attemptId,
    });
    return {
      recovery: { version: 1, kind: "MERGE_ENVIRONMENT", fingerprint, merge },
      context: {
        fingerprintRef: input.fingerprintRef,
        workspaceStatus: await readGitWorkspaceStatus(input.worktreePath),
        fingerprintSummary: `inspection-only merge recovery at ${issueCommit}`,
        recoveryKind: "MERGE_ENVIRONMENT",
        merge,
      },
    };
  };

  const failure = input.lastMergeFailure;
  if (
    input.diagnostic.code !== "GIT_AUTO_MERGE_CONFLICT"
    || !failure
    || failure.issueCommit !== issueCommit
  ) {
    return environment([input.diagnostic.message]);
  }
  const currentMergeHead = await tryRunGit(
    input.worktreePath,
    ["rev-parse", "-q", "MERGE_HEAD"],
    [128],
  );
  if (currentMergeHead) return environment(["A foreign merge session is already active"]);
  const status = await readGitWorkspaceStatus(input.worktreePath);
  if (status) return environment(["The Issue Worktree changed before merge preparation"]);

  try {
    await runGit(input.worktreePath, [
      "merge",
      "--no-commit",
      "--no-ff",
      failure.baseCommit,
    ]);
    return environment(["The recorded conflict could not be reproduced"]);
  } catch (error) {
    if (!(error instanceof GitCommandError) || error.exitCode !== 1) {
      return environment([
        error instanceof Error ? error.message : "Merge preparation failed",
      ]);
    }
  }

  const mergeHead = await runGit(input.worktreePath, ["rev-parse", "MERGE_HEAD"]);
  const conflictStages = await runGit(input.worktreePath, ["ls-files", "-u", "-z"]);
  const conflictPaths = parseUnmergedPaths(conflictStages);
  if (mergeHead !== failure.baseCommit || conflictPaths.length === 0) {
    return environment(["Provider-owned merge state did not match the recorded conflict"]);
  }
  const preparedFingerprint = await captureGitFinalizationFingerprint({
    worktreePath: input.worktreePath,
    diagnosticPaths: [],
    fingerprintRef: input.fingerprintRef,
    attemptId: input.attemptId,
  });
  const session: GitMergeRecoverySession = {
    version: 1,
    attemptId: input.attemptId,
    fingerprintRef: input.fingerprintRef,
    baseBranch: input.baseBranch,
    baseCommit: failure.baseCommit,
    issueBranch: input.issueBranch,
    issueCommit,
    conflictPaths,
    mergeMessages: failure.mergeMessages.slice(0, MAX_MERGE_MESSAGES),
    mergeHead,
    conflictStages,
    preparedFingerprint,
  };
  return {
    recovery: { version: 1, kind: "MERGE_CONFLICT", session },
    context: await conflictContext(input.worktreePath, session),
  };
}

async function conflictContext(
  worktreePath: string,
  session: GitMergeRecoverySession,
): Promise<WorkspaceFinalizationRecoveryContext> {
  return {
    fingerprintRef: session.fingerprintRef,
    workspaceStatus: await readGitWorkspaceStatus(worktreePath),
    fingerprintSummary: `prepared merge with ${session.conflictPaths.length} conflict path(s)`,
    recoveryKind: "MERGE_CONFLICT",
    merge: {
      kind: "MERGE_CONFLICT",
      baseBranch: session.baseBranch,
      baseCommit: session.baseCommit,
      issueBranch: session.issueBranch,
      issueCommit: session.issueCommit,
      conflictPaths: session.conflictPaths,
      mergeMessages: session.mergeMessages,
      mergePrepared: true,
    },
  };
}

function parseUnmergedPaths(value: string): string[] {
  return [...new Set(value.split("\0").flatMap((entry) => {
    const separator = entry.indexOf("\t");
    return separator === -1 ? [] : [entry.slice(separator + 1)];
  }))].sort().slice(0, MAX_CONFLICT_PATHS);
}

export function parseMergeTreeConflictOutput(
  stdout: string,
  stderr: string,
): ParsedMergeConflictOutput {
  const conflictPaths = new Set<string>();
  const mergeMessages: string[] = [];
  for (const rawLine of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const line = stripControlCharacters(rawLine).trim();
    if (!line || (!line.startsWith("CONFLICT (") && !line.startsWith("Auto-merging "))) {
      continue;
    }
    if (mergeMessages.length < MAX_MERGE_MESSAGES) {
      mergeMessages.push(line.slice(0, MAX_MERGE_MESSAGE_LENGTH));
    }
    const candidate = line.startsWith("Auto-merging ")
      ? line.slice("Auto-merging ".length)
      : line.match(/: Merge conflict in (.+)$/)?.[1];
    const path = candidate === undefined ? undefined : safeRepositoryPath(candidate);
    if (path && conflictPaths.size < MAX_CONFLICT_PATHS) conflictPaths.add(path);
  }
  return {
    conflictPaths: [...conflictPaths].sort(),
    mergeMessages,
  };
}

function safeRepositoryPath(value: string): string | undefined {
  const path = value.trim();
  if (!path || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return undefined;
  const segments = path.split(/[\\/]/);
  if (segments.includes("..") || segments.includes(".")) return undefined;
  return path;
}

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || (code >= 32 && code !== 127);
    })
    .join("");
}
import type {
  FinalizationRecoveryMergeContext,
  WorkspaceFinalizationDiagnostic,
} from "@oh-my-bug/core";
import type { WorkspaceFinalizationRecoveryContext } from "@oh-my-bug/module-api";

import {
  captureGitFinalizationFingerprint,
  readGitWorkspaceStatus,
  type GitFinalizationFingerprint,
} from "./finalization-recovery.js";
import { GitCommandError, runGit, tryRunGit } from "./git-client.js";
