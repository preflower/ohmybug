import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UtilityClient } from "../../src/electron/utility-client.js";

class FakeUtilityProcess extends EventEmitter {
  readonly sent: unknown[] = [];

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  receive(message: unknown): void {
    this.emit("message", message);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("UtilityClient", () => {
  it("announces readiness only after the utility bootstrap message", async () => {
    const process = new FakeUtilityProcess();
    const client = new UtilityClient(process);
    let ready = false;
    const waiting = client.whenReady().then(() => { ready = true; });

    await Promise.resolve();
    expect(ready).toBe(false);
    process.receive({ kind: "ready" });
    await waiting;
    expect(ready).toBe(true);
  });

  it("correlates out-of-order responses and ignores unknown response IDs", async () => {
    const process = new FakeUtilityProcess();
    const client = new UtilityClient(process);
    const projects = client.request("listProjects", {});
    const health = client.request("health", {});
    const [projectsRequest, healthRequest] = process.sent as Array<{ id: string }>;

    process.receive({ kind: "response", id: "unknown", ok: true, value: "ignored" });
    process.receive({ kind: "response", id: healthRequest!.id, ok: true, value: { state: "ready" } });
    process.receive({
      kind: "response",
      id: projectsRequest!.id,
      ok: true,
      value: [{
        id: "project-1",
        key: "SHOP",
        path: "/tmp/shop",
        workspace: { provider: "local", config: {} },
        revision: 1,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z"
      }]
    });

    await expect(projects).resolves.toEqual([expect.objectContaining({ id: "project-1" })]);
    await expect(health).resolves.toEqual({ state: "ready" });
  });

  it("propagates cancellation, timeout, and utility exit to pending requests", async () => {
    vi.useFakeTimers();
    const process = new FakeUtilityProcess();
    const client = new UtilityClient(process, { timeoutMs: 25 });
    const controller = new AbortController();
    const canceled = client.request("listProjects", {}, { signal: controller.signal });
    const canceledId = (process.sent[0] as { id: string }).id;
    controller.abort();

    await expect(canceled).rejects.toThrow("RUN_CANCELED");
    expect(process.sent).toContainEqual({ kind: "cancel", id: canceledId });

    const timedOut = client.request("health", {});
    const timeoutExpectation = expect(timedOut).rejects.toThrow("UTILITY_REQUEST_TIMEOUT");
    await vi.advanceTimersByTimeAsync(26);
    await timeoutExpectation;

    const exited = client.request("listIssues", {});
    process.emit("exit", 1);
    await expect(exited).rejects.toThrow("UTILITY_PROCESS_EXITED:1");
  });

  it("subscribes after a cursor and returns an explicit unsubscribe", () => {
    const process = new FakeUtilityProcess();
    const client = new UtilityClient(process);
    const listener = vi.fn();
    const unsubscribe = client.subscribeIssue("issue-1", 3, listener);
    const request = process.sent[0] as { subscriptionId: string };

    process.receive({
      kind: "event",
      subscriptionId: request.subscriptionId,
      issueId: "issue-1",
      cursor: 5,
      events: [{
        id: "event-5",
        issueId: "issue-1",
        sequence: 5,
        type: "ASSESSMENT_READY",
        actor: "AGENT",
        data: {},
        occurredAt: "2026-08-21T00:00:00.000Z"
      }]
    });
    unsubscribe();

    expect(listener).toHaveBeenCalledWith({
      issueId: "issue-1",
      cursor: 5,
      events: [expect.objectContaining({ sequence: 5 })]
    });
    expect(process.sent.at(-1)).toEqual({ kind: "unsubscribe", subscriptionId: request.subscriptionId });
  });
});
