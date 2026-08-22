import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { createRuntimeServer } from "../../src/protocol/server.js";

class Port extends EventEmitter {
  readonly sent: unknown[] = [];
  postMessage(message: unknown) { this.sent.push(message); }
}

describe("Runtime protocol server", () => {
  it("validates registry input/output and serializes stable errors", async () => {
    const port = new Port();
    const service = {
      health: async () => ({ state: "ready" }),
      listProjects: async () => [{ invalid: true }],
    };
    const server = createRuntimeServer(service as never, port, { pollMs: 60_000 });
    port.emit("message", {
      kind: "request",
      id: "health-1",
      operation: "health",
      payload: {},
    });
    port.emit("message", {
      kind: "request",
      id: "projects-1",
      operation: "listProjects",
      payload: {},
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(port.sent).toContainEqual({
      kind: "response",
      id: "health-1",
      ok: true,
      value: { state: "ready" },
    });
    expect(port.sent).toContainEqual(expect.objectContaining({
      kind: "response",
      id: "projects-1",
      ok: false,
      error: expect.objectContaining({ code: "INVALID_RESPONSE" }),
    }));
    server.close();
  });
});
