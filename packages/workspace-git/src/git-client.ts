import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RunGitOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  nonInteractive?: boolean;
  env?: NodeJS.ProcessEnv;
}

export class GitCommandError extends Error {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode?: number;
  readonly stderr: string;

  constructor(input: {
    cwd: string;
    args: readonly string[];
    cause: unknown;
  }) {
    const command = input.args[0] ?? "unknown";
    super(`GIT_COMMAND_FAILED:${command}`, { cause: input.cause });
    this.name = "GitCommandError";
    this.command = command;
    this.args = [...input.args];
    this.exitCode = numericProperty(input.cause, "code");
    this.stderr = sanitizeGitDiagnosticText(
      stringProperty(input.cause, "stderr"),
      input.cwd,
      8_000,
    );
  }
}

export async function runGit(
  cwd: string,
  args: readonly string[],
  options: RunGitOptions = {},
): Promise<string> {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.nonInteractive || options.env
        ? {
            env: {
              ...process.env,
              ...options.env,
              ...(options.nonInteractive ? {
              GCM_INTERACTIVE: "Never",
              GIT_TERMINAL_PROMPT: "0",
              SSH_ASKPASS_REQUIRE: "never",
              } : {}),
            },
          }
        : {}),
    });
    return result.stdout.trim();
  } catch (error) {
    throw new GitCommandError({ cwd, args, cause: error });
  }
}

export async function tryRunGit(
  cwd: string,
  args: readonly string[],
  allowedExitCodes: readonly number[] = [1],
  options: RunGitOptions = {},
): Promise<string | undefined> {
  try {
    return await runGit(cwd, args, options);
  } catch (error) {
    if (
      error instanceof GitCommandError
      && error.exitCode !== undefined
      && allowedExitCodes.includes(error.exitCode)
    ) {
      return undefined;
    }
    const cause = error instanceof Error ? error.cause : undefined;
    const code = cause && typeof cause === "object" && "code" in cause
      ? cause.code
      : undefined;
    if (typeof code === "number" && allowedExitCodes.includes(code)) {
      return undefined;
    }
    throw error;
  }
}

function numericProperty(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "number" ? property : undefined;
}

function stringProperty(value: unknown, key: string): string {
  if (!value || typeof value !== "object" || !(key in value)) return "";
  const property = (value as Record<string, unknown>)[key];
  if (typeof property === "string") return property;
  return property instanceof Uint8Array ? Buffer.from(property).toString("utf8") : "";
}

const secretAssignment = /((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)\s*[=:]\s*)([^\s"'&]+)/gi;
const bearerToken = /(bearer\s+)([^\s"']+)/gi;
const posixAbsolutePath = /(^|[\s"'(])\/(?:Users|home|private|tmp|var|Volumes|opt)\/[^\s"'<>]*/gm;
const windowsAbsolutePath = /(^|[\s"'(])[A-Za-z]:[\\/][^\s"'<>]*/gm;

export function sanitizeGitDiagnosticText(
  value: string,
  cwd: string,
  maxLength: number,
): string {
  return stripControlCharacters(value
    .replaceAll(cwd, "<workspace>")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1")
    .replace(secretAssignment, "$1[REDACTED]")
    .replace(bearerToken, "$1[REDACTED]")
    .replace(posixAbsolutePath, "$1<absolute-path>")
    .replace(windowsAbsolutePath, "$1<absolute-path>")
  )
    .slice(0, maxLength)
    .trim();
}

function stripControlCharacters(value: string): string {
  return [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
}

export async function gitRefExists(repositoryPath: string, ref: string): Promise<boolean> {
  try {
    await runGit(repositoryPath, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}
