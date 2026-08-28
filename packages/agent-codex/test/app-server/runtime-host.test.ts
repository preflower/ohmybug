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
      permissionMode: "auto-review",
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

  it("reattaches to a new connection after the supervisor completes its bounded restart", async () => {
    const order: string[] = [];
    const firstConnection = { connection: 1 } as unknown as AppServerConnection;
    const secondConnection = { connection: 2 } as unknown as AppServerConnection;
    const supervisor = fixtureSupervisor(order);
    supervisor.start.mockResolvedValue(firstConnection);
    supervisor.client.mockReturnValue(firstConnection);
    const firstClient = fixtureClient(order);
    const secondClient = fixtureClient(order);
    const resumeThread = vi.spyOn(secondClient, "resumeThread");
    const createClient = vi.fn((connection: AppServerConnection) =>
      connection === firstConnection ? firstClient : secondClient);
    const host = new CodexAppServerRuntimeHost({ dataRoot: "/data" }, {
      supervisor,
      createClient,
      validateSocket: () => true,
      validateDirectory: () => true,
    });
    await host.start();

    supervisor.generation.mockReturnValue(2);
    supervisor.client.mockReturnValue(secondConnection);

    const forwardingClient = (host as unknown as { forwardingClient: CodexClient }).forwardingClient;
    forwardingClient.resumeThread(providerThreadId, {
      workingDirectory: "/repo/worktree",
      sandboxMode: "read-only",
      networkAccessEnabled: false,
      approvalPolicy: "never",
      sessionId: "logical-session-1",
    });
    expect(resumeThread).toHaveBeenCalledOnce();
    expect(host.availability(context())).toEqual({ available: true });
    expect(createClient).toHaveBeenNthCalledWith(1, firstConnection);
    expect(createClient).toHaveBeenNthCalledWith(2, secondConnection);
    expect(order).toEqual(["client-dispose"]);
    expect(host.resolveLaunchTarget(context()).providerThreadId).toBe(providerThreadId);
  });
});

function context(overrides: Partial<{
  agent: string;
  providerThreadId: string;
  workingDirectory: string;
  workspaceReady: boolean;
  permissionMode: "request-approval" | "auto-review" | "full-access";
}> = {}) {
  return {
    agent: "codex",
    providerThreadId,
    workingDirectory: "/repo/worktree",
    workspaceReady: true,
    permissionMode: "auto-review" as const,
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
