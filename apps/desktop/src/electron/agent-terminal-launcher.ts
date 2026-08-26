import { execFile as nodeExecFile } from "node:child_process";
import { isAbsolute } from "node:path";

import type { AgentTerminalLaunchTarget } from "@oh-my-bug/runtime/protocol";

interface AgentTerminalLauncherDependencies {
  platform: NodeJS.Platform;
  execFile(file: string, args: string[]): Promise<void>;
}

const terminalScript = `on run argv
  set codexPath to item 1 of argv
  set threadId to item 2 of argv
  set remoteUrl to item 3 of argv
  set workingDirectory to item 4 of argv
  set terminalCommand to "cd " & quoted form of workingDirectory & " && exec " & quoted form of codexPath & " resume " & quoted form of threadId & " --remote " & quoted form of remoteUrl
  tell application "Terminal"
    activate
    do script terminalCommand
  end tell
end run`;

export async function openAgentTerminal(
  target: AgentTerminalLaunchTarget,
  dependencies: AgentTerminalLauncherDependencies = {
    platform: process.platform,
    execFile: executeFile,
  },
): Promise<{ opened: true }> {
  if (dependencies.platform !== "darwin") throw new Error("AGENT_TERMINAL_UNSUPPORTED");
  if (!validTarget(target)) throw new Error("AGENT_TERMINAL_TARGET_INVALID");
  try {
    await dependencies.execFile("/usr/bin/osascript", [
      "-e",
      terminalScript,
      "--",
      target.executablePath,
      target.providerThreadId,
      target.remoteUrl,
      target.workingDirectory,
    ]);
    return { opened: true };
  } catch (error) {
    throw new Error("AGENT_TERMINAL_OPEN_FAILED", { cause: error });
  }
}

function validTarget(target: AgentTerminalLaunchTarget): boolean {
  if (
    target.agent !== "codex" ||
    !validThreadId(target.providerThreadId) ||
    !safeAbsolutePath(target.executablePath) ||
    !safeAbsolutePath(target.workingDirectory) ||
    !target.remoteUrl.startsWith("unix://")
  ) return false;
  return safeAbsolutePath(target.remoteUrl.slice("unix://".length));
}

function validThreadId(value: string): boolean {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

function safeAbsolutePath(value: string): boolean {
  return value.length > 0 && value.length <= 4_096 && !value.includes("\0") && isAbsolute(value);
}

function executeFile(file: string, args: string[]): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    nodeExecFile(file, args, (error) => error ? rejectPromise(error) : resolvePromise());
  });
}
