import { describe, expect, it } from "vitest";

import {
  approveAssessment,
  confirmAssessmentResolution,
  transitionIssue,
  type Assessment,
  type Issue,
  type IssueStatus,
} from "../../src/index.js";

const assessment = {
  revision: 4,
  contentHash: "a".repeat(64),
  verdict: "BUG",
  suggestedTitle: "支付页无法打开",
  reasoning: "路由注册缺失",
  rootCause: "支付页路由被删除",
  solution: "恢复支付页路由",
} satisfies Assessment;

function issueAt(status: IssueStatus): Issue {
  return {
    id: "issue-1",
    projectId: "project-1",
    identifier: "OMB-1",
    title: "支付页打不开",
    titleSource: "integration",
    status,
    inputs: [],
    revision: 1,
    createdAt: "2026-08-20T07:00:00.000Z",
    updatedAt: "2026-08-20T07:00:00.000Z",
  };
}

describe("Issue workflow", () => {
  const capabilityGrants = [{
    capability: "HOST_EXECUTION" as const,
    requestId: "request-1",
    grantedAt: "2026-08-24T08:00:00.000Z",
  }];

  it("persists Delivery approval before final completion", () => {
    const approved = transitionIssue(
      { ...issueAt("ACCEPTANCE_REVIEW"), assessment },
      "APPROVE_DELIVERY",
      "2026-08-20T07:09:00.000Z",
    );

    expect(approved).toMatchObject({ status: "APPROVED", resolution: "FIXED" });
    expect(transitionIssue(
      approved,
      "COMPLETE_DELIVERY",
      "2026-08-20T07:10:00.000Z",
    )).toMatchObject({ status: "COMPLETED", resolution: "FIXED" });
  });

  it("completes a confirmed Bug after approved Delivery is finalized", () => {
    let current = transitionIssue(
      issueAt("RECEIVED"),
      "START_ASSESSMENT",
      "2026-08-20T07:10:00.000Z",
    );
    current = transitionIssue(
      current,
      "ASSESSMENT_READY",
      "2026-08-20T07:10:00.000Z",
    );
    current = approveAssessment(
      { ...current, assessment },
      {
        assessmentRevision: 4,
        assessmentContentHash: "a".repeat(64),
        title: "支付页无法打开",
      },
      "2026-08-20T07:10:00.000Z",
    );

    const remainingActions = [
      "IMPLEMENTATION_READY",
      "DELIVERY_READY",
      "EVIDENCE_ACCEPTED",
      "APPROVE_DELIVERY",
      "COMPLETE_DELIVERY",
    ] as const;

    const result = remainingActions.reduce(
      (issue, action) =>
        transitionIssue(issue, action, "2026-08-20T07:10:00.000Z"),
      current,
    );

    expect(result).toMatchObject({
      status: "COMPLETED",
      resolution: "FIXED",
      title: "支付页无法打开",
      titleSource: "assessment",
      repair: { iteration: 1 },
      revision: 9,
    });
  });

  it("implements a confirmed Feature and completes it as IMPLEMENTED", () => {
    const featureAssessment = {
      ...assessment,
      contentHash: "f".repeat(64),
      verdict: "FEATURE",
      suggestedTitle: "支持导出验收报告",
      reasoning: "这是现有产品没有的新能力。",
      rootCause: undefined,
      solution: "增加报告导出入口和生成流程。",
    } satisfies Assessment;
    const approved = approveAssessment(
      { ...issueAt("ASSESSMENT_REVIEW"), assessment: featureAssessment },
      {
        assessmentRevision: featureAssessment.revision,
        assessmentContentHash: featureAssessment.contentHash,
        title: featureAssessment.suggestedTitle,
      },
      "2026-08-20T07:12:00.000Z",
    );

    const implemented = ([
      "IMPLEMENTATION_READY",
      "DELIVERY_READY",
      "EVIDENCE_ACCEPTED",
      "APPROVE_DELIVERY",
      "COMPLETE_DELIVERY",
    ] as const)
      .reduce((issue, action) => transitionIssue(issue, action, "2026-08-20T07:13:00.000Z"), approved);

    expect(implemented).toMatchObject({
      status: "COMPLETED",
      resolution: "IMPLEMENTED",
      repair: { iteration: 1 },
    });
  });

  it("rejects approval of a stale Assessment revision or content hash", () => {
    const reviewed = {
      ...issueAt("ASSESSMENT_REVIEW"),
      assessment,
    };

    expect(() =>
      approveAssessment(
        reviewed,
        {
          assessmentRevision: 3,
          assessmentContentHash: assessment.contentHash,
          title: assessment.suggestedTitle,
        },
        "2026-08-20T07:15:00.000Z",
      ),
    ).toThrow(/Stale Assessment approval/);
    expect(() =>
      approveAssessment(
        reviewed,
        {
          assessmentRevision: assessment.revision,
          assessmentContentHash: "b".repeat(64),
          title: assessment.suggestedTitle,
        },
        "2026-08-20T07:15:00.000Z",
      ),
    ).toThrow(/Stale Assessment approval/);
  });

  it("grants implementation authority only for a Bug or Feature Assessment", () => {
    expect(() =>
      approveAssessment(
        {
          ...issueAt("ASSESSMENT_REVIEW"),
          assessment: {
            ...assessment,
            contentHash: "c".repeat(64),
            verdict: "NOT_A_BUG",
          },
        },
        {
          assessmentRevision: assessment.revision,
          assessmentContentHash: "c".repeat(64),
          title: assessment.suggestedTitle,
        },
        "2026-08-20T07:15:00.000Z",
      ),
    ).toThrow(/Only a BUG or FEATURE Assessment/);
  });

  it("closes NOT_A_BUG only through a current human confirmation", () => {
    const notABugAssessment = {
      ...assessment,
      contentHash: "c".repeat(64),
      verdict: "NOT_A_BUG",
    } satisfies Assessment;

    expect(
      confirmAssessmentResolution(
        {
          ...issueAt("ASSESSMENT_REVIEW"),
          assessment: notABugAssessment,
        },
        {
          assessmentRevision: notABugAssessment.revision,
          assessmentContentHash: notABugAssessment.contentHash,
          resolution: "NOT_A_BUG",
        },
        "2026-08-20T07:20:00.000Z",
      ),
    ).toMatchObject({ status: "CLOSED", resolution: "NOT_A_BUG" });
  });

  it("records the human-confirmed duplicate target when closing", () => {
    const duplicateAssessment = {
      ...assessment,
      contentHash: "d".repeat(64),
      verdict: "UNCERTAIN",
      suspectedDuplicateOf: "issue-2",
    } satisfies Assessment;

    expect(
      confirmAssessmentResolution(
        {
          ...issueAt("ASSESSMENT_REVIEW"),
          assessment: duplicateAssessment,
        },
        {
          assessmentRevision: duplicateAssessment.revision,
          assessmentContentHash: duplicateAssessment.contentHash,
          resolution: "DUPLICATE",
          duplicateOf: "issue-2",
        },
        "2026-08-20T07:20:00.000Z",
      ),
    ).toMatchObject({
      status: "CLOSED",
      resolution: "DUPLICATE",
      duplicateOf: "issue-2",
    });
  });

  it("does not allow Agent assessment to close an Issue directly", () => {
    expect(
      transitionIssue(
        issueAt("ASSESSING"),
        "ASSESSMENT_READY",
        "2026-08-20T07:20:00.000Z",
      ).status,
    ).toBe("ASSESSMENT_REVIEW");
  });

  it.each([
    ["ASSESSMENT_REVIEW", "REQUEST_REASSESSMENT", "ASSESSING"],
    ["ASSESSMENT_FAILED", "RETRY_ASSESSMENT", "ASSESSING"],
    ["EVIDENCE_CHECK", "EVIDENCE_REJECTED", "EVIDENCE_CAPTURE"],
    ["EVIDENCE_FAILED", "RETRY_EVIDENCE", "EVIDENCE_CAPTURE"],
    ["REPAIR_FAILED", "RETRY_REPAIR", "REPAIRING"],
    ["ACCEPTANCE_REVIEW", "REJECT_DELIVERY", "REPAIRING"],
  ] as const)("%s + %s -> %s", (from, action, to) => {
    expect(
      transitionIssue(
        issueAt(from),
        action,
        "2026-08-20T07:30:00.000Z",
      ).status,
    ).toBe(to);
  });

  it.each([
    ["RECEIVED", "START_ASSESSMENT"],
    ["ASSESSMENT_REVIEW", "REQUEST_REASSESSMENT"],
    ["ASSESSMENT_FAILED", "RETRY_ASSESSMENT"],
  ] as const)("clears the old Assessment when %s receives %s", (from, action) => {
    const result = transitionIssue(
      { ...issueAt(from), assessment },
      action,
      "2026-08-20T07:32:00.000Z",
    );

    expect(result.assessment).toBeUndefined();
  });

  it.each([
    ["ASSESSMENT_FAILED", "RETRY_ASSESSMENT", "ASSESSMENT"],
    ["REPAIR_FAILED", "RETRY_REPAIR", "REPAIR"],
  ] as const)("clears the previous failure when %s receives %s", (from, action, stage) => {
    const result = transitionIssue(
      { ...issueAt(from), lastFailure: { stage, code: "AGENT_FAILURE" } },
      action,
      "2026-08-20T07:33:00.000Z",
    );

    expect(result.lastFailure).toBeUndefined();
  });

  it("increments only implementation retries, not evidence retries", () => {
    const rejectedEvidence = transitionIssue(
      {
        ...issueAt("EVIDENCE_CHECK"),
        repair: { iteration: 2 },
      },
      "EVIDENCE_REJECTED",
      "2026-08-20T07:35:00.000Z",
    );
    const rejectedDelivery = transitionIssue(
      {
        ...issueAt("ACCEPTANCE_REVIEW"),
        repair: { iteration: 5 },
      },
      "REJECT_DELIVERY",
      "2026-08-20T07:35:00.000Z",
    );

    expect(rejectedEvidence.repair).toEqual({ iteration: 2 });
    expect(rejectedDelivery.repair).toEqual({ iteration: 6 });
  });

  it("records failure states", () => {
    expect(
      transitionIssue(
        issueAt("ASSESSING"),
        "ASSESSMENT_ERRORED",
        "2026-08-20T07:40:00.000Z",
      ).status,
    ).toBe("ASSESSMENT_FAILED");
    expect(
      transitionIssue(
        issueAt("REPAIRING"),
        "REPAIR_ERRORED",
        "2026-08-20T07:40:00.000Z",
      ).status,
    ).toBe("REPAIR_FAILED");
  });

  it("allows cancellation only before a terminal state", () => {
    expect(
      transitionIssue(
        issueAt("REPAIRING"),
        "CANCEL",
        "2026-08-20T07:50:00.000Z",
      ),
    ).toMatchObject({ status: "CANCELED", resolution: "CANCELED" });
    expect(() =>
      transitionIssue(
        issueAt("CLOSED"),
        "CANCEL",
        "2026-08-20T07:50:00.000Z",
      ),
    ).toThrow(/Illegal Issue transition/);
    expect(() =>
      transitionIssue(
        issueAt("COMPLETED"),
        "CANCEL",
        "2026-08-20T07:50:00.000Z",
      ),
    ).toThrow(/Illegal Issue transition/);
  });

  it("cancels a permission-blocked Issue and revokes capability state", () => {
    const canceled = transitionIssue({
      ...issueAt("PERMISSION_REQUIRED"),
      capabilityGrants,
      pendingCapabilityRequest: {
        id: "request-2",
        operation: "REPAIR",
        stage: "REPAIR",
        resumeStatus: "REPAIRING",
        capabilities: ["NETWORK_ACCESS"],
        reason: "Download test fixture",
        requestedAt: "2026-08-24T08:01:00.000Z",
      },
    }, "CANCEL", "2026-08-24T08:02:00.000Z");

    expect(canceled).toMatchObject({ status: "CANCELED", resolution: "CANCELED" });
    expect(canceled.capabilityGrants).toBeUndefined();
    expect(canceled.pendingCapabilityRequest).toBeUndefined();
  });

  it("revokes grants when an approved delivery completes", () => {
    const completed = transitionIssue({
      ...issueAt("APPROVED"),
      capabilityGrants,
    }, "COMPLETE_DELIVERY", "2026-08-24T08:02:00.000Z");

    expect(completed.status).toBe("COMPLETED");
    expect(completed.capabilityGrants).toBeUndefined();
  });

  it("revokes grants when a non-bug assessment closes the Issue", () => {
    const notABugAssessment = {
      ...assessment,
      contentHash: "c".repeat(64),
      verdict: "NOT_A_BUG" as const,
    };
    const closed = confirmAssessmentResolution({
      ...issueAt("ASSESSMENT_REVIEW"),
      assessment: notABugAssessment,
      capabilityGrants,
    }, {
      assessmentRevision: notABugAssessment.revision,
      assessmentContentHash: notABugAssessment.contentHash,
      resolution: "NOT_A_BUG",
    }, "2026-08-24T08:02:00.000Z");

    expect(closed.status).toBe("CLOSED");
    expect(closed.capabilityGrants).toBeUndefined();
  });

  it("rejects actions that do not belong to the current state", () => {
    expect(() =>
      transitionIssue(
        issueAt("RECEIVED"),
        "APPROVE_DELIVERY",
        "2026-08-20T08:00:00.000Z",
      ),
    ).toThrow(/Illegal Issue transition/);
  });

  it.each(["", " ", "issue-1"])(
    "rejects invalid duplicate target %j",
    (duplicateOf) => {
      expect(() =>
        confirmAssessmentResolution(
          {
            ...issueAt("ASSESSMENT_REVIEW"),
            assessment: {
              ...assessment,
              contentHash: "e".repeat(64),
              verdict: "UNCERTAIN",
            },
          },
          {
            assessmentRevision: assessment.revision,
            assessmentContentHash: "e".repeat(64),
            resolution: "DUPLICATE",
            duplicateOf,
          },
          "2026-08-20T08:05:00.000Z",
        ),
      ).toThrow(/Invalid duplicate Issue target/);
    },
  );
});
