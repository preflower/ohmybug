// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { IssueDto } from "../../src/web/api/types.js";
import { ReviewPanel } from "../../src/web/issues/review-panel.js";

const timestamp = "2026-08-25T08:00:00.000Z";
const issue: IssueDto = {
  id: "issue-1",
  projectId: "project-1",
  identifier: "CHK-1",
  title: "Checkout cancellation semantics",
  titleSource: "assessment",
  status: "REVIEW_REQUIRED",
  inputs: [{
    id: "input-1",
    integration: "manual",
    inputKey: "manual-1",
    rawData: { content: "Cancellation differs after the base update." },
    data: { content: "Cancellation differs after the base update." },
    receivedAt: timestamp,
  }],
  assessment: {
    revision: 1,
    contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    verdict: "BUG",
    suggestedTitle: "Checkout cancellation semantics",
    reasoning: "The two branches choose different cancellation rules.",
  },
  repair: { iteration: 2 },
  review: {
    id: "review-business-1",
    kind: "business-merge-conflict",
    requestedFrom: "REPAIRING",
    payload: {
      summary: "The base and Issue define mutually exclusive cancellation behavior.",
      baseIntent: "Keep the order pending when the gateway times out.",
      issueIntent: "Cancel the order immediately when the gateway times out.",
      incompatibility: "One order cannot remain pending and be canceled for the same timeout.",
      recommendation: "keep-base",
      rationale: "The latest main branch includes the approved operations policy.",
      conflictPaths: ["src/checkout/cancel.ts"],
      choices: [{
        id: "keep-base",
        label: "保留基线行为",
        description: "Use the latest main-branch cancellation policy.",
      }, {
        id: "keep-issue",
        label: "保留 Issue 行为",
        description: "Apply the feature branch cancellation policy.",
      }],
    },
    choices: [{
      id: "keep-base",
      label: "保留基线行为",
      continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
    }, {
      id: "keep-issue",
      label: "保留 Issue 行为",
      continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
    }],
    requestedAt: timestamp,
  },
  revision: 12,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("unified review panel", () => {
  it("shows the mutually exclusive business intents and submits the exact current request once", async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const onSubmit = vi.fn(() => pending);
    render(<ReviewPanel issue={issue} onSubmit={onSubmit} />);

    expect(screen.getByRole("region", { name: "确认业务冲突处理" })).toBeVisible();
    expect(screen.getByText("Keep the order pending when the gateway times out.")).toBeVisible();
    expect(screen.getByText("Cancel the order immediately when the gateway times out.")).toBeVisible();
    expect(screen.getByText("src/checkout/cancel.ts")).toBeVisible();
    expect(screen.getByText("Use the latest main-branch cancellation policy.")).toBeVisible();

    fireEvent.click(screen.getByRole("radio", { name: /保留 Issue 行为/ }));
    const submit = screen.getByRole("button", { name: "保留 Issue 行为" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      expectedRevision: 12,
      requestId: "review-business-1",
      choiceId: "keep-issue",
    });
    expect(screen.getByRole("button", { name: "提交中…" })).toBeDisabled();

    await act(async () => finish?.());
    expect(screen.getByRole("button", { name: "保留 Issue 行为" })).toBeEnabled();
  });

  it("requires feedback only when the selected continuation declares it", () => {
    const assessmentIssue: IssueDto = {
      ...issue,
      review: {
        id: "review-assessment-1",
        kind: "assessment",
        requestedFrom: "ASSESSING",
        payload: { verdict: "BUG" },
        choices: [{
          id: "implement",
          label: "开始实现",
          continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
        }, {
          id: "reassess",
          label: "要求重新分析",
          feedbackRequired: true,
          continuation: { operation: "ASSESS", resumeStatus: "ASSESSING" },
        }],
        requestedAt: timestamp,
      },
    };
    render(<ReviewPanel issue={assessmentIssue} onSubmit={async () => undefined} />);

    fireEvent.click(screen.getByRole("radio", { name: "要求重新分析" }));
    expect(screen.getByRole("button", { name: "要求重新分析" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("补充说明（必填）"), {
      target: { value: "Compare the gateway retry contract first." },
    });
    expect(screen.getByRole("button", { name: "要求重新分析" })).toBeEnabled();
  });

  it("hides a persisted duplicate choice when Assessment did not suggest a target", () => {
    render(<ReviewPanel issue={{
      ...issue,
      review: {
        id: "review-assessment-legacy",
        kind: "assessment",
        requestedFrom: "ASSESSING",
        payload: { verdict: "BUG" },
        choices: [{
          id: "implement",
          label: "开始实现",
          continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
        }, {
          id: "duplicate",
          label: "确认为重复 Issue",
          continuation: { resumeStatus: "CLOSED", resolution: "DUPLICATE" },
        }],
        requestedAt: timestamp,
      },
    }} onSubmit={async () => undefined} />);

    expect(screen.queryByRole("radio", { name: "确认为重复 Issue" })).not.toBeInTheDocument();
  });

  it("prefills the Agent duplicate candidate and submits only duplicate data", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<ReviewPanel issue={{
      ...issue,
      assessment: { ...issue.assessment!, suspectedDuplicateOf: "CHK-9" },
      review: {
        id: "review-assessment-duplicate",
        kind: "assessment",
        requestedFrom: "ASSESSING",
        payload: { verdict: "BUG" },
        choices: [{
          id: "implement",
          label: "开始实现",
          continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
        }, {
          id: "duplicate",
          label: "确认为重复 Issue",
          continuation: { resumeStatus: "CLOSED", resolution: "DUPLICATE" },
        }],
        requestedAt: timestamp,
      },
    }} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Issue 标题"), {
      target: { value: "Edited implementation title" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "确认为重复 Issue" }));
    expect(screen.getByLabelText("重复 Issue")).toHaveValue("CHK-9");
    fireEvent.click(screen.getByRole("button", { name: "确认为重复 Issue" }));

    await act(async () => undefined);
    expect(onSubmit).toHaveBeenCalledWith({
      expectedRevision: 12,
      requestId: "review-assessment-duplicate",
      choiceId: "duplicate",
      data: { duplicateOf: "CHK-9" },
    });
  });
});
