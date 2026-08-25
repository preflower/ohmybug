import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

import type {
  WorkspaceFinalizationDiagnostic,
  WorkspaceFinalizationStep,
} from "@oh-my-bug/core";
import type {
  WorkspaceFinalizationRecoveryContext,
  WorkspaceFinalizationRecoveryValidation,
} from "@oh-my-bug/module-api";

import {
  GitCommandError,
  runGit,
  sanitizeGitDiagnosticText,
  tryRunGit,
  type RunGitOptions,
} from "./git-client.js";
import { GitAutomaticMergeConflictError } from "./merge-recovery.js";

export interface ContentFingerprint {
  path: string;
  kind: "file" | "symlink" | "directory" | "missing";
  mode: number;
  hash: string;
}

interface DiagnosticRootFingerprint {
  path: string;
  entirelyUntracked: boolean;
}

export interface GitFinalizationFingerprint {
  fingerprintRef: string;
  attemptId: string;
  head: string;
  headRef: string;
  index: string;
  indexFlags: string;
  repositoryStateHash: string;
  tracked: ContentFingerprint[];
  untracked: ContentFingerprint[];
  diagnosticEntries: ContentFingerprint[];
  diagnosticRoots: DiagnosticRootFingerprint[];
}

export class WorkspaceFinalizationError extends Error {
  constructor(
    readonly diagnostic: WorkspaceFinalizationDiagnostic,
    cause?: unknown,
  ) {
    super(diagnostic.code, { cause });
    this.name = "WorkspaceFinalizationError";
  }
}

class GeneratedArtifactsPresentError extends Error {
  constructor(readonly relatedPaths: string[]) {
    super("GIT_GENERATED_ARTIFACTS_PRESENT");
    this.name = "GeneratedArtifactsPresentError";
  }
}

export function finalizationError(input: {
  error: unknown;
  providerId: string;
  step: WorkspaceFinalizationStep;
  worktreePath: string;
}): WorkspaceFinalizationError {
  if (input.error instanceof WorkspaceFinalizationError) return input.error;
  const commandError = input.error instanceof GitCommandError ? input.error : undefined;
  const generatedArtifactsError = input.error instanceof GeneratedArtifactsPresentError
    ? input.error
    : undefined;
  const mergeConflictError = input.error instanceof GitAutomaticMergeConflictError
    ? input.error
    : undefined;
  const rawMessage = input.error instanceof Error
    ? input.error.message
    : "WORKSPACE_PUBLISH_FAILED";
  const code = mergeConflictError?.message
    ?? commandError?.message
    ?? generatedArtifactsError?.message
    ?? (/^[A-Z][A-Z0-9_:.-]{0,199}$/.test(rawMessage)
      ? rawMessage
      : "WORKSPACE_PUBLISH_FAILED");
  const stderr = commandError?.stderr || undefined;
  const message = sanitizeGitDiagnosticText(
    stderr?.split(/\r?\n/, 1)[0] || rawMessage,
    input.worktreePath,
    4_000,
  ) || code;
  return new WorkspaceFinalizationError({
    providerId: input.providerId,
    step: input.step,
    code: boundedText(code, 200),
    ...(commandError?.exitCode === undefined ? {} : { exitCode: commandError.exitCode }),
    message,
    ...(stderr ? { stderr: boundedText(stderr, 8_000) } : {}),
    relatedPaths: mergeConflictError?.conflictPaths
      ?? generatedArtifactsError?.relatedPaths
      ?? relatedPaths(stderr ?? code, input.worktreePath),
  }, input.error);
}

export async function prepareGitFinalizationRecovery(input: {
  worktreePath: string;
  diagnostic: WorkspaceFinalizationDiagnostic;
  attemptId: string;
  fingerprintRef: string;
}): Promise<{
  fingerprint: GitFinalizationFingerprint;
  context: WorkspaceFinalizationRecoveryContext;
}> {
  assertRecoverableGitDiagnostic(input.diagnostic);
  const fingerprint = await captureGitFinalizationFingerprint({
    worktreePath: input.worktreePath,
    diagnosticPaths: input.diagnostic.relatedPaths,
    fingerprintRef: input.fingerprintRef,
    attemptId: input.attemptId,
  });
  const workspaceStatus = boundedText(await readGitWorkspaceStatus(input.worktreePath), 8_000);
  return {
    fingerprint,
    context: {
      fingerprintRef: input.fingerprintRef,
      workspaceStatus,
      recoveryKind: "GENERATED_ARTIFACT_CLEANUP",
      fingerprintSummary: [
        `${fingerprint.tracked.length} tracked paths`,
        `${fingerprint.untracked.length} approved untracked paths`,
        `${fingerprint.diagnosticRoots.length} diagnostic roots`,
        `generated roots: ${JSON.stringify(fingerprint.diagnosticRoots.map((root) => root.path))}`,
      ].join(", "),
    },
  };
}

export async function validateGitFinalizationRecovery(input: {
  worktreePath: string;
  fingerprint: GitFinalizationFingerprint;
}): Promise<WorkspaceFinalizationRecoveryValidation> {
  const before = input.fingerprint;
  const current = await captureGitFinalizationFingerprint({
    worktreePath: input.worktreePath,
    diagnosticPaths: before.diagnosticRoots.map((root) => root.path),
    fingerprintRef: before.fingerprintRef,
    attemptId: before.attemptId,
  });
  if (current.head !== before.head) {
    return unsafe("FINALIZATION_RECOVERY_HEAD_CHANGED");
  }
  if (current.headRef !== before.headRef) {
    return unsafe("FINALIZATION_RECOVERY_HEAD_REF_CHANGED");
  }
  if (current.index !== before.index) {
    return unsafe("FINALIZATION_RECOVERY_INDEX_CHANGED");
  }
  if (current.indexFlags !== before.indexFlags) {
    return unsafe("FINALIZATION_RECOVERY_INDEX_FLAGS_CHANGED");
  }
  if (current.repositoryStateHash !== before.repositoryStateHash) {
    return unsafe("FINALIZATION_RECOVERY_REPOSITORY_STATE_CHANGED");
  }
  if (before.diagnosticRoots.some((root) => !root.entirelyUntracked)) {
    return unsafe("FINALIZATION_RECOVERY_DIAGNOSTIC_ROOT_TRACKED");
  }
  const trackedChanges = changedEntries(before.tracked, current.tracked);
  if (trackedChanges.length > 0) {
    return { kind: "CHANGED", changedPaths: trackedChanges };
  }
  const untrackedChanges = changedEntries(before.untracked, current.untracked);
  const beforeUntracked = new Set(before.untracked.map((entry) => entry.path));
  const newPaths = current.untracked
    .map((entry) => entry.path)
    .filter((path) => !beforeUntracked.has(path));
  if (newPaths.length > 0) {
    return unsafe("FINALIZATION_RECOVERY_NEW_PATH", newPaths);
  }
  if (untrackedChanges.length > 0) {
    return { kind: "CHANGED", changedPaths: untrackedChanges };
  }
  if (current.diagnosticEntries.length > 0) {
    return unsafe(
      "FINALIZATION_RECOVERY_GENERATED_ARTIFACT_REMAINS",
      current.diagnosticEntries.map((entry) => entry.path),
    );
  }

  try {
    await assertPublicationPreflight(input.worktreePath);
  } catch (error) {
    const code = error instanceof Error ? error.message : "FINALIZATION_PREFLIGHT_FAILED";
    return unsafe(code);
  }
  return { kind: "UNCHANGED", changedPaths: [] };
}

export async function assertPublicationPreflight(worktreePath: string): Promise<void> {
  const untrackedPaths = splitNull(await runGit(worktreePath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]));
  const generatedRoots = collapseRoots(normalizePaths(
    untrackedPaths.flatMap(generatedRoot),
  ));
  if (generatedRoots.length > 0) {
    throw new GeneratedArtifactsPresentError(generatedRoots);
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "ohmybug-git-preflight-"));
  try {
    const indexPath = join(temporaryRoot, "index");
    const objectPath = join(temporaryRoot, "objects");
    await mkdir(objectPath);
    const commonDirectory = await runGit(worktreePath, ["rev-parse", "--git-common-dir"]);
    const commonPath = isAbsolute(commonDirectory)
      ? commonDirectory
      : resolve(worktreePath, commonDirectory);
    const options: RunGitOptions = {
      env: {
        GIT_INDEX_FILE: indexPath,
        GIT_OBJECT_DIRECTORY: objectPath,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: join(commonPath, "objects"),
      },
    };
    await runGit(worktreePath, ["read-tree", "HEAD"], options);
    await runGit(worktreePath, ["add", "-A"], options);
    await assertNoUndeclaredGitlinks(worktreePath, options);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function captureGitFinalizationFingerprint(input: {
  worktreePath: string;
  diagnosticPaths: string[];
  fingerprintRef: string;
  attemptId: string;
}): Promise<GitFinalizationFingerprint> {
  const trackedPaths = splitNull(await runGit(input.worktreePath, ["ls-files", "-z"]));
  const allUntrackedPaths = splitNull(await runGit(input.worktreePath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]));
  const diagnosticRoots = collapseRoots(normalizePaths([
    ...input.diagnosticPaths.flatMap(generatedRoot),
    ...allUntrackedPaths.flatMap(generatedRoot),
  ]));
  const untrackedPaths = allUntrackedPaths
    .filter((path) => !diagnosticRoots.some((root) => withinRoot(path, root)));
  const diagnosticPaths = allUntrackedPaths
    .filter((path) => diagnosticRoots.some((root) => withinRoot(path, root)));
  const trackedSet = new Set(trackedPaths);
  return {
    fingerprintRef: input.fingerprintRef,
    attemptId: input.attemptId,
    head: await runGit(input.worktreePath, ["rev-parse", "HEAD"]),
    headRef: await tryRunGit(
      input.worktreePath,
      ["symbolic-ref", "-q", "HEAD"],
      [1],
    ) ?? "DETACHED",
    index: await runGit(input.worktreePath, ["ls-files", "--stage", "-z"]),
    indexFlags: await runGit(input.worktreePath, ["ls-files", "-v", "-z"]),
    repositoryStateHash: await repositoryStateHash(input.worktreePath),
    tracked: await Promise.all(trackedPaths.map((path) => fingerprintPath(
      input.worktreePath,
      path,
    ))),
    untracked: await Promise.all(untrackedPaths.map((path) => fingerprintPath(
      input.worktreePath,
      path,
    ))),
    diagnosticEntries: await Promise.all(diagnosticPaths.map((path) => fingerprintPath(
      input.worktreePath,
      path,
    ))),
    diagnosticRoots: diagnosticRoots.map((path) => ({
      path,
      entirelyUntracked: ![...trackedSet].some((tracked) => withinRoot(tracked, path)),
    })),
  };
}

async function repositoryStateHash(worktreePath: string): Promise<string> {
  const [configuration, refs] = await Promise.all([
    runGit(worktreePath, ["config", "--local", "--null", "--list"]),
    runGit(worktreePath, [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)",
      "refs/heads",
      "refs/remotes",
    ]),
  ]);
  return digest(`${configuration}\0${refs}`);
}

function assertRecoverableGitDiagnostic(
  diagnostic: WorkspaceFinalizationDiagnostic,
): void {
  const generatedRoots = diagnostic.relatedPaths.flatMap(generatedRoot);
  if (diagnostic.step !== "add" || generatedRoots.length === 0) {
    throw new Error("FINALIZATION_RECOVERY_DIAGNOSTIC_UNSUPPORTED");
  }
}

async function fingerprintPath(
  worktreePath: string,
  path: string,
): Promise<ContentFingerprint> {
  try {
    const stats = await lstat(join(worktreePath, path));
    const mode = stats.mode & 0o7777;
    if (stats.isSymbolicLink()) {
      return {
        path,
        kind: "symlink",
        mode,
        hash: digest(await readlink(join(worktreePath, path))),
      };
    }
    if (stats.isFile()) {
      return {
        path,
        kind: "file",
        mode,
        hash: digest(await readFile(join(worktreePath, path))),
      };
    }
    if (stats.isDirectory() && await hasGitMetadata(join(worktreePath, path))) {
      const head = await tryRunGit(join(worktreePath, path), ["rev-parse", "HEAD"], [128]);
      if (!head) return { path, kind: "directory", mode, hash: digest("UNBORN") };
      const status = await readGitWorkspaceStatus(join(worktreePath, path));
      return { path, kind: "directory", mode, hash: digest(`${head}\0${status}`) };
    }
    return { path, kind: "directory", mode, hash: "" };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { path, kind: "missing", mode: 0, hash: "" };
    }
    throw error;
  }
}

async function hasGitMetadata(path: string): Promise<boolean> {
  try {
    await lstat(join(path, ".git"));
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function readGitWorkspaceStatus(worktreePath: string): Promise<string> {
  return runGit(worktreePath, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
}

async function assertNoUndeclaredGitlinks(
  worktreePath: string,
  options: RunGitOptions,
): Promise<void> {
  const entries = await runGit(worktreePath, ["ls-files", "--stage", "-z"], options);
  const gitlinks = entries.split("\0").flatMap((entry) => {
    const separator = entry.indexOf("\t");
    if (separator === -1) return [];
    const [mode, , stage] = entry.slice(0, separator).split(" ");
    return mode === "160000" && stage === "0" ? [entry.slice(separator + 1)] : [];
  });
  if (gitlinks.length === 0) return;
  const mappings = await tryRunGit(
    worktreePath,
    ["config", "-z", "--blob", ":.gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
    [1],
    options,
  );
  const declaredPaths = new Set(
    mappings?.split("\0").flatMap((mapping) => {
      const separator = mapping.indexOf("\n");
      return separator === -1 ? [] : [mapping.slice(separator + 1)];
    }) ?? [],
  );
  if (gitlinks.some((path) => !declaredPaths.has(path))) {
    throw new Error("GIT_EMBEDDED_REPOSITORY_NOT_ALLOWED");
  }
}

function changedEntries(
  beforeEntries: ContentFingerprint[],
  afterEntries: ContentFingerprint[],
): string[] {
  const before = new Map(beforeEntries.map((entry) => [entry.path, entry]));
  const after = new Map(afterEntries.map((entry) => [entry.path, entry]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => JSON.stringify(before.get(path)) !== JSON.stringify(after.get(path)))
    .sort();
}

function relatedPaths(value: string, worktreePath: string): string[] {
  const candidates = [...value.matchAll(/['"]([^'"\r\n]+)['"]/g)]
    .map((match) => match[1] ?? "")
    .filter((candidate) => candidate.includes("/") || candidate.includes("\\"));
  return normalizePaths(candidates.map((candidate) => {
    const path = isAbsolute(candidate) ? relative(worktreePath, candidate) : candidate;
    return path.replace(/^\.\//, "").replace(/[\\/]$/, "");
  })).slice(0, 50);
}

function normalizePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.trim().replace(/[\\/]$/, "")))]
    .filter((path) => path.length > 0)
    .filter((path) => !isAbsolute(path))
    .filter((path) => !path.split(/[\\/]/).includes(".."))
    .sort();
}

function generatedRoot(path: string): string[] {
  const segments = path.split(/[\\/]/);
  const index = segments.findIndex((segment) =>
    segment === ".pnpm-store" || segment.startsWith(".oh-my-bug-tmp-"));
  return index === -1 ? [] : [segments.slice(0, index + 1).join("/")];
}

function collapseRoots(paths: string[]): string[] {
  return paths.filter((path, index) =>
    !paths.some((candidate, candidateIndex) =>
      candidateIndex !== index && candidate.length < path.length && withinRoot(path, candidate)));
}

function withinRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`);
}

function splitNull(value: string): string[] {
  return value.split("\0").filter(Boolean).sort();
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedText(value: string, max: number): string {
  return stripControlCharacters(value)
    .slice(0, max)
    .trim();
}

function stripControlCharacters(value: string): string {
  return [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
}

function unsafe(
  reason: string,
  changedPaths: string[] = [],
): WorkspaceFinalizationRecoveryValidation {
  return { kind: "UNSAFE", changedPaths: [...changedPaths].sort(), reason };
}
