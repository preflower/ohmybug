import { describe, expect, it } from "vitest";

import { utilityRequestSchema } from "../../src/protocol/schemas.js";

describe("Runtime protocol messages", () => {
  it("derives request validation from the operation registry", () => {
    expect(utilityRequestSchema.parse({
      kind: "request",
      id: "request-1",
      operation: "rebuildAgentSession",
      payload: { id: "issue-1", expectedRevision: 7 },
    })).toMatchObject({ operation: "rebuildAgentSession" });
    expect(() => utilityRequestSchema.parse({
      kind: "request",
      id: "request-2",
      operation: "rebuildAgentSession",
      payload: { id: "issue-1", expectedRevision: 0 },
    })).toThrow();
    expect(() => utilityRequestSchema.parse({
      kind: "request",
      id: "request-3",
      operation: "unknownOperation",
      payload: {},
    })).toThrow();
  });
});
