import type { Assessment } from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import { CodexAgentAdapter } from "../src/codex-agent-adapter.js";
import { evidencePrompt } from "../src/prompts.js";
import { bindSession, FixtureClient, issue, MemorySessions, project } from "./helpers.js";

const assessment: Assessment = {
  revision: 1,
  contentHash: "a".repeat(64),
  verdict: "BUG",
  suggestedTitle: "Checkout fails",
  reasoning: "Reproduced",
  rootCause: "Null cart",
  solution: "Handle expiry",
};

describe("Codex evidence capture", () => {
  it("corrects an already-available capability request exactly once", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-redundant", "thread-redundant");
    const client = new FixtureClient([
      JSON.stringify({
        outcome: "CAPABILITY_REQUIRED",
        capabilities: ["HOST_EXECUTION"],
        reason: "Launch acceptance",
        blockedCommand: null,
        requestedBy: null,
      }),
      JSON.stringify({ evidence: [{
        type: "screenshot",
        label: "Payment page",
        relativePath: "payment.png",
      }] }),
    ]);
    const adapter = new CodexAgentAdapter({ client, sessions });
    const current = evidenceIssue();

    await expect(adapter.captureEvidence(
      { agent: "codex", sessionId: "logical-redundant" },
      evidenceInput(current, "full-access"),
    )).resolves.toMatchObject({ evidence: [{ relativePath: "payment.png" }] });
    expect(client.prompts).toHaveLength(2);
    expect(client.prompts[1]).toContain("already available in this stage");
  });

  it("rejects a repeated already-available request after one correction", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-loop", "thread-loop");
    const redundant = JSON.stringify({
      outcome: "CAPABILITY_REQUIRED",
      capabilities: ["NETWORK_ACCESS"],
      reason: "Access network",
      blockedCommand: null,
      requestedBy: null,
    });
    const client = new FixtureClient([redundant, redundant]);
    const adapter = new CodexAgentAdapter({ client, sessions });
    const current = evidenceIssue();

    await expect(adapter.captureEvidence(
      { agent: "codex", sessionId: "logical-loop" },
      evidenceInput(current, "full-access"),
    )).rejects.toThrow("AGENT_CAPABILITY_REQUEST_INVALID");
    expect(client.prompts).toHaveLength(2);
  });

  it("does not claim that request-mode Evidence already has host and network access", () => {
    const current = issue({
      status: "EVIDENCE_CAPTURE",
      assessment,
      repair: {
        iteration: 1,
        deliveryDraft: {
          summary: "Implemented",
          repairIteration: 1,
          implementationCompletedAt: "2026-08-24T08:00:00.000Z",
        },
      },
    });
    const prompt = evidencePrompt({
      issue: current,
      project,
      assessment,
      deliveryDraft: current.repair!.deliveryDraft!,
      evidenceDirectory: "/workspace/evidence",
    });

    expect(prompt).toContain("CAPABILITY_REQUIRED");
    expect(prompt).toContain("Capabilities already available in this stage: []");
    expect(prompt).not.toContain('Capabilities already available in this stage: ["HOST_EXECUTION"');
  });

  it("captures evidence on the same native thread without reimplementing", async () => {
    const client = new FixtureClient([JSON.stringify({
      evidence: [{
        type: "screenshot",
        label: "Payment page",
        relativePath: "payment.png",
      }],
    })]);
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-1", "thread-1");
    const adapter = new CodexAgentAdapter({ client, sessions });
    const repairing = issue({
      status: "EVIDENCE_CAPTURE",
      assessment,
      repair: {
        iteration: 2,
        deliveryDraft: {
          summary: "Payment route restored",
          repairIteration: 2,
          implementationCompletedAt: "2026-08-22T10:00:00.000Z",
        },
      },
    });

    const result = await adapter.captureEvidence(
      { agent: "codex", sessionId: "logical-1" },
      {
        issue: repairing,
        project,
        assessment,
        deliveryDraft: repairing.repair!.deliveryDraft!,
        evidenceDirectory: "/workspace/evidence",
        feedback: "Previous screenshot was blank",
      },
    );

    expect(result.evidence).toEqual([{
      type: "screenshot",
      label: "Payment page",
      relativePath: "payment.png",
    }]);
    expect(client.resumes[0]?.threadId).toBe("thread-1");
    expect(client.resumes[0]).toMatchObject({
      threadId: "thread-1",
      options: {
        workingDirectory: repairing.projectPath,
        sandboxMode: "workspace-write",
        networkAccessEnabled: false,
        approvalPolicy: "never",
      },
    });
    expect(client.prompts.at(-1)).toContain("Do not reimplement or refactor");
    expect(client.prompts.at(-1)).toContain("Previous screenshot was blank");
  });

  it.each([
    ["request-approval", "workspace-write", false, "never", undefined],
    ["auto-review", "workspace-write", false, "on-request", "auto_review"],
    ["full-access", "danger-full-access", true, "never", undefined],
  ] as const)(
    "applies the %s project permission mode to Evidence turns",
    async (permissionMode, sandboxMode, networkAccessEnabled, approvalPolicy, approvalsReviewer) => {
      const sessions = new MemorySessions();
      await bindSession(sessions, `logical-${permissionMode}`, `thread-${permissionMode}`);
      const client = new FixtureClient([JSON.stringify({ evidence: [{
        type: "screenshot",
        label: "Permission mode evidence",
        relativePath: "permission-mode.png",
      }] })]);
      const adapter = new CodexAgentAdapter({ client, sessions });
      const current = evidenceIssue();

      await adapter.captureEvidence(
        { agent: "codex", sessionId: `logical-${permissionMode}` },
        evidenceInput(current, permissionMode),
      );

      expect(client.resumes[0]?.options).toMatchObject({
        sandboxMode,
        networkAccessEnabled,
        approvalPolicy,
      });
      if (approvalsReviewer) {
        expect(client.resumes[0]?.options).toMatchObject({ approvalsReviewer });
      } else {
        expect(client.resumes[0]?.options).not.toHaveProperty("approvalsReviewer");
      }
    },
  );
});

function evidenceIssue() {
  return issue({
    status: "EVIDENCE_CAPTURE",
    assessment,
    repair: {
      iteration: 1,
      deliveryDraft: {
        summary: "Implemented",
        repairIteration: 1,
        implementationCompletedAt: "2026-08-24T08:00:00.000Z",
      },
    },
  });
}

function evidenceInput(
  current: ReturnType<typeof evidenceIssue>,
  permissionMode: "request-approval" | "auto-review" | "full-access" = "request-approval",
) {
  return {
    issue: current,
    project: { ...project, permissionMode },
    assessment,
    deliveryDraft: current.repair!.deliveryDraft!,
    evidenceDirectory: "/workspace/evidence",
  };
}
