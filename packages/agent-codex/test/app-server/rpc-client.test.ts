import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { AppServerRpcClient } from "../../src/app-server/rpc-client.js";

interface Fixture {
  socketPath: string;
  received: unknown[];
  send(value: unknown): void;
  close(): Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("App Server JSON-RPC client", () => {
  it("initializes before allowing thread requests", async () => {
    const fixture = await createFixture();
    const client = await AppServerRpcClient.connect({
      transport: "unix",
      socketPath: fixture.socketPath,
      remoteUrl: `unix://${fixture.socketPath}`,
    });
    cleanups.push(() => client.close());

    await expect(client.request("thread/read", {
      threadId: "thread-1",
      includeTurns: false,
    })).rejects.toThrow("CODEX_APP_SERVER_NOT_INITIALIZED");

    const initialized = client.initialize();
    await waitFor(() => fixture.received.length === 1);
    const request = fixture.received[0] as { id: number; method: string };
    expect(request).toMatchObject({ id: 1, method: "initialize" });
    fixture.send({ id: request.id, result: { userAgent: "codex-test" } });
    await initialized;
    await waitFor(() => fixture.received.length === 2);
    expect(fixture.received[1]).toEqual({ method: "initialized", params: {} });
  });

  it("correlates out-of-order responses and surfaces protocol errors", async () => {
    const fixture = await initializedFixture();
    const first = fixture.client.request("thread/read", {
      threadId: "thread-1",
      includeTurns: false,
    });
    const second = fixture.client.request("thread/read", {
      threadId: "thread-2",
      includeTurns: true,
    });
    await waitFor(() => fixture.server.received.length === 4);
    const firstRequest = fixture.server.received[2] as { id: number };
    const secondRequest = fixture.server.received[3] as { id: number };
    fixture.server.send({
      id: secondRequest.id,
      error: { code: -32000, message: "thread missing" },
    });
    fixture.server.send({ id: firstRequest.id, result: { thread: { id: "thread-1" } } });

    await expect(first).resolves.toEqual({ thread: { id: "thread-1" } });
    await expect(second).rejects.toThrow("CODEX_APP_SERVER_RPC_ERROR:-32000:thread missing");
  });

  it("streams notifications and rejects unsupported server requests", async () => {
    const fixture = await initializedFixture();
    const iterator = fixture.client.notifications()[Symbol.asyncIterator]();
    fixture.server.send({
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-1" } },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        method: "turn/started",
        params: { threadId: "thread-1", turn: { id: "turn-1" } },
      },
    });

    fixture.server.send({ id: 99, method: "tool/requestUserInput", params: {} });
    await waitFor(() => fixture.server.received.length === 3);
    expect(fixture.server.received[2]).toEqual({
      id: 99,
      error: { code: -32601, message: "Method not supported by Oh My Bug" },
    });
  });

  it("accepts the pinned turn/steer response shape", async () => {
    const fixture = await initializedFixture();
    const steered = fixture.client.request("turn/steer", {
      threadId: "thread-1",
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "Inspect the failing test", text_elements: [] }],
    });
    await waitFor(() => fixture.server.received.length === 3);
    const request = fixture.server.received[2] as { id: number };
    fixture.server.send({ id: request.id, result: { turnId: "turn-1" } });

    await expect(steered).resolves.toEqual({ turnId: "turn-1" });
  });

  it("rejects an aborted request and all pending work on disconnect", async () => {
    const fixture = await initializedFixture();
    const abort = new AbortController();
    const aborted = fixture.client.request("thread/read", {
      threadId: "thread-abort",
      includeTurns: false,
    }, { signal: abort.signal });
    abort.abort("stop");
    await expect(aborted).rejects.toThrow("RUN_CANCELED");

    const disconnected = fixture.client.request("thread/read", {
      threadId: "thread-disconnect",
      includeTurns: false,
    });
    const rejected = expect(disconnected).rejects.toThrow("CODEX_APP_SERVER_DISCONNECTED");
    await fixture.server.close();
    await rejected;
  });
});

async function initializedFixture(): Promise<{ client: AppServerRpcClient; server: Fixture }> {
  const server = await createFixture();
  const client = await AppServerRpcClient.connect({
    transport: "unix",
    socketPath: server.socketPath,
    remoteUrl: `unix://${server.socketPath}`,
  });
  cleanups.push(() => client.close());
  const initializing = client.initialize();
  await waitFor(() => server.received.length === 1);
  const request = server.received[0] as { id: number };
  server.send({ id: request.id, result: { userAgent: "codex-test" } });
  await initializing;
  await waitFor(() => server.received.length === 2);
  return { client, server };
}

async function createFixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "oh-my-bug-rpc-"));
  const socketPath = join(directory, "app-server.sock");
  const server = createServer();
  const webSockets = new WebSocketServer({ noServer: true });
  const received: unknown[] = [];
  let peer: WebSocket | undefined;
  let closed = false;
  server.on("upgrade", (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, (connected) => {
      peer = connected;
      connected.on("message", (data) => received.push(JSON.parse(data.toString())));
    });
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(socketPath, resolvePromise);
  });
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const connected of webSockets.clients) connected.terminate();
    webSockets.close();
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    await rm(directory, { recursive: true, force: true });
  };
  cleanups.push(close);
  return {
    socketPath,
    received,
    send(value) {
      if (!peer) throw new Error("TEST_PEER_NOT_CONNECTED");
      peer.send(JSON.stringify(value));
    },
    close,
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const timeoutAt = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() >= timeoutAt) throw new Error("TEST_TIMEOUT");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}
