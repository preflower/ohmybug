import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RunGitOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  nonInteractive?: boolean;
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
    this.stderr = sanitizeStderr(stringProperty(input.cause, "stderr"), input.cwd);
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
      ...(options.nonInteractive
        ? {
            env: {
              ...process.env,
              GCM_INTERACTIVE: "Never",
              GIT_TERMINAL_PROMPT: "0",
              SSH_ASKPASS_REQUIRE: "never",
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
): Promise<string | undefined> {
  try {
    return await runGit(cwd, args);
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

function sanitizeStderr(stderr: string, cwd: string): string {
  return stderr
    .replaceAll(cwd, "<workspace>")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, 8_000)
    .trim();
}

export async function gitRefExists(repositoryPath: string, ref: string): Promise<boolean> {
  try {
    await runGit(repositoryPath, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}
