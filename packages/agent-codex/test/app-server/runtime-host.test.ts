import { describe, expect, it, vi } from "vitest";

import {
  CodexAppServerRuntimeHost,
  type AgentTerminalLaunchTarget,
} from "../../src/app-server/runtime-host.js";
import type { AppServerConnection } from "../../src/app-server/supervisor.js";
import type { CodexClient, CodexThread, CodexThreadOptions } from "../../src/codex-client.js";

const providerThreadId = "0198e8dc-6de0-7c10-81ce-6c6544bc1bf7";

describe("Codex App Server Runtime host", () => {
  it("starts once, exposes one plugin, and stops the server before temp cleanup", async () => {
    const order: string[] = [];
    const supervisor = fixtureSupervisor(order);
    const client = fixtureClient(order);
    const host = new CodexAppServerRuntimeHost({ dataRoot: "/data" }, {
      supervisor,
      createClient: () => client,
      validateSocket: () => true,
      validateDirectory: () => true,
    });

    await host.start();
    await host.start();
    await host.stop();
    await host.stop();

    expect(host.plugin.id).toBe("codex");
    expect(supervisor.start).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["server-stop", "client-dispose"]);
  });

  it("keeps startup failure non-fatal and reports bounded unavailability", async () => {
    const supervisor = fixtureSupervisor([]);
    supervisor.start.mockRejectedValueOnce(new Error("raw credential and socket detail"));
    const host = new CodexAppServerRuntimeHost({ dataRoot: "/data" }, {
      supervisor,
      createClient: () => fixtureClient([]),
      validateSocket: () => true,
      validateDirectory: () => true,
    });

    await expect(host.start()).resolves.toBeUndefined();
    expect(host.availability(context())).toEqual({
      available: false,
      reason: "APP_SERVER_UNAVAILABLE",
    });
  });

  it("returns only public reasons and keeps the launch target private", async () => {
    const supervisor = fixtureSupervisor([]);
    const host = new CodexAppServerRuntimeHost({ dataRoot: "/data" }, {
      supervisor,
      createClient: () => fixtureClient([]),
      validateSocket: () => true,
      validateDirectory: (path) => path === "/repo/worktree",
    });
    await host.start();

    expect(host.availability(context({ agent: "demo" }))).toEqual({
      available: false,
      reason: "UNSUPPORTED_AGENT",
    });
    expect(host.availability(context({ providerThreadId: undefined }))).toEqual({
      available: false,
      reason: "SESSION_NOT_READY",
    });
    expect(host.availability(context({ workingDirectory: undefined, workspaceReady: false })))
      .toEqual({ available: false, reason: "WORKSPACE_NOT_READY" });
    expect(host.availability(context())).toEqual({ available: true });

    const target = host.resolveLaunchTarget(context());
    expect(target).toEqual<AgentTerminalLaunchTarget>({
      agent: "codex",
      providerThreadId,
      executablePath: "/bin/codex",
      remoteUrl: "unix:///data/run/codex-app-server.sock",
      workingDirectory: "/repo/worktree",
    });
    expect(host.availability(context())).not.toHaveProperty("providerThreadId");
  });

  it("fails closed when target identity, socket ownership, or generation changes", async () => {
    let ownedSocket = true;
    const supervisor = fixtureSupervisor([]);
    const host = new CodexAppServerRuntimeHost({ dataRoot: "/data" }, {
      supervisor,
      createClient: () => fixtureClient([]),
      validateSocket: () => ownedSocket,
      validateDirectory: () => true,
    });
    await host.start();

    expect(() => host.resolveLaunchTarget(context({ providerThreadId: "../../bad" })))
      .toThrow("AGENT_TERMINAL_SESSION_INVALID");
    ownedSocket = false;
    expect(host.availability(context())).toEqual({
      available: false,
      reason: "APP_SERVER_UNAVAILABLE",
    });
    ownedSocket = true;
    supervisor.generation.mockReturnValue(2);
    expect(() => host.resolveLaunchTarget(context())).toThrow("AGENT_TERMINAL_UNAVAILABLE");
  });
});

function context(overrides: Partial<{
  agent: string;
  providerThreadId: string;
  workingDirectory: string;
  workspaceReady: boolean;
}> = {}) {
  return {
    agent: "codex",
    providerThreadId,
    workingDirectory: "/repo/worktree",
    workspaceReady: true,
    ...overrides,
  };
}

function fixtureSupervisor(order: string[]) {
  const connection = { connection: true } as unknown as AppServerConnection;
  return {
    start: vi.fn(async () => connection),
    stop: vi.fn(async () => { order.push("server-stop"); }),
    endpoint: vi.fn(() => ({
      transport: "unix" as const,
      socketPath: "/data/run/codex-app-server.sock",
      remoteUrl: "unix:///data/run/codex-app-server.sock",
    })),
    executablePath: vi.fn(() => "/bin/codex"),
    generation: vi.fn(() => 1),
    client: vi.fn(() => connection),
  };
}

function fixtureClient(order: string[]): CodexClient & { dispose(): Promise<void> } {
  const thread = (): CodexThread => ({
    id: null,
    runStreamed: async () => ({ async *[Symbol.asyncIterator]() {} }),
    dispose: async () => undefined,
  });
  return {
    startThread: (_options: CodexThreadOptions) => thread(),
    resumeThread: (_threadId: string, _options: CodexThreadOptions) => thread(),
    dispose: async () => { order.push("client-dispose"); },
  };
}
