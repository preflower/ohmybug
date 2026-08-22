import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`GIT_COMMAND_FAILED:${args[0] ?? "unknown"}`, { cause: error });
  }
}

export async function gitRefExists(repositoryPath: string, ref: string): Promise<boolean> {
  try {
    await runGit(repositoryPath, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}
