import type { AgentAdapter, AgentPlugin, AgentSessionRef, RuntimeProject } from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import { AgentRegistry } from "../src/agents/registry.js";

const adapter: AgentAdapter = {
  createSession: async () => ({ agent: "codex", sessionId: "logical-1" }),
  assess: async () => { throw new Error("UNUSED"); },
  repair: async () => { throw new Error("UNUSED"); },
  captureEvidence: async () => { throw new Error("UNUSED"); },
  cancel: async () => undefined,
};

function plugin(id: string, value: AgentAdapter = adapter): AgentPlugin {
  return { id, create: () => value };
}

const context = {
  sessions: { get: async () => undefined, save: async () => undefined },
};

describe("AgentRegistry", () => {
  it("routes Project and session references to the installed adapter", () => {
    const agents = new AgentRegistry([plugin("codex")], context);
    const project = { id: "p", key: "P", path: "/tmp/p", agent: { plugin: "codex" } };
    const session: AgentSessionRef = { agent: "codex", sessionId: "logical-1" };

    expect(agents.forProject(project)).toBe(adapter);
    expect(agents.forSession(session)).toBe(adapter);
  });

  it("rejects duplicate and missing plugins", () => {
    expect(() => new AgentRegistry([plugin("same"), plugin("same")], context))
      .toThrow("DUPLICATE_AGENT_PLUGIN:same");
    const agents = new AgentRegistry([plugin("codex")], context);
    expect(() => agents.forProject({ agent: { plugin: "missing" } } as RuntimeProject))
      .toThrow("AGENT_PLUGIN_NOT_INSTALLED:missing");
    expect(() => agents.forSession({ agent: "missing", sessionId: "logical-1" }))
      .toThrow("AGENT_PLUGIN_NOT_INSTALLED:missing");
  });
});
