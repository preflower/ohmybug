import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentSessionRecord, Issue } from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import { DemoAgentAdapter } from "../../src/testing/demo-agent.js";
import { now, project } from "../helpers/runtime.js";

class MemorySessions {
  readonly values = new Map<string, AgentSessionRecord>();
  async get(id: string) { return this.values.get(id); }
  async save(record: AgentSessionRecord) { this.values.set(record.logicalSessionId, record); }
}

function receivedIssue(id = "issue-1"): Issue {
  return {
    id,
    projectId: project.id,
    identifier: "OMB-1",
    title: "Checkout returns 500",
    titleSource: "integration",
    status: "RECEIVED",
    inputs: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe("demo Agent adapter", () => {
  it("keeps one native session across Assessment and Repair and returns a relative evidence path", async () => {
    const sessions = new MemorySessions();
    const adapter = new DemoAgentAdapter({
      sessions,
      now: () => new Date(now),
    });
    const issue = receivedIssue();
    const session = await adapter.createSession({ issue, project });
    await sessions.save({
      agent: session.agent,
      logicalSessionId: session.sessionId,
      issueId: issue.id,
      projectId: project.id,
      lifecycle: "ACTIVE",
      updatedAt: now,
    });
    const evidenceDirectory = await mkdtemp(join(tmpdir(), "omb-demo-evidence-"));
    try {
      const assessment = await adapter.assess(session, { issue, project });
      const repairing = {
        ...issue,
        status: "REPAIRING" as const,
        assessment,
        repair: { iteration: 1 },
      };
      const result = await adapter.repair(session, {
        issue: repairing,
        project,
        assessment,
        evidenceDirectory,
      });

      expect(session).toEqual({ agent: "demo", sessionId: "demo-issue-1-1" });
      expect(sessions.values.get(session.sessionId)?.providerSessionId)
        .toBe("demo-native-demo-issue-1-1");
      expect(result).toEqual({
        summary: "The failing path now returns a recoverable result.",
        evidence: [{
          type: "screenshot",
          label: "Checkout acceptance",
          relativePath: "checkout-acceptance.png",
        }],
      });
      const image = await readFile(join(evidenceDirectory, result.evidence[0]!.relativePath));
      expect(image.subarray(1, 4).toString()).toBe("PNG");
    } finally {
      await rm(evidenceDirectory, { recursive: true, force: true });
    }
  });

  it("cancels an in-flight deterministic turn", async () => {
    const sessions = new MemorySessions();
    const adapter = new DemoAgentAdapter({ sessions, delayMs: 30_000 });
    const issue = receivedIssue("issue-cancel");
    const session = await adapter.createSession({ issue, project });
    await sessions.save({
      agent: session.agent,
      logicalSessionId: session.sessionId,
      issueId: issue.id,
      projectId: project.id,
      lifecycle: "ACTIVE",
      updatedAt: now,
    });

    const assessing = adapter.assess(session, { issue, project });
    await Promise.resolve();
    await adapter.cancel(session, "USER_CANCELED");

    await expect(assessing).rejects.toMatchObject({
      code: "AGENT_TURN_INTERRUPTED",
      reason: "USER_CANCELED",
    });
  });

  it("never writes outside the Runtime-provided evidence directory", async () => {
    const sessions = new MemorySessions();
    const adapter = new DemoAgentAdapter({ sessions });
    const issue = receivedIssue("issue-scope");
    const session = await adapter.createSession({ issue, project });
    await sessions.save({
      agent: session.agent,
      logicalSessionId: session.sessionId,
      issueId: issue.id,
      projectId: project.id,
      lifecycle: "ACTIVE",
      updatedAt: now,
    });
    const evidenceDirectory = await mkdtemp(join(tmpdir(), "omb-demo-scope-"));
    const assessment = await adapter.assess(session, { issue, project });
    try {
      await adapter.repair(session, {
        issue: {
          ...issue,
          status: "REPAIRING",
          assessment,
          repair: { iteration: 1 },
        },
        project,
        assessment,
        evidenceDirectory,
      });
      await expect(access(join(evidenceDirectory, "checkout-acceptance.png")))
        .resolves.toBeUndefined();
      await expect(access(join(project.path, "checkout-acceptance.png"))).rejects.toThrow();
    } finally {
      await rm(evidenceDirectory, { recursive: true, force: true });
    }
  });

  it("creates a disclosed replacement session and recovers from a missing native session", async () => {
    const sessions = new MemorySessions();
    const adapter = new DemoAgentAdapter({
      sessions,
      unavailableOnce: true,
    });
    const issue = receivedIssue("issue-missing");
    const first = await adapter.createSession({ issue, project });
    await sessions.save({
      agent: first.agent,
      logicalSessionId: first.sessionId,
      issueId: issue.id,
      projectId: project.id,
      lifecycle: "ACTIVE",
      updatedAt: now,
    });

    await expect(adapter.assess(first, { issue, project }))
      .rejects.toThrow("AGENT_SESSION_UNAVAILABLE");
    const replacement = await adapter.createSession({ issue, project });
    expect(replacement.sessionId).not.toBe(first.sessionId);
    await sessions.save({
      agent: replacement.agent,
      logicalSessionId: replacement.sessionId,
      issueId: issue.id,
      projectId: project.id,
      lifecycle: "ACTIVE",
      updatedAt: now,
    });

    await expect(adapter.assess(replacement, { issue, project }))
      .resolves.toMatchObject({ verdict: "BUG" });
    expect(sessions.values.get(replacement.sessionId)?.providerSessionId)
      .toBe(`demo-native-${replacement.sessionId}`);
  });
});
