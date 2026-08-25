import { describe, expect, it, vi } from "vitest";

import type { DingTalkClient, DingTalkMessage } from "../src/dingtalk-client.js";
import { DingTalkIntegrationAdapter } from "../src/dingtalk-adapter.js";
import { DingTalkStream } from "../src/dingtalk-stream.js";

class FixtureClient implements DingTalkClient {
  callback?: (message: DingTalkMessage) => void | Promise<void>;
  connect = vi.fn(async () => undefined);
  disconnect = vi.fn(() => undefined);
  acknowledge = vi.fn((messageId: string) => { void messageId; });
  onRobotMessage = vi.fn((callback: (message: DingTalkMessage) => void | Promise<void>) => {
    this.callback = callback;
  });
}

interface PendingWait {
  delayMs: number;
  signal: AbortSignal;
  resolve(): void;
}

function controllableWait(): {
  pending: PendingWait[];
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
} {
  const pending: PendingWait[] = [];
  return {
    pending,
    wait: (delayMs, signal) => new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", finish);
        resolve();
      };
      signal.addEventListener("abort", finish, { once: true });
      pending.push({ delayMs, signal, resolve: finish });
    }),
  };
}

const payload = JSON.stringify({
  conversationId: "allowed",
  msgId: "message-1",
  isInAtList: true,
  text: { content: "@OhMyBug checkout fails" },
});

describe("DingTalk stream", () => {
  it("retries a rejected connection and stays alive after connecting until abort", async () => {
    const client = new FixtureClient();
    client.connect
      .mockRejectedValueOnce(new Error("connect rejected client-token client-secret"))
      .mockResolvedValueOnce(undefined);
    const retryWait = controllableWait();
    const now = new Date("2026-08-21T00:00:00.000Z");
    const controller = new AbortController();
    const stream = new DingTalkStream({
      client,
      adapter: new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] }),
      onInput: async () => {},
      now: () => now,
      secretValues: ["client-token", "client-secret"],
      baseRetryMs: 1_000,
      jitter: (delayMs) => delayMs + 250,
      wait: retryWait.wait,
    });

    let settled = false;
    let rejection: unknown;
    const started = stream.start(controller.signal).catch((error: unknown) => {
      rejection = error;
    }).finally(() => { settled = true; });

    await vi.waitFor(() => expect(retryWait.pending).toHaveLength(1));
    expect(stream.health()).toEqual({
      state: "backoff",
      lastError: "connect rejected [REDACTED] [REDACTED]",
      nextRetryAt: "2026-08-21T00:00:01.250Z",
    });
    expect(retryWait.pending[0]).toMatchObject({ delayMs: 1_250, signal: controller.signal });
    expect(client.disconnect).toHaveBeenCalledOnce();

    retryWait.pending[0]!.resolve();
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalledTimes(2));
    expect(stream.health()).toEqual({ state: "connected", lastSuccessAt: now.toISOString() });
    expect(settled).toBe(false);
    expect(client.onRobotMessage).toHaveBeenCalledOnce();

    controller.abort();
    await started;
    expect(rejection).toBeUndefined();
    expect(stream.health()).toEqual({ state: "stopped", lastSuccessAt: now.toISOString() });
    expect(client.disconnect).toHaveBeenCalledTimes(2);
  });

  it("cancels the default backoff wait without reconnecting on repeated or late abort", async () => {
    vi.useFakeTimers();
    try {
      const client = new FixtureClient();
      client.connect.mockRejectedValue(new Error("offline"));
      const controller = new AbortController();
      const stream = new DingTalkStream({
        client,
        adapter: new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] }),
        onInput: async () => {},
        baseRetryMs: 1_000,
        jitter: (delayMs) => delayMs,
      });

      const started = stream.start(controller.signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(stream.health()).toMatchObject({ state: "backoff" });

      controller.abort();
      controller.abort();
      await started;
      await vi.advanceTimersByTimeAsync(60_000);
      controller.abort();

      expect(client.connect).toHaveBeenCalledOnce();
      expect(client.disconnect).toHaveBeenCalledOnce();
      expect(stream.health()).toMatchObject({ state: "stopped", nextRetryAt: undefined });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops on abort even when an injected wait ignores its signal", async () => {
    const client = new FixtureClient();
    client.connect.mockRejectedValue(new Error("offline"));
    const controller = new AbortController();
    const stream = new DingTalkStream({
      client,
      adapter: new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] }),
      onInput: async () => {},
      jitter: (delayMs) => delayMs,
      wait: async () => new Promise<void>(() => {}),
    });

    let stopped = false;
    const started = stream.start(controller.signal).then(() => { stopped = true; });
    await vi.waitFor(() => expect(stream.health()).toMatchObject({ state: "backoff" }));
    controller.abort();

    await vi.waitFor(() => expect(stopped).toBe(true), { timeout: 200 });
    await started;
    expect(client.connect).toHaveBeenCalledOnce();
    expect(stream.health()).toMatchObject({ state: "stopped" });
  });

  it("disconnects exactly once and stops when aborted while connected", async () => {
    const client = new FixtureClient();
    const controller = new AbortController();
    const stream = new DingTalkStream({
      client,
      adapter: new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] }),
      onInput: async () => {},
    });

    const started = stream.start(controller.signal);
    await vi.waitFor(() => expect(stream.health()).toMatchObject({ state: "connected" }));
    controller.abort();
    controller.abort();
    await started;
    controller.abort();

    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(stream.health()).toMatchObject({ state: "stopped", nextRetryAt: undefined });
  });

  it("backs off exponentially, caps at sixty seconds, and never schedules a zero-delay retry", async () => {
    const client = new FixtureClient();
    client.connect.mockRejectedValue(new Error("offline"));
    const retryWait = controllableWait();
    const controller = new AbortController();
    const jitter = vi.fn((delayMs: number) => delayMs === 1 ? 0 : delayMs + 500);
    const stream = new DingTalkStream({
      client,
      adapter: new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] }),
      onInput: async () => {},
      baseRetryMs: 0,
      jitter,
      wait: retryWait.wait,
    });

    const started = stream.start(controller.signal);
    await vi.waitFor(() => expect(retryWait.pending).toHaveLength(1));
    expect(retryWait.pending[0]!.delayMs).toBe(1);
    controller.abort();
    await started;

    const cappedClient = new FixtureClient();
    cappedClient.connect.mockRejectedValue(new Error("offline"));
    const cappedWait = controllableWait();
    const cappedController = new AbortController();
    const capped = new DingTalkStream({
      client: cappedClient,
      adapter: new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] }),
      onInput: async () => {},
      baseRetryMs: 10_000,
      jitter: (delayMs) => delayMs + 500,
      wait: cappedWait.wait,
    });

    const cappedStarted = capped.start(cappedController.signal);
    for (const [index, expected] of [10_500, 20_500, 40_500, 60_000].entries()) {
      await vi.waitFor(() => expect(cappedWait.pending).toHaveLength(index + 1));
      const pending = cappedWait.pending[index]!;
      expect(pending.delayMs).toBe(expected);
      if (expected !== 60_000) pending.resolve();
    }
    cappedController.abort();
    await cappedStarted;
    expect(cappedClient.connect).toHaveBeenCalledTimes(4);
  });

  it("ignores disconnect failures so retry and stopped cleanup can both finish", async () => {
    const client = new FixtureClient();
    client.connect
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    client.disconnect.mockImplementation(() => { throw new Error("disconnect failed"); });
    const retryWait = controllableWait();
    const controller = new AbortController();
    const stream = new DingTalkStream({
      client,
      adapter: new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] }),
      onInput: async () => {},
      jitter: (delayMs) => delayMs,
      wait: retryWait.wait,
    });

    const started = stream.start(controller.signal);
    await vi.waitFor(() => expect(retryWait.pending).toHaveLength(1));
    retryWait.pending[0]!.resolve();
    await vi.waitFor(() => expect(stream.health()).toMatchObject({ state: "connected" }));
    controller.abort();
    await expect(started).resolves.toBeUndefined();

    expect(client.connect).toHaveBeenCalledTimes(2);
    expect(client.disconnect).toHaveBeenCalledTimes(2);
    expect(stream.health()).toMatchObject({ state: "stopped" });
  });

  it("starts each lifecycle at the base delay and registers the callback once across starts", async () => {
    const client = new FixtureClient();
    client.connect
      .mockRejectedValueOnce(new Error("offline-1"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline-2"))
      .mockResolvedValueOnce(undefined);
    const retryWait = controllableWait();
    const stream = new DingTalkStream({
      client,
      adapter: new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] }),
      onInput: async () => {},
      baseRetryMs: 1_000,
      jitter: (delayMs) => delayMs,
      wait: retryWait.wait,
    });

    const firstController = new AbortController();
    const firstStart = stream.start(firstController.signal);
    await vi.waitFor(() => expect(retryWait.pending).toHaveLength(1));
    expect(retryWait.pending[0]!.delayMs).toBe(1_000);
    retryWait.pending[0]!.resolve();
    await vi.waitFor(() => expect(stream.health()).toMatchObject({ state: "connected" }));
    firstController.abort();
    await firstStart;

    const secondController = new AbortController();
    const secondStart = stream.start(secondController.signal);
    await vi.waitFor(() => expect(retryWait.pending).toHaveLength(2));
    expect(retryWait.pending[1]!.delayMs).toBe(1_000);
    retryWait.pending[1]!.resolve();
    await vi.waitFor(() => expect(stream.health()).toMatchObject({ state: "connected" }));
    secondController.abort();
    await secondStart;

    expect(client.onRobotMessage).toHaveBeenCalledOnce();
  });

  it("acknowledges rule rejections and inputs accepted by Runtime", async () => {
    const client = new FixtureClient();
    const onInput = vi.fn(async () => undefined);
    const stream = new DingTalkStream({
      client,
      adapter: new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] }),
      onInput,
    });
    stream.register();

    await client.callback?.({
      headers: { messageId: "envelope-rejected" },
      data: JSON.stringify({ ...JSON.parse(payload), conversationId: "other" }),
    });
    await client.callback?.({ headers: { messageId: "envelope-accepted" }, data: payload });

    expect(onInput).toHaveBeenCalledOnce();
    expect(client.acknowledge).toHaveBeenCalledTimes(2);
  });

  it("leaves a message unacknowledged when Runtime intake fails so it can be redelivered", async () => {
    const client = new FixtureClient();
    const onInput = vi.fn()
      .mockRejectedValueOnce(new Error("SQLITE_BUSY"))
      .mockResolvedValueOnce(undefined);
    const stream = new DingTalkStream({
      client,
      adapter: new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] }),
      onInput,
    });
    stream.register();

    await client.callback?.({ headers: { messageId: "envelope-1" }, data: payload });
    expect(client.acknowledge).not.toHaveBeenCalled();
    await client.callback?.({ headers: { messageId: "envelope-1" }, data: payload });

    expect(onInput).toHaveBeenCalledTimes(2);
    expect(client.acknowledge).toHaveBeenCalledWith("envelope-1");
    expect(stream.health()).toMatchObject({ state: "connected", lastSuccessAt: expect.any(String) });
  });

  it("redacts credentials from connection health", async () => {
    const client = new FixtureClient();
    client.connect.mockRejectedValueOnce(new Error("connection rejected secret-value"));
    const retryWait = controllableWait();
    const controller = new AbortController();
    const stream = new DingTalkStream({
      client,
      adapter: new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] }),
      onInput: async () => {},
      secretValues: ["secret-value"],
      wait: retryWait.wait,
    });

    const started = stream.start(controller.signal);
    await vi.waitFor(() => expect(retryWait.pending).toHaveLength(1));
    expect(stream.health().lastError).toBe("connection rejected [REDACTED]");
    controller.abort();
    await started;
  });
});
