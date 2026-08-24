import { describe, expect, it } from "vitest";

import type { AgentActivityUpdate } from "@oh-my-bug/core";

import { CodexAgentAdapter } from "../src/codex-agent-adapter.js";
import { bindSession, FixtureClient, issue, MemorySessions, project } from "./helpers.js";

describe("Codex activity reporting", () => {
  it("reports cleanup diagnostics without failing a completed turn", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-cleanup", "thread-cleanup");
    const activities: AgentActivityUpdate[] = [];
    const client = new FixtureClient([{
      events: [
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({
              verdict: "NOT_A_BUG",
              suggestedTitle: "No change needed",
              reasoning: "Expected behavior",
              rootCause: null,
              solution: null,
              suspectedDuplicateOf: null,
            }),
          },
        },
        { type: "turn.completed" },
        { type: "cleanup.failed", message: "ENOTEMPTY: token=private-token" },
      ],
    }]);
    const adapter = new CodexAgentAdapter({
      client,
      sessions,
      reportActivity: (activity) => { activities.push(activity); },
    });

    await expect(adapter.assess(
      { agent: "codex", sessionId: "logical-cleanup" },
      { issue: issue(), project },
    )).resolves.toMatchObject({ verdict: "NOT_A_BUG" });
    expect(activities).toContainEqual(expect.objectContaining({
      type: "AGENT_TEMP_CLEANUP_FAILED",
      message: "Agent 临时目录清理失败",
      detail: "ENOTEMPTY: token=[REDACTED]",
      level: "error",
    }));
  });

  it("reports useful turn, command, and network failure events with redacted details", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const activities: AgentActivityUpdate[] = [];
    const client = new FixtureClient([{
      events: [
        { type: "thread.started", threadId: "thread-1" },
        { type: "turn.started" },
        {
          type: "item.started",
          item: {
            id: "command-1",
            type: "command_execution",
            command: "API_KEY=native-secret pnpm test",
            status: "in_progress",
            output: "",
          },
        },
        {
          type: "item.completed",
          item: {
            id: "command-1",
            type: "command_execution",
            command: "API_KEY=native-secret pnpm test",
            status: "failed",
            output: "Authorization: Bearer provider-token",
          },
        },
        {
          type: "error",
          message: "stream disconnected before completion: error sending request?token=private-token",
        },
      ],
    }]);
    const adapter = new CodexAgentAdapter({
      client,
      sessions,
      reportActivity: (activity) => { activities.push(activity); },
    });

    await expect(adapter.assess(
      { agent: "codex", sessionId: "logical-1" },
      { issue: issue(), project },
    )).rejects.toThrow("stream disconnected");

    expect(activities.map((activity) => activity.type)).toEqual([
      "AGENT_SESSION_CONNECTED",
      "AGENT_TURN_STARTED",
      "AGENT_COMMAND_STARTED",
      "AGENT_COMMAND_FAILED",
      "AGENT_ERROR",
    ]);
    expect(activities.at(-1)).toMatchObject({
      message: "Codex 网络连接中断",
      level: "error",
      stage: "ASSESSMENT",
    });
    expect(activities.filter((activity) => activity.type.startsWith("AGENT_COMMAND_")))
      .toEqual([
        expect.objectContaining({ correlationId: "command-1", type: "AGENT_COMMAND_STARTED" }),
        expect.objectContaining({ correlationId: "command-1", type: "AGENT_COMMAND_FAILED" }),
      ]);
    expect(JSON.stringify(activities)).not.toContain("native-secret");
    expect(JSON.stringify(activities)).not.toContain("provider-token");
    expect(JSON.stringify(activities)).not.toContain("private-token");
    expect(JSON.stringify(activities)).toContain("[REDACTED]");
  });

  it("does not fail a successful Agent turn when activity persistence is unavailable", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const client = new FixtureClient([JSON.stringify({
      verdict: "NOT_A_BUG",
      suggestedTitle: "No change needed",
      reasoning: "The current behavior is expected.",
      rootCause: null,
      solution: null,
      suspectedDuplicateOf: null,
    })]);
    const adapter = new CodexAgentAdapter({
      client,
      sessions,
      reportActivity: () => { throw new Error("ACTIVITY_STORE_UNAVAILABLE"); },
    });

    await expect(adapter.assess(
      { agent: "codex", sessionId: "logical-1" },
      { issue: issue(), project },
    )).resolves.toMatchObject({ verdict: "NOT_A_BUG" });
  });

  it("reports failures thrown before Codex can emit a structured error event", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const activities: AgentActivityUpdate[] = [];
    const client = new FixtureClient([{
      error: new Error("stream disconnected before completion: error sending request"),
    }]);
    const adapter = new CodexAgentAdapter({
      client,
      sessions,
      reportActivity: (activity) => { activities.push(activity); },
    });

    await expect(adapter.assess(
      { agent: "codex", sessionId: "logical-1" },
      { issue: issue(), project },
    )).rejects.toThrow("stream disconnected");

    expect(activities).toEqual([
      expect.objectContaining({
        type: "AGENT_ERROR",
        message: "Codex 网络连接中断",
        detail: "stream disconnected before completion: error sending request",
      }),
    ]);
  });
});
