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
    expect(within(dock).queryByText("等待人工决定")).not.toBeInTheDocument();
    expect(within(dock).queryByText("迭代 2 · 1 项证据")).not.toBeInTheDocument();
    expect(within(dock).queryByText("接受后发布已验证 commit")).not.toBeInTheDocument();
    expect(within(dock).queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(within(dock).queryByLabelText(/补充说明/)).not.toBeInTheDocument();
    expect(within(dock).getAllByRole("button").map((button) =>
      button.getAttribute("aria-label") ?? button.textContent
    )).toEqual(["要求修改", "接受交付"]);
    expect(within(dock).getByRole("button", { name: "要求修改" })).toHaveAttribute(
      "data-variant",
      "secondary",
    );
    expect(within(dock).getByRole("button", { name: "接受交付" })).toHaveAttribute(
      "data-variant",
      "default",
    );

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
    expect(screen.getByLabelText("修改说明（必填）")).toBe(document.activeElement);
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
    expect(screen.queryByText("Keep the order pending when the gateway times out.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择处理方式" }));
    expect(screen.getByText("Keep the order pending when the gateway times out.")).toBeVisible();
    expect(screen.getByText("Cancel the order immediately when the gateway times out.")).toBeVisible();
    expect(screen.getByText("src/checkout/cancel.ts")).toBeVisible();
    expect(screen.getByText("Use the latest main-branch cancellation policy.")).toBeVisible();
    expect(screen.getByRole("region", { name: "确认业务冲突处理" })).toHaveAttribute(
      "data-review-mode",
      "expanded",
    );
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();

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

    fireEvent.click(screen.getByRole("button", { name: "要求重新分析" }));
    expect(screen.getByLabelText("补充说明（必填）")).toBe(document.activeElement);
    const composer = document.querySelector<HTMLElement>(".review-composer");
    expect(composer).not.toBeNull();
    expect(within(composer!).getByRole("button", { name: "要求重新分析" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("补充说明（必填）"), {
      target: { value: "Compare the gateway retry contract first." },
    });
    expect(within(composer!).getByRole("button", { name: "要求重新分析" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "返回审核操作" }));
    fireEvent.click(screen.getByRole("button", { name: "开始实现" }));
    expect(screen.getByLabelText("Issue 标题")).toHaveValue("Checkout cancellation semantics");
    expect(screen.queryByLabelText("补充说明（必填）")).not.toBeInTheDocument();
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

    expect(screen.queryByRole("button", { name: "确认为重复 Issue" })).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "确认为重复 Issue" }));
    expect(screen.getByLabelText("重复 Issue")).toHaveValue("CHK-9");
    fireEvent.click(within(document.querySelector<HTMLElement>(".review-composer")!).getByRole(
      "button",
      { name: "确认为重复 Issue" },
    ));

    await act(async () => undefined);
    expect(onSubmit).toHaveBeenCalledWith({
      expectedRevision: 12,
      requestId: "review-assessment-duplicate",
      choiceId: "duplicate",
      data: { duplicateOf: "CHK-9" },
    });
  });

  it("shows only fields required by the chosen Assessment action", () => {
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

    expect(screen.queryByRole("radiogroup", { name: "选择处理方式" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Issue 标题")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认为重复 Issue" }));
    expect(screen.getByLabelText("重复 Issue")).toHaveValue("CHK-9");
    expect(screen.queryByLabelText("Issue 标题")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回审核操作" }));
    fireEvent.click(screen.getByRole("button", { name: "要求重新分析" }));
    expect(screen.queryByLabelText("Issue 标题")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("重复 Issue")).not.toBeInTheDocument();
  });

  it("preserves the selected composer after a submission error", async () => {
    const onSubmit = vi.fn(async () => { throw new Error("审核提交失败"); });
    render(<ReviewPanel issue={deliveryIssue} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "要求修改" }));
    fireEvent.change(screen.getByLabelText("修改说明（必填）"), {
      target: { value: "Use a darker close-button surface." },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交修改要求" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("审核提交失败");
    expect(screen.getByLabelText("修改说明（必填）")).toHaveValue(
      "Use a darker close-button surface.",
    );
  });

  it("keeps Issue cancellation in the dock overflow", () => {
    render(<ReviewPanel
      issue={deliveryIssue}
      onCancel={async () => undefined}
      onSubmit={async () => undefined}
    />);
    expect(screen.queryByRole("button", { name: "取消 Issue" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多 Issue 操作" }));
    expect(screen.getByRole("button", { name: "取消 Issue" })).toBeInTheDocument();
  });

  it("expands bounded context before choosing an unknown review kind", () => {
    const extensionIssue: IssueDto = {
      ...issue,
      review: {
        ...issue.review!,
        id: "review-extension-1",
        kind: "extension-review",
        payload: { provider: "example", records: [1, 2, 3] },
      },
    };
    render(<ReviewPanel issue={extensionIssue} onSubmit={async () => undefined} />);
    expect(screen.queryByText("provider")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择处理方式" }));
    expect(screen.getByText("provider")).toBeVisible();
    expect(screen.getByText("example")).toBeVisible();
  });
});
