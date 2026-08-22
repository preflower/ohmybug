import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CodexAgentAdapter, codexAgent } from "../src/codex-agent-adapter.js";
import {
  isNativeThreadUnavailableError,
  NativeThreadUnavailableError,
  SdkCodexClient,
} from "../src/codex-client.js";
import { bindSession, createTempDir, FixtureClient, issue, MemorySessions, project } from "./helpers.js";

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
        { type: "item.completed", item: { type: "agent_message", text: JSON.stringify({
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
        summary: "Fixed",
        evidence: [{ type: "screenshot", label: "Proof", relativePath: "proof.png" }],
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

describe("native Codex thread error classification", () => {
  it("normalizes the exact SDK missing-rollout failure for the resumed thread", async () => {
    const threadId = "00000000-0000-4000-8000-000000000000";
    const error = await sdkResumeError(
      threadId,
      `Error: thread/resume: thread/resume failed: no rollout found for thread id ${threadId} (code -32600)`,
    );

    expect(error).toBeInstanceOf(NativeThreadUnavailableError);
    expect(error).toMatchObject({ code: "NATIVE_THREAD_UNAVAILABLE", threadId });
  });

  it("does not normalize a near-match SDK error", async () => {
    const threadId = "00000000-0000-4000-8000-000000000000";
    const error = await sdkResumeError(
      threadId,
      `Error: transport failed: no rollout found for thread id ${threadId} (code -32600)`,
    );

    expect(isNativeThreadUnavailableError(error)).toBe(false);
    expect((error as Error).message).toContain("transport failed");
  });
});

async function sdkResumeError(threadId: string, stderr: string): Promise<unknown> {
  const temporary = await createTempDir("oh-my-bug-codex-sdk-");
  try {
    const executable = join(temporary.path, "codex-fixture");
    await writeFile(executable, [
      "#!/bin/sh",
      `printf '%s\\n' '${stderr}' >&2`,
      "exit 1",
      "",
    ].join("\n"), "utf8");
    await chmod(executable, 0o755);
    const thread = new SdkCodexClient({ codexPathOverride: executable }).resumeThread(threadId, {
      workingDirectory: temporary.path,
      sandboxMode: "read-only",
      networkAccessEnabled: false,
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    });
    try {
      const events = await thread.runStreamed("probe", { outputSchema: {} });
      for await (const event of events) void event;
      throw new Error("EXPECTED_SDK_RESUME_FAILURE");
    } catch (error) {
      return error;
    } finally {
      await thread.dispose();
    }
  } finally {
    await temporary.cleanup();
  }
}
