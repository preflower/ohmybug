import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { UtilitySupervisor } from "../../src/electron/utility-supervisor.js";

class FakeChild extends EventEmitter {
  readonly sent: unknown[] = [];
  readonly kill = vi.fn(() => true);

  postMessage(message: unknown): void {
    this.sent.push(message);
    const request = message as { kind?: string; operation?: string; id?: string };
    if (request.kind === "request" && request.operation === "shutdown") {
      queueMicrotask(() => this.receive({ kind: "response", id: request.id, ok: true, value: null }));
    }
  }

  receive(message: unknown): void {
    this.emit("message", message);
  }
}

describe("UtilitySupervisor", () => {
  it("waits for ready, performs one bounded restart, and then fails closed", async () => {
    const children: FakeChild[] = [];
    const states: string[] = [];
    const supervisor = new UtilitySupervisor({
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      restartLimit: 1,
      startupTimeoutMs: 1_000,
      onState: (state) => states.push(state)
    });

    const starting = supervisor.start();
    children[0]!.receive({ kind: "ready" });
    await starting;
    expect(supervisor.client()).toBeDefined();
    expect(states).toEqual(["starting", "ready"]);

    children[0]!.emit("exit", 1);
    await waitFor(() => children.length === 2);
    children[1]!.receive({ kind: "ready" });
    await waitFor(() => states.at(-1) === "ready");
    expect(states).toEqual(["starting", "ready", "restarting", "ready"]);

    children[1]!.emit("exit", 2);
    await waitFor(() => states.at(-1) === "disconnected");
    expect(children).toHaveLength(2);
    expect(() => supervisor.client()).toThrow("UTILITY_NOT_READY");
  });

  it("gracefully asks the utility to shut down before killing it", async () => {
    const child = new FakeChild();
    const supervisor = new UtilitySupervisor({ spawn: () => child });
    const starting = supervisor.start();
    child.receive({ kind: "ready" });
    await starting;

    await supervisor.shutdown();

    expect(child.sent).toContainEqual(expect.objectContaining({ kind: "request", operation: "shutdown" }));
    expect(child.kill).toHaveBeenCalledOnce();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("WAIT_TIMEOUT");
}
