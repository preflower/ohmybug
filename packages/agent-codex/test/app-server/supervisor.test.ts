import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexAppServerSupervisor } from "../../src/app-server/supervisor.js";
import { createTempDir } from "../helpers.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("Codex App Server supervisor", () => {
  it("starts the pinned binary on its owned Unix socket and initializes before readiness", async () => {
    const fixture = await setup();
    const client = await fixture.supervisor.start();

    expect(fixture.verifyBinary).toHaveBeenCalledOnce();
    expect(fixture.verifyProtocol).toHaveBeenCalledOnce();
    expect(fixture.spawn).toHaveBeenCalledWith(
      "/opt/codex",
      [
        "app-server",
        "--strict-config",
        "--listen",
        `unix://${join(fixture.dataRoot, "run/codex-app-server.sock")}`,
      ],
      { stdio: "ignore" },
    );
    expect(fixture.connection.initialize).toHaveBeenCalledOnce();
    expect(client).toBe(fixture.connection);
    expect(fixture.supervisor.generation()).toBe(1);
  });

  it("removes only a stale socket and rejects a non-socket collision", async () => {
    const fixture = await setup();
    const runDirectory = join(fixture.dataRoot, "run");
    const socketPath = join(runDirectory, "codex-app-server.sock");
    await mkdir(runDirectory, { recursive: true });
    await writeFile(socketPath, "not a socket");

    await expect(fixture.supervisor.start()).rejects.toThrow("CODEX_APP_SERVER_SOCKET_UNSAFE");
    expect(fixture.spawn).not.toHaveBeenCalled();
  });

  it("performs only one bounded restart after an unexpected exit", async () => {
    const fixture = await setup();
    await fixture.supervisor.start();
    fixture.children[0]!.emit("exit", 1, null);
    await waitFor(() => fixture.spawn.mock.calls.length === 2);
    fixture.children[1]!.emit("exit", 1, null);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));

    expect(fixture.spawn).toHaveBeenCalledTimes(2);
    expect(fixture.supervisor.generation()).toBe(2);
  });

  it("fails before spawning on version mismatch or an overlong socket path", async () => {
    const mismatch = await setup({
      verifyBinary: vi.fn(async () => { throw new Error("CODEX_PROTOCOL_VERSION_MISMATCH"); }),
    });
    await expect(mismatch.supervisor.start()).rejects.toThrow("CODEX_PROTOCOL_VERSION_MISMATCH");
    expect(mismatch.spawn).not.toHaveBeenCalled();

    const temporary = await createTempDir(`oh-my-bug-${"x".repeat(110)}-`);
    cleanups.push(temporary.cleanup);
    const tooLong = new CodexAppServerSupervisor({ dataRoot: temporary.path }, dependencies());
    await expect(tooLong.start()).rejects.toThrow("CODEX_APP_SERVER_SOCKET_PATH_TOO_LONG");
  });

  it("closes the connection, terminates the child, and is idempotent on shutdown", async () => {
    const fixture = await setup();
    await fixture.supervisor.start();

    await fixture.supervisor.stop();
    await fixture.supervisor.stop();

    expect(fixture.connection.close).toHaveBeenCalledOnce();
    expect(fixture.children[0]!.kill).toHaveBeenCalledOnce();
  });
});

class FakeChild extends EventEmitter {
  readonly kill = vi.fn(() => true);
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    resolveBinary: () => ({ executablePath: "/opt/codex", packageVersion: "0.148.0" }),
    verifyBinary: vi.fn(async () => undefined),
    verifyProtocol: vi.fn(async () => undefined),
    spawn: vi.fn(() => new FakeChild()),
    connect: vi.fn(),
    delay: async () => undefined,
    ...overrides,
  };
}

async function setup(overrides: Record<string, unknown> = {}) {
  const dataRoot = await mkdtemp("/tmp/omb-supervisor-");
  cleanups.push(() => rm(dataRoot, { recursive: true, force: true }));
  const connection = {
    initialize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const configured = dependencies({
    connect: vi.fn(async () => connection),
    ...overrides,
  });
  const children: FakeChild[] = [];
  configured.spawn = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const supervisor = new CodexAppServerSupervisor(
    { dataRoot, startupTimeoutMs: 100 },
    configured,
  );
  return {
    supervisor,
    dataRoot,
    connection,
    children,
    spawn: configured.spawn,
    verifyBinary: configured.verifyBinary,
    verifyProtocol: configured.verifyProtocol,
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const timeoutAt = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= timeoutAt) throw new Error("TEST_TIMEOUT");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}
