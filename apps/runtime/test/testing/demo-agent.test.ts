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
  it("uses an unsafe default and supports a deterministic recovery fixture", async () => {
    const sessions = new MemorySessions();
    const issue = receivedIssue();
    const unsafeAdapter = new DemoAgentAdapter({ sessions });
    const session = await unsafeAdapter.createSession({ issue, project });
    await sessions.save({
      agent: session.agent,
      logicalSessionId: session.sessionId,
      issueId: issue.id,
      projectId: project.id,
      lifecycle: "ACTIVE",
      updatedAt: now,
    });
    const input = {
      issue: { ...issue, status: "FINALIZATION_RECOVERY" as const },
      project,
      diagnostic: {
        providerId: "git",
        step: "add" as const,
        code: "GIT_ADD_FAILED",
        message: "git add failed",
        relatedPaths: [".pnpm-store"],
      },
      workspaceStatus: "?? .pnpm-store/",
      fingerprintSummary: "approved content unchanged",
      recoveryKind: "GENERATED_ARTIFACT_CLEANUP" as const,
    };

    await expect(unsafeAdapter.recoverFinalization!(session, input)).resolves.toMatchObject({
      disposition: "UNSAFE",
      affectedPaths: [],
    });

    const configured = new DemoAgentAdapter({
      sessions,
      finalizationRecoveryResult: {
        summary: "Removed generated pollution",
        diagnosis: "A package-manager cache contained a nested repository",
        disposition: "RECOVERED",
        affectedPaths: [".pnpm-store"],
      },
    });
    await expect(configured.recoverFinalization!(session, input)).resolves.toMatchObject({
      disposition: "RECOVERED",
      affectedPaths: [".pnpm-store"],
    });
  });

  it("keeps one native session across implementation and evidence capture", async () => {
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
        kind: "DELIVERY_READY",
        summary: "The failing path now returns a recoverable result.",
        evidence: [],
        verification: [{
          command: "pnpm test",
          outcome: "PASSED",
          summary: "configured tests passed",
        }],
      });
      const evidenceResult = await adapter.captureEvidence(session, {
        issue: {
          ...repairing,
          status: "EVIDENCE_CAPTURE",
          repair: {
            iteration: 1,
            deliveryDraft: {
              summary: result.summary,
              repairIteration: 1,
              implementationCompletedAt: now,
            },
          },
        },
        project,
        assessment,
        deliveryDraft: {
          summary: result.summary,
          repairIteration: 1,
          implementationCompletedAt: now,
        },
        evidenceDirectory,
      });
      expect(evidenceResult).toEqual({ evidence: [{
          type: "screenshot",
          label: "Checkout acceptance",
          relativePath: "checkout-acceptance.png",
        }] });
      const image = await readFile(join(evidenceDirectory, evidenceResult.evidence[0]!.relativePath));
      expect(image.subarray(1, 4).toString()).toBe("PNG");
    } finally {
      await rm(evidenceDirectory, { recursive: true, force: true });
    }
  });

  it("captures Repair integration/review continuation and can queue a business decision", async () => {
    const sessions = new MemorySessions();
    const businessDecision = {
      kind: "BUSINESS_DECISION_REQUIRED" as const,
      summary: "Choose one behavior",
      decision: {
        baseCommit: "a".repeat(40),
        issueCommit: "b".repeat(40),
        conflictPaths: ["src/total.ts"],
        baseIntent: "Round total",
        issueIntent: "Round lines",
        incompatibility: "Totals differ",
        recommendation: "Use Issue",
        rationale: "Matches examples",
        choices: [{ id: "use-issue", label: "Use Issue", description: "Round lines" }],
      },
    };
    const adapter = new DemoAgentAdapter({ sessions, repairResults: [businessDecision] });
    const issue = receivedIssue("issue-review");
    const session = await adapter.createSession({ issue, project });
    await sessions.save({
      agent: session.agent,
      logicalSessionId: session.sessionId,
      issueId: issue.id,
      projectId: project.id,
      lifecycle: "ACTIVE",
      updatedAt: now,
    });
    const assessment = await adapter.assess(session, { issue, project });
    const input = {
      issue: { ...issue, status: "REPAIRING" as const, assessment, repair: { iteration: 1 } },
      project,
      assessment,
      evidenceDirectory: "/tmp/evidence",
      integration: {
        baseBranch: "main",
        observedBaseCommit: "a".repeat(40),
        issueBranch: "ohmybug/issue-review",
      },
      continuation: {
        reason: "REVIEW_SUBMITTED" as const,
        requestId: "review-1",
        kind: "business-merge-conflict",
        choiceId: "use-issue",
      },
    };

    await expect(adapter.repair(session, input)).resolves.toEqual(businessDecision);
    expect(adapter.repairInputs).toEqual([input]);
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
      const result = await adapter.repair(session, {
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
      await adapter.captureEvidence(session, {
        issue: {
          ...issue,
          status: "EVIDENCE_CAPTURE",
          assessment,
          repair: {
            iteration: 1,
            deliveryDraft: {
              summary: result.summary,
              repairIteration: 1,
              implementationCompletedAt: now,
            },
          },
        },
        project,
        assessment,
        deliveryDraft: {
          summary: result.summary,
          repairIteration: 1,
          implementationCompletedAt: now,
        },
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
