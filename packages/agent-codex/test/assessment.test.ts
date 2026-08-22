import { describe, expect, it } from "vitest";

import { canonicalHash } from "@oh-my-bug/core";

import { CodexAgentAdapter } from "../src/codex-agent-adapter.js";
import type { CodexClient } from "../src/codex-client.js";
import { assessmentOutputSchema } from "../src/output-schemas.js";
import { bindSession, FixtureClient, issue, MemorySessions, project } from "./helpers.js";

describe("Codex assessment", () => {
  it("uses the fixed nullable object shape required by Codex structured outputs", () => {
    expect([...assessmentOutputSchema.required].sort()).toEqual(
      Object.keys(assessmentOutputSchema.properties).sort(),
    );
    expect(assessmentOutputSchema.properties.rootCause.type).toEqual(["string", "null"]);
    expect(assessmentOutputSchema.properties.solution.type).toEqual(["string", "null"]);
    expect(assessmentOutputSchema.properties.suspectedDuplicateOf.type).toEqual(["string", "null"]);
  });

  it("creates only a logical reference, then runs read-only and persists the first native thread", async () => {
    const content = {
      verdict: "BUG",
      suggestedTitle: "Expired checkout session returns 500",
      reasoning: "The failure is reproducible.",
      rootCause: "Null cart hydration.",
      solution: "Handle expired sessions.",
    } as const;
    const sessions = new MemorySessions();
    const client = new FixtureClient([JSON.stringify(content)]);
    const adapter = new CodexAgentAdapter({
      client,
      sessions,
      id: () => "logical-1",
      now: () => new Date("2026-08-20T10:02:00.000Z"),
    });
    const current = issue({ projectPath: "/tmp/worktrees/CHK-1" });
    const session = await adapter.createSession({ issue: current, project });

    expect(session).toEqual({ agent: "codex", sessionId: "logical-1" });
    expect(sessions.values.size).toBe(0);
    await bindSession(sessions);
    const assessment = await adapter.assess(session, { issue: current, project });

    expect(assessment).toEqual({ revision: current.revision, contentHash: canonicalHash(content), ...content });
    expect(client.starts).toEqual([expect.objectContaining({
      workingDirectory: current.projectPath,
      sandboxMode: "read-only",
      networkAccessEnabled: false,
      approvalPolicy: "never",
    })]);
    expect(client.starts[0]).not.toHaveProperty("model");
    expect(sessions.values.get("logical-1")).toMatchObject({ providerSessionId: "thread-1" });
  });

  it("maps nullable Codex fields back to absent Core assessment fields", async () => {
    const sessions = new MemorySessions();
    const client = new FixtureClient([JSON.stringify({
      verdict: "NOT_A_BUG",
      suggestedTitle: "Theme controls are already available",
      reasoning: "The reported behavior matches the current product design.",
      rootCause: null,
      solution: null,
      suspectedDuplicateOf: null,
    })]);
    const adapter = new CodexAgentAdapter({ client, sessions, id: () => "logical-1" });
    const current = issue();
    const session = await adapter.createSession({ issue: current, project });
    await bindSession(sessions);

    const assessment = await adapter.assess(session, { issue: current, project });

    expect(assessment).toMatchObject({
      verdict: "NOT_A_BUG",
      suggestedTitle: "Theme controls are already available",
      reasoning: "The reported behavior matches the current product design.",
    });
    expect(assessment).not.toHaveProperty("rootCause");
    expect(assessment).not.toHaveProperty("solution");
    expect(assessment).not.toHaveProperty("suspectedDuplicateOf");
  });

  it("classifies and validates a Feature assessment", async () => {
    const content = {
      verdict: "FEATURE",
      suggestedTitle: "Add CSV export",
      reasoning: "CSV export is a new capability.",
      rootCause: null,
      solution: "Add an export action and CSV serializer.",
      suspectedDuplicateOf: null,
    } as const;
    const sessions = new MemorySessions();
    const client = new FixtureClient([JSON.stringify(content)]);
    const adapter = new CodexAgentAdapter({ client, sessions, id: () => "logical-feature" });
    const current = issue();
    const session = await adapter.createSession({ issue: current, project });
    await bindSession(sessions, "logical-feature");

    await expect(adapter.assess(session, {
      issue: current,
      project,
      continuation: {
        reason: "RUNTIME_INTERRUPTED",
        previousAttemptId: "attempt-before-restart",
      },
    })).resolves.toMatchObject({
      verdict: "FEATURE",
      solution: "Add an export action and CSV serializer.",
    });
    expect(client.prompts[0]).toContain("FEATURE for a new capability or enhancement");
    expect(client.prompts[0]).toContain(
      "The previous turn was interrupted by a Runtime restart.",
    );
    expect(client.prompts[0]).toContain("Do not redo completed implementation work.");
  });

  it("clears active-session state when thread creation fails", async () => {
    const client: CodexClient = {
      startThread: () => { throw new Error("THREAD_START_FAILED"); },
      resumeThread: () => { throw new Error("THREAD_START_FAILED"); },
    };
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const adapter = new CodexAgentAdapter({ client, sessions });
    const session = { agent: "codex" as const, sessionId: "logical-1" };

    await expect(adapter.assess(session, { issue: issue(), project })).rejects.toThrow("THREAD_START_FAILED");
    await expect(adapter.assess(session, { issue: issue(), project })).rejects.toThrow("THREAD_START_FAILED");
  });
});
