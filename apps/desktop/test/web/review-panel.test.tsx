// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

const deliveryIssue: IssueDto = {
  ...issue,
  repair: {
    iteration: 2,
    delivery: {
      summary: "Cancellation semantics now match the approved policy.",
      evidence: [{
        type: "screenshot",
        evidenceId: `sha256-${"a".repeat(64)}`,
        label: "Cancellation acceptance",
      }],
    },
  },
  review: {
    id: "review-delivery-1",
    kind: "delivery",
    requestedFrom: "EVIDENCE_CHECK",
    payload: { repairIteration: 2, evidenceCount: 1 },
    choices: [{
      id: "accept",
      label: "接受交付",
      continuation: { operation: "FINALIZE", resumeStatus: "FINALIZING", resolution: "FIXED" },
    }, {
      id: "request-changes",
      label: "要求修改",
      feedbackRequired: true,
      continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
    }],
    requestedAt: timestamp,
  },
};

describe("unified review panel", () => {
  it("renders Delivery review as a collapsed action dock and accepts directly", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<ReviewPanel issue={deliveryIssue} onSubmit={onSubmit} />);

    const dock = screen.getByRole("region", { name: "验收 Delivery" });
    expect(dock).toHaveAttribute("data-review-mode", "collapsed");
    expect(within(dock).getByText("迭代 2 · 1 项证据")).toBeVisible();
    expect(within(dock).getByText("接受后发布已验证 commit")).toBeVisible();
    expect(within(dock).queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(within(dock).queryByLabelText(/补充说明/)).not.toBeInTheDocument();

    fireEvent.click(within(dock).getByRole("button", { name: "接受交付" }));
    await act(async () => undefined);
    expect(onSubmit).toHaveBeenCalledWith({
      expectedRevision: 12,
      requestId: "review-delivery-1",
      choiceId: "accept",
    });
  });

  it("expands feedback only for request changes and can return to the dock", () => {
    render(<ReviewPanel issue={deliveryIssue} onSubmit={async () => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "要求修改" }));
    expect(screen.getByRole("region", { name: "验收 Delivery" })).toHaveAttribute(
      "data-review-mode",
      "composing",
    );
    expect(screen.getByLabelText("修改说明（必填）")).toBeFocused();
    expect(screen.getByRole("button", { name: "提交修改要求" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("修改说明（必填）"), {
      target: { value: "Keep the close control visible on light images." },
    });
    expect(screen.getByRole("button", { name: "提交修改要求" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "返回审核操作" }));
    expect(screen.queryByLabelText("修改说明（必填）")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "验收 Delivery" })).toHaveAttribute(
      "data-review-mode",
      "collapsed",
    );
  });

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

  it("keeps choice-dependent assessment fields after the processing choices", () => {
    const assessmentIssue: IssueDto = {
      ...issue,
      assessment: { ...issue.assessment!, suspectedDuplicateOf: "CHK-9" },
      review: {
        id: "review-assessment-layout-1",
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

    const processingChoices = screen.getByRole("radiogroup", { name: "选择处理方式" });
    const expectAfterChoices = (field: HTMLElement) => {
      expect(
        processingChoices.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    };

    expectAfterChoices(screen.getByLabelText("Issue 标题"));

    fireEvent.click(screen.getByRole("radio", { name: "确认为重复 Issue" }));
    expect(screen.queryByLabelText("Issue 标题")).not.toBeInTheDocument();
    expectAfterChoices(screen.getByLabelText("重复 Issue"));

    fireEvent.click(screen.getByRole("radio", { name: "要求重新分析" }));
    expect(screen.queryByLabelText("Issue 标题")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("重复 Issue")).not.toBeInTheDocument();
  });
});
