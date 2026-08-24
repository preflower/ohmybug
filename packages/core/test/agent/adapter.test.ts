import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AgentCapabilityRequiredError,
  AgentTurnInterruptedError,
  isAgentCapabilityRequiredError,
  isAgentTurnInterruptedError,
  type AgentContinuation,
  type AgentInterruptionReason,
  AgentAdapter,
  AgentSessionRef,
  Assessment,
  Issue,
  ProjectContext,
  RepairResult,
} from "../../src/index.js";

const issue = {
  id: "issue-1",
  projectId: "project-1",
  identifier: "OMB-1",
  title: "支付页打不开",
  titleSource: "user",
  status: "REPAIRING",
  inputs: [],
  revision: 3,
  createdAt: "2026-08-20T06:00:00.000Z",
  updatedAt: "2026-08-20T06:10:00.000Z",
} satisfies Issue;

const project = {
  id: "project-1",
  path: "/tmp/project-1",
  instructions: "Follow AGENTS.md",
  commands: { test: "pnpm test" },
} satisfies ProjectContext;

describe("AgentAdapter", () => {
  it("carries a structured capability request as non-failure control flow", () => {
    const error = new AgentCapabilityRequiredError({
      capabilities: ["HOST_EXECUTION", "NETWORK_ACCESS"],
      reason: "Launch Electron acceptance",
      blockedCommand: "pnpm test:e2e:electron",
      requestedBy: { type: "SKILL", id: "implement-ui-design" },
    });

    expect(error).toMatchObject({
      name: "AgentCapabilityRequiredError",
      code: "AGENT_CAPABILITY_REQUIRED",
      message: "AGENT_CAPABILITY_REQUIRED",
    });
    expect(isAgentCapabilityRequiredError(error)).toBe(true);
    expect(isAgentCapabilityRequiredError(new Error(error.message))).toBe(false);

    const continuation: AgentContinuation = {
      reason: "CAPABILITY_GRANTED",
      requestId: "request-1",
      capabilities: ["HOST_EXECUTION"],
    };
    expect(continuation.reason).toBe("CAPABILITY_GRANTED");
  });

  it.each(["RUNTIME_STOPPING", "USER_CANCELED"] as const)(
    "preserves the typed %s interruption reason",
    (reason) => {
      const error = new AgentTurnInterruptedError(reason);

      expect(error).toMatchObject({
        name: "AgentTurnInterruptedError",
        code: "AGENT_TURN_INTERRUPTED",
        reason,
        message: `AGENT_TURN_INTERRUPTED:${reason}`,
      });
      expect(isAgentTurnInterruptedError(error)).toBe(true);
      expect(isAgentTurnInterruptedError(new Error(error.message))).toBe(false);
    },
  );

  it("exposes session, assessment, repair, evidence, and cancellation capabilities", () => {
    expectTypeOf<keyof AgentAdapter>().toEqualTypeOf<
      "createSession" | "assess" | "repair" | "captureEvidence" | "cancel"
    >();
  });

  it("reuses one logical session for assessment and repair", async () => {
    const usedSessions: string[] = [];
    const cancellations: Array<{
      sessionId: string;
      reason: AgentInterruptionReason;
    }> = [];
    const session: AgentSessionRef = { agent: "fake", sessionId: "session-1" };
    const assessment: Assessment = {
      revision: 1,
      contentHash: "a".repeat(64),
      verdict: "BUG",
      suggestedTitle: "支付页打不开",
      reasoning: "可复现",
    };
    const repair: RepairResult = {
      summary: "恢复支付页",
      evidence: [
        {
          type: "screenshot",
          label: "支付页正常显示",
          relativePath: "proof.png",
        },
      ],
    };

    const adapter: AgentAdapter = {
      async createSession() {
        return session;
      },
      async assess(ref) {
        usedSessions.push(ref.sessionId);
        return assessment;
      },
      async repair(ref) {
        usedSessions.push(ref.sessionId);
        return repair;
      },
      async captureEvidence(ref) {
        usedSessions.push(ref.sessionId);
        return { evidence: repair.evidence };
      },
      async cancel(ref, reason) {
        cancellations.push({ sessionId: ref.sessionId, reason });
      },
    };

    const ref = await adapter.createSession({ issue, project });
    await adapter.assess(ref, { issue, project });
    await adapter.repair(ref, {
      issue,
      project,
      assessment,
      evidenceDirectory: "/tmp/evidence/issue-1/1",
    });
    await adapter.captureEvidence(ref, {
      issue,
      project,
      assessment,
      deliveryDraft: {
        summary: repair.summary,
        repairIteration: 1,
        implementationCompletedAt: "2026-08-20T06:15:00.000Z",
      },
      evidenceDirectory: "/tmp/evidence/issue-1/1",
    });
    await adapter.cancel(ref, "USER_CANCELED");

    expect(usedSessions).toEqual(["session-1", "session-1", "session-1"]);
    expect(cancellations).toEqual([{
      sessionId: "session-1",
      reason: "USER_CANCELED",
    }]);
  });
});
