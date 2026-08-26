import { describe, expect, it } from "vitest";

import { CodexAgentAdapter, codexAgent } from "../src/codex-agent-adapter.js";
import { NativeThreadUnavailableError } from "../src/codex-client.js";
import { bindSession, FixtureClient, issue, MemorySessions, project } from "./helpers.js";

const bugAssessment = {
  revision: 2,
  contentHash: "a".repeat(64),
  verdict: "BUG" as const,
  suggestedTitle: "Checkout fails",
  reasoning: "Reproduced",
  rootCause: "Null cart",
  solution: "Handle expiry",
};

describe("durable Codex session", () => {
  it("fails a missing native thread without starting or overwriting a replacement", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-1", "thread-1");
    const client = new FixtureClient([{ error: new NativeThreadUnavailableError("thread-1") }]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await expect(adapter.assess(
      { agent: "codex", sessionId: "logical-1" },
      { issue: issue(), project },
    )).rejects.toThrow("AGENT_SESSION_UNAVAILABLE");

    expect(client.resumes.map(({ threadId }) => threadId)).toEqual(["thread-1"]);
    expect(client.starts).toEqual([]);
    expect((await sessions.get("logical-1"))?.providerSessionId).toBe("thread-1");
  });

  it("rejects a resumed thread.started ID mismatch without overwriting Storage", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-1", "thread-1");
    const client = new FixtureClient([{
      events: [
        { type: "thread.started", threadId: "thread-other" },
        { type: "turn.started", threadId: "thread-other", turnId: "turn-other" },
        { type: "item.completed", threadId: "thread-other", turnId: "turn-other", item: { type: "agent_message", text: JSON.stringify({
          verdict: "UNCERTAIN",
          suggestedTitle: "Needs review",
          reasoning: "Insufficient context",
        }) } },
      ],
    }]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await expect(adapter.assess(
      { agent: "codex", sessionId: "logical-1" },
      { issue: issue(), project },
    )).rejects.toThrow("AGENT_SESSION_MISMATCH");
    expect((await sessions.get("logical-1"))?.providerSessionId).toBe("thread-1");
  });

  it("rejects a new task response that never establishes its native thread ID", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const client = new FixtureClient([{
      events: [{
        type: "item.completed",
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "agent_message", text: JSON.stringify({
          verdict: "UNCERTAIN",
          suggestedTitle: "Needs review",
          reasoning: "Insufficient context",
        }) },
      }],
    }]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await expect(adapter.assess(
      { agent: "codex", sessionId: "logical-1" },
      { issue: issue(), project },
    )).rejects.toThrow("AGENT_SESSION_MISMATCH");
    expect((await sessions.get("logical-1"))?.providerSessionId).toBeUndefined();
  });

  it("exports a Core AgentPlugin factory", () => {
    const sessions = new MemorySessions();
    const plugin = codexAgent({ client: new FixtureClient([]) });

    expect(plugin.id).toBe("codex");
    expect(plugin.create({ sessions })).toBeInstanceOf(CodexAgentAdapter);
  });

  it("registers without an App Server client and fails closed when a turn starts", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const adapter = codexAgent().create({ sessions });

    await expect(adapter.assess(
      { agent: "codex", sessionId: "logical-1" },
      { issue: issue(), project },
    )).rejects.toThrow("CODEX_APP_SERVER_UNAVAILABLE");
  });

  it("uses the same native task for Assessment and Repair", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const client = new FixtureClient([
      JSON.stringify({
        verdict: "BUG",
        suggestedTitle: "Checkout fails",
        reasoning: "Reproduced",
        rootCause: "Null cart",
        solution: "Handle expiry",
      }),
      JSON.stringify({
        kind: "DELIVERY_READY",
        summary: "Fixed",
        evidence: [{ type: "screenshot", label: "Proof", relativePath: "proof.png" }],
        integration: null,
        verification: [{ command: "pnpm test", outcome: "PASSED", summary: "Passed" }],
      }),
    ]);
    const adapter = new CodexAgentAdapter({ client, sessions });
    const session = { agent: "codex" as const, sessionId: "logical-1" };

    await adapter.assess(session, { issue: issue(), project });
    await adapter.repair(session, {
      issue: issue({ status: "REPAIRING", assessment: bugAssessment, repair: { iteration: 1 } }),
      project,
      assessment: bugAssessment,
      evidenceDirectory: "/private/intake/issue-1/1",
    });

    expect(client.starts).toHaveLength(1);
    expect(client.resumes.map(({ threadId }) => threadId)).toEqual(["thread-1"]);
  });
});
