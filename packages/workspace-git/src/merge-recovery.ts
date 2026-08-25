import { copyFile, lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type {
  FinalizationRecoveryMergeContext,
  FinalizationRecoveryResult,
  WorkspaceFinalizationDiagnostic,
} from "@oh-my-bug/core";
import type {
  WorkspaceFinalizationRecoveryContext,
  WorkspaceFinalizationRecoveryValidation,
} from "@oh-my-bug/module-api";
import { z } from "zod";

import {
  assertPublicationPreflight,
  captureGitFinalizationFingerprint,
  readGitWorkspaceStatus,
  type GitFinalizationFingerprint,
} from "./finalization-recovery.js";
import { GitCommandError, runGit, tryRunGit } from "./git-client.js";

const MAX_CONFLICT_PATHS = 50;
const MAX_MERGE_MESSAGES = 20;
const MAX_MERGE_MESSAGE_LENGTH = 1_000;

const repositoryPathSchema = z.string().refine(
  (value) => safeRepositoryPath(value) === value,
  "GIT_MERGE_RECOVERY_PATH_INVALID",
);
const contentFingerprintSchema = z.object({
  path: repositoryPathSchema,
  kind: z.enum(["file", "symlink", "directory", "missing"]),
  mode: z.number().int().nonnegative(),
  hash: z.string(),
});
const finalizationFingerprintSchema = z.object({
  fingerprintRef: z.string().min(1),
  attemptId: z.string().min(1),
  head: z.string().min(1),
  headRef: z.string().min(1),
  index: z.string(),
  indexFlags: z.string(),
  repositoryStateHash: z.string().min(1),
  tracked: z.array(contentFingerprintSchema),
  untracked: z.array(contentFingerprintSchema),
  diagnosticEntries: z.array(contentFingerprintSchema),
  diagnosticRoots: z.array(z.object({
    path: repositoryPathSchema,
    entirelyUntracked: z.boolean(),
  })),
});
const mergeContextSchema = z.object({
  kind: z.enum(["MERGE_CONFLICT", "MERGE_ENVIRONMENT"]),
  baseBranch: z.string().min(1),
  baseCommit: z.string().min(1).optional(),
  issueBranch: z.string().min(1),
  issueCommit: z.string().min(1),
  conflictPaths: z.array(repositoryPathSchema).max(MAX_CONFLICT_PATHS),
  mergeMessages: z.array(z.string().max(MAX_MERGE_MESSAGE_LENGTH)).max(MAX_MERGE_MESSAGES),
  mergePrepared: z.boolean(),
});
const mergeSessionSchema = z.object({
  version: z.literal(1),
  attemptId: z.string().min(1),
  fingerprintRef: z.string().min(1),
  baseBranch: z.string().min(1),
  baseCommit: z.string().min(1),
  issueBranch: z.string().min(1),
  issueCommit: z.string().min(1),
  conflictPaths: z.array(repositoryPathSchema).min(1).max(MAX_CONFLICT_PATHS),
  mergeMessages: z.array(z.string().max(MAX_MERGE_MESSAGE_LENGTH)).max(MAX_MERGE_MESSAGES),
  mergeHead: z.string().min(1),
  conflictStages: z.string().min(1),
  preparedFingerprint: finalizationFingerprintSchema,
  candidateTree: z.string().min(1).optional(),
  validatedPaths: z.array(repositoryPathSchema).min(1).max(MAX_CONFLICT_PATHS).optional(),
  mergeCommit: z.string().min(1).optional(),
}).refine(
  (session) => (session.candidateTree === undefined) === (session.validatedPaths === undefined),
  "GIT_MERGE_RECOVERY_CANDIDATE_INVALID",
);
const finalizationRecoveryStateSchema = z.discriminatedUnion("kind", [
  z.object({
    version: z.literal(1),
    kind: z.literal("GENERATED_ARTIFACT_CLEANUP"),
    fingerprint: finalizationFingerprintSchema,
  }),
  z.object({
    version: z.literal(1),
    kind: z.literal("MERGE_CONFLICT"),
    session: mergeSessionSchema,
  }),
  z.object({
    version: z.literal(1),
    kind: z.literal("MERGE_ENVIRONMENT"),
    fingerprint: finalizationFingerprintSchema,
    merge: mergeContextSchema,
  }),
]);

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
  mergeCommit?: string;
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
  value: unknown,
): GitFinalizationRecoveryState | undefined {
  if (!value) return undefined;
  const parsed = typeof value === "object" && value !== null && "version" in value
    ? finalizationRecoveryStateSchema.safeParse(value)
    : finalizationFingerprintSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("GIT_MERGE_RECOVERY_STATE_INVALID", { cause: parsed.error });
  }
  return "version" in parsed.data
    ? parsed.data as GitFinalizationRecoveryState
    : {
        version: 1,
        kind: "GENERATED_ARTIFACT_CLEANUP",
        fingerprint: parsed.data as GitFinalizationFingerprint,
      };
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

export async function validateGitMergeRecovery(input: {
  worktreePath: string;
  session: GitMergeRecoverySession;
  result: FinalizationRecoveryResult;
}): Promise<WorkspaceFinalizationRecoveryValidation> {
  const { session } = input;
  const invariants = await inspectMergeSessionInvariants(input.worktreePath, session);
  if (invariants.validation) return invariants.validation;
  const current = invariants.fingerprint;
  const changedTracked = changedContent(
    session.preparedFingerprint.tracked,
    current.tracked,
  );
  const changedUntracked = [
    ...changedContent(session.preparedFingerprint.untracked, current.untracked),
    ...changedContent(
      session.preparedFingerprint.diagnosticEntries,
      current.diagnosticEntries,
    ),
  ];
  if (changedUntracked.length > 0) {
    return unsafe("GIT_MERGE_RECOVERY_UNTRACKED_CHANGED", changedUntracked);
  }
  const allowedPaths = new Set(session.conflictPaths);
  const outOfScope = changedTracked.filter((path) => !allowedPaths.has(path));
  if (outOfScope.length > 0) {
    return unsafe("GIT_MERGE_RECOVERY_OUT_OF_SCOPE", outOfScope);
  }
  for (const path of session.conflictPaths) {
    const conflictModes = indexModesForPath(session.conflictStages, path);
    if (
      conflictModes.length === 0
      || conflictModes.some((mode) => mode !== "100644" && mode !== "100755")
    ) {
      return unsafe("GIT_MERGE_RECOVERY_FILE_TYPE_INVALID", [path]);
    }
    let content: Buffer;
    try {
      const absolutePath = join(input.worktreePath, path);
      const stats = await lstat(absolutePath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        return unsafe("GIT_MERGE_RECOVERY_FILE_TYPE_INVALID", [path]);
      }
      content = await readFile(absolutePath);
    } catch {
      return unsafe("GIT_MERGE_RECOVERY_CONFLICT_PATH_MISSING", [path]);
    }
    if (content.includes(0) || hasConflictMarkers(content.toString("utf8"))) {
      return unsafe("GIT_MERGE_RECOVERY_CONFLICT_MARKERS", [path]);
    }
  }

  try {
    await assertPublicationPreflight(input.worktreePath);
  } catch (error) {
    return unsafe(error instanceof Error ? error.message : "GIT_MERGE_RECOVERY_PREFLIGHT_FAILED");
  }
  try {
    const paths = [...allowedPaths].sort();
    session.candidateTree = await resolvedTreeFromTemporaryIndex(input.worktreePath, paths);
    session.validatedPaths = paths;
  } catch (error) {
    return unsafe(error instanceof Error ? error.message : "GIT_MERGE_RECOVERY_TREE_INVALID");
  }
  return { kind: "CHANGED", changedPaths: [...new Set(changedTracked)].sort() };
}

export async function finalizeGitMergeRecovery(input: {
  worktreePath: string;
  baseRef: string;
  session: GitMergeRecoverySession;
}): Promise<string> {
  const { session } = input;
  if (session.mergeCommit) {
    const head = await runGit(input.worktreePath, ["rev-parse", "HEAD"]);
    if (head === session.mergeCommit) return head;
    throw new Error("GIT_MERGE_RECOVERY_HEAD_CHANGED");
  }
  if (!session.candidateTree || !session.validatedPaths) {
    throw new Error("GIT_MERGE_RECOVERY_NOT_VALIDATED");
  }
  const baseCommit = await tryRunGit(input.worktreePath, ["rev-parse", input.baseRef], [128]);
  if (baseCommit !== session.baseCommit) throw new Error("GIT_AUTO_MERGE_BASE_MOVED");
  const invariants = await inspectMergeSessionInvariants(input.worktreePath, session);
  if (invariants.validation) throw new Error(invariants.validation.reason);
  await assertPublicationPreflight(input.worktreePath);
  const candidate = await resolvedTreeFromTemporaryIndex(
    input.worktreePath,
    session.validatedPaths,
  );
  if (candidate !== session.candidateTree) throw new Error("GIT_MERGE_RECOVERY_TREE_CHANGED");
  await runGit(input.worktreePath, [
    "add",
    "--",
    ...session.validatedPaths.map((path) => `:(literal)${path}`),
  ]);
  const tree = await runGit(input.worktreePath, ["write-tree"]);
  if (tree !== session.candidateTree) throw new Error("GIT_MERGE_RECOVERY_TREE_CHANGED");
  await runGit(input.worktreePath, [
    "commit",
    "-m",
    `Merge ${session.issueBranch} into ${session.baseBranch}`,
  ]);
  const commit = await runGit(input.worktreePath, ["rev-parse", "HEAD"]);
  const parents = (await runGit(input.worktreePath, [
    "show",
    "-s",
    "--format=%P",
    commit,
  ])).split(" ");
  if (parents[0] !== session.issueCommit || parents[1] !== session.baseCommit) {
    throw new Error("GIT_MERGE_RECOVERY_PARENTS_INVALID");
  }
  session.mergeCommit = commit;
  return commit;
}

async function inspectMergeSessionInvariants(
  worktreePath: string,
  session: GitMergeRecoverySession,
): Promise<{
  fingerprint: GitFinalizationFingerprint;
  validation?: WorkspaceFinalizationRecoveryValidation & { kind: "UNSAFE" };
}> {
  const [head, headRef, mergeHead, conflictStages, fingerprint] = await Promise.all([
    runGit(worktreePath, ["rev-parse", "HEAD"]),
    tryRunGit(worktreePath, ["symbolic-ref", "-q", "HEAD"], [1]),
    tryRunGit(worktreePath, ["rev-parse", "-q", "MERGE_HEAD"], [128]),
    runGit(worktreePath, ["ls-files", "-u", "-z"]),
    captureGitFinalizationFingerprint({
      worktreePath,
      diagnosticPaths: [],
      fingerprintRef: session.fingerprintRef,
      attemptId: session.attemptId,
    }),
  ]);
  const invalid = (reason: string) => ({ fingerprint, validation: unsafe(reason) as
    WorkspaceFinalizationRecoveryValidation & { kind: "UNSAFE" } });
  if (head !== session.issueCommit) return invalid("GIT_MERGE_RECOVERY_HEAD_CHANGED");
  if (headRef !== session.preparedFingerprint.headRef) {
    return invalid("GIT_MERGE_RECOVERY_HEAD_REF_CHANGED");
  }
  if (mergeHead !== session.baseCommit) {
    return invalid("GIT_MERGE_RECOVERY_MERGE_HEAD_CHANGED");
  }
  if (conflictStages !== session.conflictStages || fingerprint.index !== session.preparedFingerprint.index) {
    return invalid("GIT_MERGE_RECOVERY_INDEX_CHANGED");
  }
  if (fingerprint.indexFlags !== session.preparedFingerprint.indexFlags) {
    return invalid("GIT_MERGE_RECOVERY_INDEX_FLAGS_CHANGED");
  }
  if (fingerprint.repositoryStateHash !== session.preparedFingerprint.repositoryStateHash) {
    return invalid("GIT_MERGE_RECOVERY_REPOSITORY_STATE_CHANGED");
  }
  return { fingerprint };
}

function indexModesForPath(conflictStages: string, path: string): string[] {
  return conflictStages.split("\0").flatMap((entry) => {
    const separator = entry.indexOf("\t");
    if (separator === -1 || entry.slice(separator + 1) !== path) return [];
    const mode = entry.slice(0, separator).split(" ")[0];
    return mode ? [mode] : [];
  });
}

async function resolvedTreeFromTemporaryIndex(
  worktreePath: string,
  paths: string[],
): Promise<string> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ohmybug-merge-validation-"));
  try {
    const temporaryIndex = join(temporaryRoot, "index");
    const temporaryObjects = join(temporaryRoot, "objects");
    await mkdir(temporaryObjects);
    const realIndexValue = await runGit(worktreePath, ["rev-parse", "--git-path", "index"]);
    const realIndex = isAbsolute(realIndexValue)
      ? realIndexValue
      : resolve(worktreePath, realIndexValue);
    const commonDirectoryValue = await runGit(worktreePath, ["rev-parse", "--git-common-dir"]);
    const commonDirectory = isAbsolute(commonDirectoryValue)
      ? commonDirectoryValue
      : resolve(worktreePath, commonDirectoryValue);
    await copyFile(realIndex, temporaryIndex);
    const options = {
      env: {
        GIT_INDEX_FILE: temporaryIndex,
        GIT_OBJECT_DIRECTORY: temporaryObjects,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: join(commonDirectory, "objects"),
      },
    };
    await runGit(
      worktreePath,
      ["add", "--", ...paths.map((path) => `:(literal)${path}`)],
      options,
    );
    const unresolved = await runGit(worktreePath, ["ls-files", "-u", "-z"], options);
    if (unresolved) throw new Error("GIT_MERGE_RECOVERY_UNRESOLVED");
    return await runGit(worktreePath, ["write-tree"], options);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function changedContent(
  beforeEntries: GitFinalizationFingerprint["tracked"],
  afterEntries: GitFinalizationFingerprint["tracked"],
): string[] {
  const before = new Map(beforeEntries.map((entry) => [entry.path, entry]));
  const after = new Map(afterEntries.map((entry) => [entry.path, entry]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => JSON.stringify(before.get(path)) !== JSON.stringify(after.get(path)))
    .sort();
}

function hasConflictMarkers(value: string): boolean {
  return value.split(/\r?\n/).some((line) => /^(?:<{7}|={7}|>{7})(?:\s|$)/.test(line));
}

function unsafe(
  reason: string,
  changedPaths: string[] = [],
): WorkspaceFinalizationRecoveryValidation {
  return { kind: "UNSAFE", changedPaths: [...new Set(changedPaths)].sort(), reason };
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
