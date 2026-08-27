import { describe, expect, it } from "vitest";

import type { AgentActivityUpdate } from "@oh-my-bug/core";

import { CodexAgentAdapter } from "../src/codex-agent-adapter.js";
import { bindSession, FixtureClient, issue, MemorySessions, project } from "./helpers.js";

describe("Codex activity reporting", () => {
  it("reports CLI-equivalent public activity without final output or private reasoning", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const activities: AgentActivityUpdate[] = [];
    const client = new FixtureClient([{
      events: [
        { type: "thread.started", threadId: "thread-1" },
        { type: "turn.started", threadId: "thread-1", turnId: "turn-1" },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "agent_message",
            id: "commentary-1",
            phase: "commentary",
            text: "I’ll trace token=public-secret checkout first.",
          },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "agent_message",
            id: "commentary-result-1",
            phase: "commentary",
            text: JSON.stringify({
              outcome: "RESULT",
              result: { verdict: "UNCERTAIN", reasoning: "Still inspecting" },
              capabilityRequest: null,
            }),
          },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "agent_message",
            id: "commentary-json-1",
            phase: "commentary",
            text: JSON.stringify({ path: "src/checkout.ts", matches: 2 }),
          },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "agent_message",
            id: "legacy-commentary-1",
            text: "Checking the legacy provider path.",
          },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "reasoning", id: "reasoning-1", summary: "Tracing checkout hydration" },
        },
        {
          type: "item.started",
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "command_execution",
            id: "command-1",
            command: "rg -n checkout src",
            status: "in_progress",
            output: "",
            actions: [{ type: "search", query: "checkout", path: "src" }],
          },
        },
        {
          type: "item.updated",
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "command_output", id: "command-1", delta: "Authorization: Bearer " },
        },
        {
          type: "item.updated",
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "command_output",
            id: "command-1",
            delta: "stream-secret\nAPI_KEY=\"quoted-secret\"\n{\"token\":\"json-secret\"}\n",
          },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "command_execution",
            id: "command-1",
            command: "rg -n checkout src",
            status: "completed",
            output: "src/checkout.ts:42",
            actions: [{ type: "search", query: "checkout", path: "src" }],
          },
        },
        {
          type: "item.updated",
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "plan",
            explanation: "Checkout path located",
            steps: [
              { step: "Trace checkout", status: "completed" },
              { step: "Fix hydration", status: "in_progress" },
            ],
          },
        },
        {
          type: "item.started",
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "collaboration", id: "wait-1", tool: "wait", status: "in_progress" },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "collaboration", id: "wait-1", tool: "wait", status: "completed" },
        },
        {
          type: "item.started",
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "collaboration", id: "wait-2", tool: "wait", status: "in_progress" },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "collaboration", id: "wait-2", tool: "wait", status: "failed" },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "agent_message",
            id: "final-1",
            phase: "final_answer",
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
        { type: "turn.completed", threadId: "thread-1", turnId: "turn-1" },
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
    )).resolves.toMatchObject({ verdict: "NOT_A_BUG" });

    expect(activities.map(({ type, message }) => ({ type, message }))).toEqual([
      { type: "AGENT_SESSION_CONNECTED", message: "Codex 会话已连接" },
      { type: "AGENT_TURN_STARTED", message: "Codex 开始分析" },
      { type: "AGENT_STATUS", message: "Started" },
      { type: "AGENT_STATUS", message: "Working" },
      { type: "AGENT_MESSAGE", message: "I’ll trace token=[REDACTED] checkout first." },
      { type: "AGENT_MESSAGE", message: '{"path":"src/checkout.ts","matches":2}' },
      { type: "AGENT_MESSAGE", message: "Tracing checkout hydration" },
      { type: "AGENT_STATUS", message: "Exploring" },
      { type: "AGENT_COMMAND_STARTED", message: "正在执行项目命令" },
      { type: "AGENT_COMMAND_OUTPUT", message: "命令输出" },
      { type: "AGENT_COMMAND_OUTPUT", message: "命令输出" },
      { type: "AGENT_COMMAND_OUTPUT", message: "命令输出" },
      { type: "AGENT_STATUS", message: "Explored" },
      { type: "AGENT_COMMAND_COMPLETED", message: "项目命令执行完成" },
      { type: "AGENT_STATUS", message: "Working" },
      { type: "AGENT_STATUS", message: "Waiting" },
      { type: "AGENT_STATUS", message: "Working" },
      { type: "AGENT_STATUS", message: "Waiting" },
      { type: "AGENT_STATUS", message: "Waiting failed" },
      { type: "AGENT_TURN_COMPLETED", message: "Codex 已完成分析" },
    ]);
    expect(activities.find((activity) => activity.message === "Exploring")?.detail)
      .toBe("Search checkout in src");
    expect(activities.filter((activity) => activity.type === "AGENT_COMMAND_OUTPUT").map(({ detail }) => detail))
      .toEqual([
        "Authorization: Bearer [REDACTED]\n",
        'API_KEY="[REDACTED]"\n',
        '{"token":"[REDACTED]"}\n',
      ]);
    expect(activities.findLast((activity) => activity.message === "Working")?.detail)
      .toBe("子 Agent 已返回");
    expect(activities.find((activity) => activity.message === "Waiting failed")).toMatchObject({
      detail: "等待子 Agent 失败",
      level: "error",
    });
    expect(JSON.stringify(activities)).not.toContain("private chain of thought");
    expect(JSON.stringify(activities)).not.toContain("suggestedTitle");
    expect(JSON.stringify(activities)).not.toContain("public-secret");
    expect(JSON.stringify(activities)).not.toContain("stream-secret");
    expect(JSON.stringify(activities)).not.toContain("quoted-secret");
    expect(JSON.stringify(activities)).not.toContain("json-secret");
  });

  it("reports cleanup diagnostics without failing a completed turn", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-cleanup", "thread-cleanup");
    const activities: AgentActivityUpdate[] = [];
    const client = new FixtureClient([{
      events: [
        { type: "turn.started", threadId: "thread-cleanup", turnId: "turn-cleanup" },
        {
          type: "item.completed",
          threadId: "thread-cleanup",
          turnId: "turn-cleanup",
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
        { type: "turn.completed", threadId: "thread-cleanup", turnId: "turn-cleanup" },
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

  it("summarizes pure read activity without exposing the command or file contents", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const activities: AgentActivityUpdate[] = [];
    const skillContents = "---\nname: using-superpowers\nsecret: private-skill-detail\n---\n";
    const client = new FixtureClient([{
      events: [
        { type: "thread.started", threadId: "thread-1" },
        { type: "turn.started", threadId: "thread-1", turnId: "turn-read" },
        {
          type: "item.started",
          threadId: "thread-1",
          turnId: "turn-read",
          item: {
            type: "command_execution",
            id: "read-skill",
            command: "sed -n '1,240p' .agents/skills/using-superpowers/SKILL.md",
            status: "in_progress",
            output: "",
            actions: [{
              type: "read",
              name: "SKILL.md",
              path: "/repo/.agents/skills/using-superpowers/SKILL.md",
            }],
          },
        },
        {
          type: "item.updated",
          threadId: "thread-1",
          turnId: "turn-read",
          item: { type: "command_output", id: "read-skill", delta: skillContents },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-read",
          item: {
            type: "command_execution",
            id: "read-skill",
            command: "sed -n '1,240p' .agents/skills/using-superpowers/SKILL.md",
            status: "completed",
            output: skillContents,
            actions: [{
              type: "read",
              name: "SKILL.md",
              path: "/repo/.agents/skills/using-superpowers/SKILL.md",
            }],
          },
        },
        {
          type: "item.updated",
          threadId: "thread-1",
          turnId: "turn-read",
          item: {
            type: "command_output",
            id: "read-skill",
            delta: "late-private-skill-detail\n",
          },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-read",
          item: {
            type: "agent_message",
            phase: "final_answer",
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
        { type: "turn.completed", threadId: "thread-1", turnId: "turn-read" },
      ],
    }]);
    const adapter = new CodexAgentAdapter({
      client,
      sessions,
      reportActivity: (activity) => { activities.push(activity); },
    });

    await adapter.assess(
      { agent: "codex", sessionId: "logical-1" },
      { issue: issue(), project },
    );

    expect(activities
      .filter((activity) => activity.correlationId === "read-skill")
      .map(({ type, message, detail }) => ({ type, message, detail })))
      .toEqual([
        { type: "AGENT_STATUS", message: "Exploring", detail: "Read using-superpowers/SKILL.md" },
        { type: "AGENT_STATUS", message: "Explored", detail: "Read using-superpowers/SKILL.md" },
      ]);
    expect(JSON.stringify(activities)).not.toContain("private-skill-detail");
    expect(JSON.stringify(activities)).not.toContain("sed -n");
  });

  it("reports a failed read without exposing its command or output", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const activities: AgentActivityUpdate[] = [];
    const readAction = {
      type: "read" as const,
      name: "SKILL.md",
      path: "/repo/.agents/skills/systematic-debugging/SKILL.md",
    };
    const client = new FixtureClient([{
      events: [
        { type: "thread.started", threadId: "thread-1" },
        { type: "turn.started", threadId: "thread-1", turnId: "turn-read-failed" },
        {
          type: "item.started",
          threadId: "thread-1",
          turnId: "turn-read-failed",
          item: {
            type: "command_execution",
            id: "read-failed",
            command: "sed -n '1,240p' private/SKILL.md",
            status: "in_progress",
            output: "",
            actions: [readAction],
          },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-read-failed",
          item: {
            type: "command_execution",
            id: "read-failed",
            command: "sed -n '1,240p' private/SKILL.md",
            status: "failed",
            output: "private-read-error-detail",
            actions: [readAction],
          },
        },
        { type: "turn.failed", threadId: "thread-1", turnId: "turn-read-failed", message: "read failed" },
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
    )).rejects.toThrow("read failed");

    expect(activities
      .filter((activity) => activity.correlationId === "read-failed")
      .map(({ type, message, detail, level }) => ({ type, message, detail, level })))
      .toEqual([
        {
          type: "AGENT_STATUS",
          message: "Exploring",
          detail: "Read systematic-debugging/SKILL.md",
          level: "info",
        },
        {
          type: "AGENT_STATUS",
          message: "Exploring failed",
          detail: "Read systematic-debugging/SKILL.md",
          level: "error",
        },
      ]);
    expect(JSON.stringify(activities)).not.toContain("private-read-error-detail");
    expect(JSON.stringify(activities)).not.toContain("sed -n");
  });

  it("preserves a multi-delta unterminated command line after completion", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const activities: AgentActivityUpdate[] = [];
    const streamedOutput = "x".repeat(2_100);
    const client = new FixtureClient([{
      events: [
        { type: "thread.started", threadId: "thread-1" },
        { type: "turn.started", threadId: "thread-1", turnId: "turn-stream" },
        {
          type: "item.started",
          threadId: "thread-1",
          turnId: "turn-stream",
          item: {
            type: "command_execution",
            id: "command-stream",
            command: "generate-output",
            status: "in_progress",
            output: "",
            actions: [],
          },
        },
        {
          type: "item.updated",
          threadId: "thread-1",
          turnId: "turn-stream",
          item: { type: "command_output", id: "command-stream", delta: streamedOutput.slice(0, 1_050) },
        },
        {
          type: "item.updated",
          threadId: "thread-1",
          turnId: "turn-stream",
          item: { type: "command_output", id: "command-stream", delta: streamedOutput.slice(1_050) },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-stream",
          item: {
            type: "command_execution",
            id: "command-stream",
            command: "generate-output",
            status: "completed",
            output: streamedOutput,
            actions: [],
          },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-stream",
          item: {
            type: "agent_message",
            phase: "final_answer",
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
        { type: "turn.completed", threadId: "thread-1", turnId: "turn-stream" },
      ],
    }]);
    const adapter = new CodexAgentAdapter({
      client,
      sessions,
      reportActivity: (activity) => { activities.push(activity); },
    });

    await adapter.assess(
      { agent: "codex", sessionId: "logical-1" },
      { issue: issue(), project },
    );

    expect(activities
      .filter((activity) => activity.type === "AGENT_COMMAND_OUTPUT")
      .map((activity) => activity.detail)
      .join(""))
      .toBe(streamedOutput);
  });

  it("reports useful turn, command, and network failure events with redacted details", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const activities: AgentActivityUpdate[] = [];
    const client = new FixtureClient([{
      events: [
        { type: "thread.started", threadId: "thread-1" },
        { type: "turn.started", threadId: "thread-1", turnId: "turn-1" },
        {
          type: "item.started",
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "command-1",
            type: "command_execution",
            command: "API_KEY=native-secret pnpm test",
            status: "in_progress",
            output: "",
            actions: [],
          },
        },
        {
          type: "item.completed",
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "command-1",
            type: "command_execution",
            command: "API_KEY=native-secret pnpm test",
            status: "failed",
            output: "Authorization: Bearer provider-token",
            actions: [],
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
      "AGENT_STATUS",
      "AGENT_STATUS",
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
