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
    cause: unknown,
  ) {
    super("GIT_AUTO_MERGE_CONFLICT", { cause });
    this.name = "GitAutomaticMergeConflictError";
  }
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
