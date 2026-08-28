import { describe, expect, it, vi } from "vitest";

import type { Assessment } from "@oh-my-bug/core";

import { CodexAgentAdapter } from "../src/codex-agent-adapter.js";
import {
  parseRepairOutput,
  repairOutputSchema,
} from "../src/output-schemas.js";
import { repairPrompt } from "../src/prompts.js";
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

function deliveryOutput(summary: string, evidence: unknown[]) {
  return {
    kind: "DELIVERY_READY",
    summary,
    evidence,
    integration: null,
    verification: [{
      command: "pnpm test",
      outcome: "PASSED",
      summary: "Configured tests passed",
    }],
  };
}

describe("Codex repair", () => {
  const integration = {
    baseBranch: "main",
    observedBaseCommit: "a".repeat(40),
    issueBranch: "ohmybug/ohmybug-19",
  };
  const deliveryReady = {
    kind: "DELIVERY_READY",
    summary: "Integrated main and fixed checkout",
    evidence: [],
    integration: {
      baseCommit: integration.observedBaseCommit,
      issueCommit: "b".repeat(40),
      conflicts: [],
    },
    verification: [{
      command: "pnpm test",
      outcome: "PASSED",
      summary: "Configured tests passed",
    }],
  } as const;

  it.each([
    ["request-approval", "workspace-write", true, "never", undefined],
    ["auto-review", "workspace-write", true, "on-request", "auto_review"],
    ["full-access", "danger-full-access", true, "never", undefined],
  ] as const)(
    "applies the %s project permission mode to Repair turns",
    async (permissionMode, sandboxMode, networkAccessEnabled, approvalPolicy, approvalsReviewer) => {
      const sessionId = `logical-repair-${permissionMode}`;
      const sessions = new MemorySessions();
      await bindSession(sessions, sessionId, `thread-repair-${permissionMode}`);
      const client = new FixtureClient([JSON.stringify(deliveryOutput("Implemented", []))]);
      const adapter = new CodexAgentAdapter({ client, sessions });

      await adapter.repair(
        { agent: "codex", sessionId },
        {
          issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 1 } }),
          project: { ...project, permissionMode },
          assessment,
          evidenceDirectory: "/private/intake/issue-1/1",
        },
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

  it("parses delivery-ready and business-decision output branches", () => {
    const decision = {
      kind: "BUSINESS_DECISION_REQUIRED",
      summary: "Only one rounding behavior can remain",
      decision: {
        baseCommit: integration.observedBaseCommit,
        issueCommit: "b".repeat(40),
        conflictPaths: ["src/billing/total.ts"],
        baseIntent: "Round the invoice total",
        issueIntent: "Round every line",
        incompatibility: "The same invoice produces different totals",
        recommendation: "Use Issue behavior",
        rationale: "It matches the acceptance examples",
        choices: [{
          id: "use-issue",
          label: "Use Issue behavior",
          description: "Apply per-line rounding",
        }],
      },
    } as const;

    expect(parseRepairOutput({
      outcome: "RESULT",
      result: deliveryReady,
      capabilityRequest: null,
    })).toEqual(deliveryReady);
    expect(parseRepairOutput({
      outcome: "RESULT",
      result: decision,
      capabilityRequest: null,
    })).toEqual(decision);
    expect(repairOutputSchema).toMatchObject({ type: "object" });
  });

  it("rejects incomplete integration results and unbounded business decisions", () => {
    expect(() => parseRepairOutput({ ...deliveryReady, verification: [] }))
      .toThrow();
    expect(() => parseRepairOutput({
      kind: "BUSINESS_DECISION_REQUIRED",
      summary: "Choose",
      decision: {
        baseCommit: "a".repeat(40),
        issueCommit: "b".repeat(40),
        conflictPaths: ["../outside.ts"],
        baseIntent: "x".repeat(5_000),
        issueIntent: "Issue",
        incompatibility: "Different behavior",
        recommendation: "Choose Issue",
        rationale: "Matches acceptance",
        choices: [],
      },
    })).toThrow();
  });

  it("grants only Issue-Worktree Git authority and includes review continuation", () => {
    const prompt = repairPrompt({
      issue: issue({
        projectPath: "/tmp/worktrees/OHMYBUG-19",
        status: "REPAIRING",
        assessment,
        repair: { iteration: 1 },
      }),
      project,
      assessment,
      evidenceDirectory: "/private/intake/issue-1/1",
      integration,
      continuation: {
        reason: "REVIEW_SUBMITTED",
        requestId: "review-19",
        kind: "business-merge-conflict",
        choiceId: "use-issue",
        feedback: "Keep the public API stable",
        data: { approvedBy: "owner" },
      },
    });

    for (const text of [
      `Observed base: main@${integration.observedBaseCommit}`,
      "Issue branch: ohmybug/ohmybug-19",
      "Merge the observed base commit into the Issue branch in this Issue Worktree.",
      "Resolve textual and compatible business conflicts yourself.",
      "Return BUSINESS_DECISION_REQUIRED only when the observable business behaviors are mutually exclusive.",
      "You may stage and commit only in this Issue Worktree.",
      "Do not mutate the base Worktree, another Worktree, non-Issue refs, remotes, hooks, or Git configuration.",
      "Do not rebase or rewrite accepted history.",
      'Selected review choice: "use-issue"',
      "Keep the public API stable",
      '{"approvedBy":"owner"}',
    ]) expect(prompt).toContain(text);
  });

  it("returns a completed Repair result when thread disposal fails", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-cleanup", "thread-cleanup");
    const cleanupError = Object.assign(new Error("directory not empty"), { code: "ENOTEMPTY" });
    const reportActivity = vi.fn();
    const adapter = new CodexAgentAdapter({
      sessions,
      client: new FixtureClient([
        JSON.stringify(deliveryOutput("Implemented", [])),
      ], cleanupError),
      reportActivity,
    });

    await expect(adapter.repair(
      { agent: "codex", sessionId: "logical-cleanup" },
      {
        issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 1 } }),
        project,
        assessment,
        evidenceDirectory: "/private/intake/issue-1/1",
      },
    )).resolves.toEqual({
      kind: "DELIVERY_READY",
      summary: "Implemented",
      evidence: [],
      verification: [{
        command: "pnpm test",
        outcome: "PASSED",
        summary: "Configured tests passed",
      }],
    });
    expect(reportActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: "AGENT_TEMP_CLEANUP_FAILED",
      stage: "REPAIR",
      level: "error",
    }));
  });

  it("keeps a turn failure primary when thread disposal also fails", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-primary", "thread-primary");
    const primary = new Error("repair turn failed");
    const adapter = new CodexAgentAdapter({
      sessions,
      client: new FixtureClient([{ error: primary }], new Error("cleanup failed")),
    });

    await expect(adapter.repair(
      { agent: "codex", sessionId: "logical-primary" },
      {
        issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 1 } }),
        project,
        assessment,
        evidenceDirectory: "/private/intake/issue-1/1",
      },
    )).rejects.toBe(primary);
  });

  it("turns a structured capability branch into typed control flow without AGENT_ERROR", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-capability", "thread-capability");
    const client = new FixtureClient([JSON.stringify({
      outcome: "CAPABILITY_REQUIRED",
      capabilities: ["HOST_EXECUTION"],
      reason: "Launch Electron acceptance",
      blockedCommand: "pnpm test:e2e:electron",
      requestedBy: { type: "SKILL", id: "implement-ui-design" },
    })]);
    const reportActivity = vi.fn();
    const adapter = new CodexAgentAdapter({ client, sessions, reportActivity });

    await expect(adapter.repair(
      { agent: "codex", sessionId: "logical-capability" },
      {
        issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 1 } }),
        project,
        assessment,
        evidenceDirectory: "/private/intake/issue-1/1",
      },
    )).rejects.toMatchObject({
      code: "AGENT_CAPABILITY_REQUIRED",
      request: {
        capabilities: ["HOST_EXECUTION"],
        reason: "Launch Electron acceptance",
      },
    });
    expect(reportActivity).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "AGENT_ERROR" }),
    );
  });

  it("uses one corrective continuation for a permission-like failure", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-correction", "thread-correction");
    const client = new FixtureClient([
      { events: [
        { type: "thread.started", threadId: "thread-correction" },
        { type: "turn.started", threadId: "thread-correction", turnId: "turn-1" },
        {
          type: "turn.failed",
          threadId: "thread-correction",
          turnId: "turn-1",
          message: "permission denied by sandbox",
        },
      ] },
      JSON.stringify({
        outcome: "CAPABILITY_REQUIRED",
        capabilities: ["HOST_EXECUTION"],
        reason: "Launch Electron acceptance",
        blockedCommand: null,
        requestedBy: null,
      }),
    ]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await expect(adapter.repair(
      { agent: "codex", sessionId: "logical-correction" },
      {
        issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 1 } }),
        project,
        assessment,
        evidenceDirectory: "/private/intake/issue-1/1",
      },
    )).rejects.toMatchObject({ code: "AGENT_CAPABILITY_REQUIRED" });
    expect(client.prompts).toHaveLength(2);
    expect(client.prompts[1]).toContain("Do not retry the blocked command");
  });

  it("applies Issue grants to Repair turn options", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-granted", "thread-granted");
    const client = new FixtureClient([JSON.stringify(deliveryOutput("Implemented", []))]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await adapter.repair(
      { agent: "codex", sessionId: "logical-granted" },
      {
        issue: issue({
          status: "REPAIRING",
          assessment,
          repair: { iteration: 1 },
          capabilityGrants: [
            { capability: "HOST_EXECUTION", requestId: "host", grantedAt: "2026-08-24T08:00:00.000Z" },
            { capability: "NETWORK_ACCESS", requestId: "network", grantedAt: "2026-08-24T08:00:00.000Z" },
          ],
        }),
        project,
        assessment,
        evidenceDirectory: "/private/intake/issue-1/1",
      },
    );

    expect(client.resumes[0]?.options).toMatchObject({
      sandboxMode: "danger-full-access",
      networkAccessEnabled: true,
    });
  });

  it("explains capability requests and current Issue grants", () => {
    const current = issue({
      status: "REPAIRING",
      assessment,
      repair: { iteration: 1 },
      capabilityGrants: [{
        capability: "NETWORK_ACCESS",
        requestId: "request-network",
        grantedAt: "2026-08-24T08:00:00.000Z",
      }],
    });
    const prompt = repairPrompt({
      issue: current,
      project,
      assessment,
      evidenceDirectory: "/private/intake/issue-1/1",
    });

    expect(prompt).toContain("CAPABILITY_REQUIRED");
    expect(prompt).toContain("lower-privilege alternative");
    expect(prompt).toContain('"NETWORK_ACCESS"');
    expect(prompt).toContain("Do not request a capability that is already available");
    expect(prompt).toContain("outcome=RESULT");
    expect(prompt).toContain("capabilityRequest=null");
    expect(prompt).toContain("outcome=CAPABILITY_REQUIRED");
    expect(prompt).toContain("result=null");
  });

  it("explains a capability grant continuation", () => {
    const prompt = repairPrompt({
      issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 1 } }),
      project,
      assessment,
      evidenceDirectory: "/private/intake/issue-1/1",
      continuation: {
        reason: "CAPABILITY_GRANTED",
        requestId: "request-1",
        capabilities: ["HOST_EXECUTION"],
      },
    });

    expect(prompt).toContain("Capability request request-1 was granted");
    expect(prompt).toContain("existing workspace");
    expect(prompt).toContain("do not redo completed work");
  });
  it("allows implementation to finish before evidence is available", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-draft", "thread-draft");
    const adapter = new CodexAgentAdapter({
      sessions,
      client: new FixtureClient([JSON.stringify(deliveryOutput("Implemented", []))]),
    });

    await expect(adapter.repair(
      { agent: "codex", sessionId: "logical-draft" },
      {
        issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 1 } }),
        project,
        assessment,
        evidenceDirectory: "/private/intake/issue-1/1",
      },
    )).resolves.toMatchObject({
      kind: "DELIVERY_READY",
      summary: "Implemented",
      evidence: [],
    });
  });

  it("implements an approved Feature assessment", async () => {
    const featureAssessment: Assessment = {
      ...assessment,
      verdict: "FEATURE",
      suggestedTitle: "Add CSV export",
      rootCause: undefined,
      solution: "Add an export action and CSV serializer.",
    };
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-feature", "thread-feature");
    const client = new FixtureClient([JSON.stringify(deliveryOutput(
      "Added CSV export",
      [{ type: "screenshot", label: "Export action", relativePath: "export.png" }],
    ))]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await expect(adapter.repair(
      { agent: "codex", sessionId: "logical-feature" },
      {
        issue: issue({ status: "REPAIRING", assessment: featureAssessment, repair: { iteration: 1 } }),
        project,
        assessment: featureAssessment,
        evidenceDirectory: "/private/intake/issue-1/1",
      },
    )).resolves.toMatchObject({ summary: "Added CSV export" });
    expect(client.prompts[0]).toContain("approved BUG or FEATURE change");
  });

  it("resumes the same native thread and returns path-only visual evidence", async () => {
    const client = new FixtureClient([JSON.stringify(deliveryOutput(
      "Fixed",
      [{ type: "screenshot", label: "Proof", relativePath: "proof.png" }],
    ))]);
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-1", "thread-1");
    const adapter = new CodexAgentAdapter({ client, sessions });
    const repairing = issue({
      projectPath: "/tmp/worktrees/CHK-1",
      status: "REPAIRING",
      assessment,
      repair: { iteration: 2 },
    });

    const result = await adapter.repair(
      { agent: "codex", sessionId: "logical-1" },
      {
        issue: repairing,
        project,
        assessment,
        evidenceDirectory: "/private/intake/issue-1/2",
        feedback: "Show the fixed result",
        continuation: {
          reason: "RUNTIME_INTERRUPTED",
          previousAttemptId: "attempt-before-restart",
        },
      },
    );

    expect(result).toEqual({
      kind: "DELIVERY_READY",
      summary: "Fixed",
      evidence: [{ type: "screenshot", label: "Proof", relativePath: "proof.png" }],
      verification: [{
        command: "pnpm test",
        outcome: "PASSED",
        summary: "Configured tests passed",
      }],
    });
    expect(client.resumes[0]).toMatchObject({
      threadId: "thread-1",
      options: {
        workingDirectory: repairing.projectPath,
        sandboxMode: "workspace-write",
        networkAccessEnabled: true,
      },
    });
    expect(client.prompts[0]).toContain("/private/intake/issue-1/2");
    expect(client.prompts[0]).toContain("You may stage and commit only in this Issue Worktree");
    expect(client.prompts[0]).toContain("Show the fixed result");
    expect(client.prompts[0]).toContain(
      "The previous turn was interrupted by a Runtime restart.",
    );
    expect(client.prompts[0]).toContain("Do not redo completed implementation work.");
    expect(client.prompts[0]).toContain("directly capture a real acceptance run");
    expect(client.prompts[0]).toContain(
      "the running application, an actual API request and response, or an executed benchmark",
    );
    expect(client.prompts[0]).toContain(
      "Never submit generated, reconstructed, mocked, or illustrative visuals.",
    );
  });

  it("rejects an empty evidence label with a stable error code", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-empty-label", "thread-empty-label");
    const adapter = new CodexAgentAdapter({
      sessions,
      client: new FixtureClient([JSON.stringify(deliveryOutput(
        "Fixed",
        [{ type: "screenshot", label: "", relativePath: "proof.png" }],
      ))]),
    });

    await expect(adapter.repair(
      { agent: "codex", sessionId: "logical-empty-label" },
      {
        issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 1 } }),
        project,
        assessment,
        evidenceDirectory: "/private/intake/issue-1/1",
      },
    )).rejects.toThrow("EVIDENCE_LABEL_REQUIRED");
  });

  it.each([
    "/absolute.png",
    "C:\\absolute.png",
    "../proof.png",
    "..\\proof.png",
    "nested/../../proof.png",
    "nested\\..\\..\\proof.png",
    "",
  ])(
    "rejects unsafe evidence path %j",
    async (relativePath) => {
      const sessions = new MemorySessions();
      await bindSession(sessions, "logical-1", "thread-1");
      const adapter = new CodexAgentAdapter({
        sessions,
        client: new FixtureClient([JSON.stringify(deliveryOutput(
          "Fixed",
          [{ type: "screenshot", label: "Proof", relativePath }],
        ))]),
      });

      await expect(adapter.repair(
        { agent: "codex", sessionId: "logical-1" },
        {
          issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 2 } }),
          project,
          assessment,
          evidenceDirectory: "/private/intake/issue-1/2",
        },
      )).rejects.toThrow(/EVIDENCE_PATH_(REQUIRED|ESCAPE)/);
    },
  );
});
