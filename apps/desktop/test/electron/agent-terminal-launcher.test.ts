import { describe, expect, it, vi } from "vitest";

import { openAgentTerminal } from "../../src/electron/agent-terminal-launcher.js";

const target = {
  agent: "codex" as const,
  providerThreadId: "0198e8dc-6de0-7c10-81ce-6c6544bc1bf7",
  executablePath: "/Applications/O'My Bug $(touch nope)/codex\\bin",
  remoteUrl: "unix:///Users/test/Library/Application Support/Oh My Bug/run/socket;nope",
  workingDirectory: "/Users/test/Work/quote' \\ $(touch nope); repo",
  permissionMode: "auto-review" as const,
};

describe("Agent Terminal launcher", () => {
  it("passes untrusted-looking values only as argv to one fixed AppleScript", async () => {
    const execFile = vi.fn(async (_file: string, _args: string[]) => undefined);

    await expect(openAgentTerminal(target, { platform: "darwin", execFile })).resolves
      .toEqual({ opened: true });

    expect(execFile).toHaveBeenCalledOnce();
    const [file, args] = execFile.mock.calls[0]!;
    expect(file).toBe("/usr/bin/osascript");
    expect(args.slice(-6)).toEqual([
      "--",
      target.executablePath,
      target.providerThreadId,
      target.remoteUrl,
      target.workingDirectory,
      target.permissionMode,
    ]);
    expect(args[1]).not.toContain(target.executablePath);
    expect(args[1]).not.toContain(target.workingDirectory);
    expect(args[1]).toContain("quoted form of workingDirectory");
    expect(args[1]).toContain("codexPath & permissionArguments & \" resume \"");
    expect(args[1]).toContain("--approve-for-me");
  });

  it.each([
    ["request-approval", "--sandbox workspace-write --ask-for-approval on-request", "approvals_reviewer=user"],
    ["auto-review", "--approve-for-me", undefined],
    ["full-access", "--dangerously-bypass-approvals-and-sandbox", undefined],
  ] as const)("maps %s to fixed Codex CLI arguments", async (permissionMode, flag, reviewer) => {
    const execFile = vi.fn(async (_file: string, _args: string[]) => undefined);

    await openAgentTerminal({ ...target, permissionMode }, { platform: "darwin", execFile });

    const script = execFile.mock.calls[0]![1][1]!;
    expect(script).toContain(flag);
    if (reviewer) expect(script).toContain(reviewer);
  });

  it("rejects unsupported platforms and malformed private targets before execution", async () => {
    const execFile = vi.fn(async (_file: string, _args: string[]) => undefined);
    await expect(openAgentTerminal(target, { platform: "linux", execFile }))
      .rejects.toThrow("AGENT_TERMINAL_UNSUPPORTED");
    await expect(openAgentTerminal({ ...target, executablePath: "relative/codex" }, {
      platform: "darwin",
      execFile,
    })).rejects.toThrow("AGENT_TERMINAL_TARGET_INVALID");
    await expect(openAgentTerminal({ ...target, remoteUrl: "ws://127.0.0.1:9999" }, {
      platform: "darwin",
      execFile,
    })).rejects.toThrow("AGENT_TERMINAL_TARGET_INVALID");
    await expect(openAgentTerminal({ ...target, permissionMode: "root" as never }, {
      platform: "darwin",
      execFile,
    })).rejects.toThrow("AGENT_TERMINAL_TARGET_INVALID");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("maps osascript failure without exposing its details", async () => {
    const execFile = vi.fn(async (_file: string, _args: string[]) => {
      throw new Error("secret path and AppleScript detail");
    });

    const error = await openAgentTerminal(target, { platform: "darwin", execFile })
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("AGENT_TERMINAL_OPEN_FAILED");
    expect((error as Error).message).not.toContain("secret path");
  });
});
