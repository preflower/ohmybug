import { describe, expect, it } from "vitest";

import {
  issueSchema,
  issueStatusSchema,
  type FinalizationRecoveryContextSummary,
  type Issue,
} from "../../src/index.js";

const issue: Issue = {
  id: "issue-1",
  projectId: "project-1",
  projectPath: "/tmp/worktrees/OMB-1",
  identifier: "OMB-1",
  title: "支付页无法打开",
  titleSource: "assessment",
  status: "EVIDENCE_FAILED",
  inputs: [{
    id: "input-1",
    integration: "manual",
    inputKey: "command-1",
    rawData: { content: "支付页打不开" },
    data: { content: "支付页打不开" },
    receivedAt: "2026-08-20T11:00:00.000Z",
  }],
  agentSession: { agent: "fake", sessionId: "session-1" },
  repair: {
    iteration: 2,
    evidenceRetries: 2,
    deliveryDraft: {
      summary: "支付页已恢复",
      repairIteration: 2,
      implementationCompletedAt: "2026-08-20T11:08:00.000Z",
    },
    feedback: "Show the full response",
    delivery: {
      summary: "支付页已恢复",
      evidence: [{
        type: "screenshot",
        label: "支付页",
        evidenceId: `sha256-${"a".repeat(64)}`,
      }],
    },
  },
  lastFailure: { stage: "EVIDENCE", code: "EVIDENCE_RETRY_LIMIT_REACHED" },
  revision: 7,
  createdAt: "2026-08-20T11:00:00.000Z",
  updatedAt: "2026-08-20T11:10:00.000Z",
};

describe("Issue persistence schema", () => {
  it.each(["ASSESSMENT_REVIEW", "ACCEPTANCE_REVIEW"] as const)(
    "rejects legacy %s as a current Issue write",
    (status) => {
      expect(() => issueStatusSchema.parse(status)).toThrow();
      expect(() => issueSchema.parse({ ...issue, status })).toThrow();
    },
  );

  it("round-trips one bounded generic review request", () => {
    const review = {
      id: "review-19",
      kind: "business-merge-conflict",
      requestedFrom: "REPAIRING",
      payload: {
        baseIntent: "Keep legacy rounding",
        issueIntent: "Use per-line rounding",
        paths: ["packages/billing/src/total.ts"],
      },
      choices: [{
        id: "use-issue-behavior",
        label: "采用 Issue 行为",
        continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
      }],
      requestedAt: "2026-08-25T00:00:00.000Z",
    };

    expect(issueStatusSchema.parse("REVIEW_REQUIRED")).toBe("REVIEW_REQUIRED");
    expect(issueSchema.parse({
      ...issue,
      status: "REVIEW_REQUIRED",
      review,
    })).toMatchObject({ status: "REVIEW_REQUIRED", review });
  });

  it("rejects unbounded generic review content", () => {
    const baseReview = {
      id: "review-19",
      kind: "business-merge-conflict",
      requestedFrom: "REPAIRING",
      payload: { summary: "Choose one behavior" },
      choices: [{
        id: "use-issue-behavior",
        label: "Use Issue behavior",
        continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
      }],
      requestedAt: "2026-08-25T00:00:00.000Z",
    };

    expect(() => issueSchema.parse({
      ...issue,
      status: "REVIEW_REQUIRED",
      review: { ...baseReview, payload: { summary: "x".repeat(33_000) } },
    })).toThrow();
    expect(() => issueSchema.parse({
      ...issue,
      status: "REVIEW_REQUIRED",
      review: {
        ...baseReview,
        choices: [baseReview.choices[0], baseReview.choices[0]],
      },
    })).toThrow("REVIEW_CHOICE_DUPLICATE");
  });

  it("round-trips the complete durable Issue aggregate", () => {
    expect(issueSchema.parse(issue)).toEqual(issue);
  });

  it("rejects unknown top-level persistence fields", () => {
    expect(() => issueSchema.parse({ ...issue, unexpectedField: true })).toThrow();
  });

  it.each(["FINALIZING", "FINALIZATION_FAILED"] as const)(
    "round-trips the %s status",
    (status) => {
      expect(issueSchema.parse({ ...issue, status }).status).toBe(status);
    },
  );

  it("round-trips bounded finalization recovery state and permission resume", () => {
    const recovering = {
      ...issue,
      status: "PERMISSION_REQUIRED" as const,
      finalizationRecovery: {
        automaticAttempts: 1 as const,
        attemptId: "recovery-1",
        fingerprintRef: "fingerprint-1",
        summary: "Removed generated package-manager cache",
        diagnostic: {
          providerId: "git",
          step: "add" as const,
          code: "GIT_COMMAND_FAILED:add",
          exitCode: 128,
          message: "Git could not add a generated directory",
          stderr: "fatal: adding files failed",
          relatedPaths: [".pnpm-store/shared/v11/tmp/_tmp_fixture"],
        },
      },
      pendingCapabilityRequest: {
        id: "request-recovery",
        operation: "RECOVER_FINALIZATION" as const,
        stage: "FINALIZATION_RECOVERY" as const,
        resumeStatus: "FINALIZATION_RECOVERY" as const,
        capabilities: ["HOST_EXECUTION" as const],
        reason: "Inspect generated files outside the sandbox",
        requestedAt: "2026-08-24T08:01:00.000Z",
      },
    };

    expect(issueSchema.parse(recovering)).toEqual(recovering);
    expect(() => issueSchema.parse({
      ...recovering,
      finalizationRecovery: {
        ...recovering.finalizationRecovery,
        diagnostic: {
          ...recovering.finalizationRecovery.diagnostic,
          relatedPaths: ["/Users/example/secret"],
        },
      },
    })).toThrow();
  });

  it("round-trips bounded merge recovery context", () => {
    const context = {
      recoveryKind: "MERGE_CONFLICT",
      merge: {
        kind: "MERGE_CONFLICT",
        baseBranch: "main",
        baseCommit: "a".repeat(40),
        issueBranch: "ohmybug/ohmybug-21",
        issueCommit: "b".repeat(40),
        conflictPaths: ["apps/desktop/src/web/issues/issue-detail.tsx"],
        mergeMessages: ["CONFLICT (content): Merge conflict in issue-detail.tsx"],
        mergePrepared: true,
      },
    } satisfies FinalizationRecoveryContextSummary;
    const recovering = {
      ...issue,
      status: "FINALIZATION_RECOVERY" as const,
      finalizationRecovery: {
        automaticAttempts: 1 as const,
        context,
      },
    };

    expect(issueSchema.parse(recovering).finalizationRecovery?.context).toEqual(context);
    expect(issueSchema.parse({
      ...recovering,
      finalizationRecovery: { automaticAttempts: 1 },
    }).finalizationRecovery?.context).toBeUndefined();
  });

  it("accepts a prepared advanced-base merge with no new conflict paths", () => {
    expect(issueSchema.parse({
      ...issue,
      status: "FINALIZATION_RECOVERY",
      finalizationRecovery: {
        automaticAttempts: 1,
        context: {
          recoveryKind: "MERGE_CONFLICT",
          merge: {
            kind: "MERGE_CONFLICT",
            baseBranch: "main",
            baseCommit: "a".repeat(40),
            issueBranch: "ohmybug/ohmybug-21",
            issueCommit: "b".repeat(40),
            conflictPaths: [],
            mergeMessages: ["advanced base merged cleanly"],
            mergePrepared: true,
          },
        },
      },
    }).finalizationRecovery?.context?.merge?.conflictPaths).toEqual([]);
  });

  it.each([
    { conflictPaths: ["/private/source.ts"] },
    { conflictPaths: ["../source.ts"] },
    { conflictPaths: Array.from({ length: 51 }, (_, index) => `src/${index}.ts`) },
    { mergeMessages: Array.from({ length: 21 }, (_, index) => `message ${index}`) },
    { mergeMessages: ["x".repeat(1_001)] },
  ])("rejects unsafe or unbounded merge recovery context", (override) => {
    expect(() => issueSchema.parse({
      ...issue,
      status: "FINALIZATION_RECOVERY",
      finalizationRecovery: {
        automaticAttempts: 1,
        context: {
          recoveryKind: "MERGE_CONFLICT",
          merge: {
            kind: "MERGE_CONFLICT",
            baseBranch: "main",
            baseCommit: "a".repeat(40),
            issueBranch: "ohmybug/ohmybug-21",
            issueCommit: "b".repeat(40),
            conflictPaths: ["src/feature.ts"],
            mergeMessages: ["content conflict"],
            mergePrepared: true,
            ...override,
          },
        },
      },
    })).toThrow();
  });

  it("accepts inspection-only merge environment context", () => {
    expect(issueSchema.parse({
      ...issue,
      status: "FINALIZATION_RECOVERY",
      finalizationRecovery: {
        automaticAttempts: 1,
        context: {
          recoveryKind: "MERGE_ENVIRONMENT",
          merge: {
            kind: "MERGE_ENVIRONMENT",
            baseBranch: "main",
            issueBranch: "ohmybug/ohmybug-21",
            issueCommit: "b".repeat(40),
            conflictPaths: [],
            mergeMessages: ["local base branch is unavailable"],
            mergePrepared: false,
          },
        },
      },
    }).finalizationRecovery?.context?.recoveryKind).toBe("MERGE_ENVIRONMENT");
  });

  it("rejects the legacy APPROVED status", () => {
    expect(issueStatusSchema.safeParse("APPROVED").success).toBe(false);
  });

  it("stores only the concrete Issue project path", () => {
    expect(issueSchema.parse(issue).projectPath).toBe("/tmp/worktrees/OMB-1");
  });

  it("round-trips an Issue paused for a capability request", () => {
    const paused = {
      ...issue,
      status: "PERMISSION_REQUIRED" as const,
      capabilityGrants: [{
        capability: "NETWORK_ACCESS" as const,
        requestId: "request-old",
        grantedAt: "2026-08-24T08:00:00.000Z",
      }],
      pendingCapabilityRequest: {
        id: "request-1",
        operation: "REPAIR" as const,
        stage: "REPAIR" as const,
        resumeStatus: "REPAIRING" as const,
        capabilities: ["HOST_EXECUTION" as const],
        reason: "Launch Electron acceptance",
        requestedAt: "2026-08-24T08:01:00.000Z",
      },
    };

    expect(issueSchema.parse(paused)).toEqual(paused);
  });

  it("rejects duplicate capability state", () => {
    expect(() => issueSchema.parse({
      ...issue,
      capabilityGrants: [
        { capability: "NETWORK_ACCESS", requestId: "request-1", grantedAt: issue.updatedAt },
        { capability: "NETWORK_ACCESS", requestId: "request-2", grantedAt: issue.updatedAt },
      ],
    })).toThrow("CAPABILITY_GRANT_DUPLICATE");
  });
});
