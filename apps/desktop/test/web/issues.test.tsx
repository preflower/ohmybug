// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../src/web/api/client.js";
import type { IssueDto } from "../../src/web/api/types.js";
import { IssueDetail } from "../../src/web/issues/issue-detail.js";

const hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const evidenceId = `sha256-${"a".repeat(64)}`;
const issue: IssueDto = {
  id: "issue-1",
  projectId: "project-1",
  identifier: "CHK-1",
  title: "Checkout returns 500",
  titleSource: "assessment",
  status: "COMPLETED",
  resolution: "FIXED",
  inputs: [{
    id: "input-1",
    integration: "manual",
    inputKey: "manual-1",
    rawData: { content: "Expired session" },
    data: { content: "Expired session", summary: "Checkout returns 500" },
    receivedAt: "2026-08-19T09:00:00.000Z",
  }],
  assessment: {
    revision: 1,
    contentHash: hash,
    verdict: "BUG",
    suggestedTitle: "Checkout returns 500",
    reasoning: "The failure follows cart hydration.",
    rootCause: "Cart hydration returns null.",
    solution: "Return a recoverable result.",
  },
  repair: {
    iteration: 2,
    delivery: {
      summary: "Expired sessions are handled.",
      evidence: [{ type: "screenshot", evidenceId, label: "Checkout success" }],
    },
  },
  revision: 9,
  createdAt: "2026-08-19T09:00:00.000Z",
  updatedAt: "2026-08-19T09:10:00.000Z",
};

afterEach(() => vi.restoreAllMocks());

describe("Issue detail", () => {
  it("shows an implemented Feature with its implementation plan", () => {
    render(<IssueDetail issue={{
      ...issue,
      resolution: "IMPLEMENTED",
      repair: undefined,
      assessment: {
        ...issue.assessment!,
        verdict: "FEATURE",
        rootCause: undefined,
        suggestedTitle: "Add CSV export",
        solution: "Add an export action and CSV serializer.",
      },
    }} onRefresh={async () => undefined} />);

    expect(screen.getByRole("heading", { name: "判断：是 Feature" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "实现方案" })).toBeVisible();
    expect(screen.getByText("已完成")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("特性已验收，Issue 已完成");
  });

  it("shows the Assessment, visual Delivery evidence, and direct FIXED closure", async () => {
    vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:checkout-shot" });
    render(<IssueDetail issue={issue} onRefresh={async () => undefined} />);

    expect(screen.getByRole("heading", { level: 2, name: "Checkout returns 500" })).toBeVisible();
    expect(screen.getByText("评估结果 · Assessment")).toBeVisible();
    expect(screen.getByRole("heading", { name: "判断：是 Bug" })).toBeVisible();
    expect(screen.getByText("已完成")).toBeVisible();
    expect(screen.queryByText(hash.slice(0, 8))).not.toBeInTheDocument();
    expect(screen.getByText("Cart hydration returns null.")).toBeVisible();
    expect(screen.getByText("Return a recoverable result.")).toBeVisible();
    expect(await screen.findByRole("img", { name: "Checkout success" })).toHaveAttribute("src", "blob:checkout-shot");
    expect(screen.getByRole("status")).toHaveTextContent("修复已验收，Issue 已完成");
    await act(async () => fireEvent.error(screen.getByRole("img", { name: "Checkout success" })));
    expect(screen.getByRole("alert")).toHaveTextContent("证据文件不可用");
  });

  it("renders one compact FIXED result instead of duplicate success banners", () => {
    vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:checkout-shot" });
    render(<IssueDetail issue={issue} onRefresh={async () => undefined} />);

    const resolution = screen.getByRole("status");
    expect(resolution).toHaveTextContent("FIXED");
    expect(resolution).toHaveTextContent("修复已验收，Issue 已完成");
    expect(screen.getAllByText(/FIXED/)).toHaveLength(1);
  });

  it("renders the Delivery summary as body copy instead of a section heading", () => {
    vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:checkout-shot" });
    render(<IssueDetail issue={issue} onRefresh={async () => undefined} />);

    expect(screen.queryByRole("heading", { level: 3, name: "Expired sessions are handled." })).not.toBeInTheDocument();
    expect(screen.getByText("Expired sessions are handled.")).toHaveProperty("tagName", "P");
  });

  it("renders repeated content-addressed evidence without duplicate React keys", async () => {
    vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:checkout-shot" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<IssueDetail issue={{
      ...issue,
      repair: {
        iteration: 2,
        delivery: {
          ...issue.repair!.delivery!,
          evidence: [
            issue.repair!.delivery!.evidence[0]!,
            { ...issue.repair!.delivery!.evidence[0]!, label: "Checkout retry" },
          ],
        },
      },
    }} onRefresh={async () => undefined} />);

    expect(await screen.findByRole("img", { name: "Checkout success" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Checkout retry" })).toBeVisible();
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
  });

  it("reads evidence by evidenceId and revokes its Blob URL after unmount", async () => {
    const revoke = vi.fn();
    const evidenceSource = vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:desktop-shot", revoke });
    const view = render(<IssueDetail issue={issue} onRefresh={async () => undefined} />);

    expect(await screen.findByRole("img", { name: "Checkout success" })).toHaveAttribute("src", "blob:desktop-shot");
    expect(evidenceSource).toHaveBeenCalledWith("issue-1", evidenceId);

    view.unmount();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("opens screenshot evidence in a large preview dialog", async () => {
    vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:checkout-shot" });
    render(<IssueDetail issue={issue} onRefresh={async () => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "预览 Checkout success" }));

    const dialog = screen.getByRole("dialog", { name: "Checkout success" });
    expect(within(dialog).getByRole("img", { name: "Checkout success" })).toHaveAttribute("src", "blob:checkout-shot");
    expect(within(dialog).getByRole("button", { name: "关闭预览" })).toBeVisible();
  });

  it("plays recording evidence in a large dialog", async () => {
    vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:checkout-recording" });
    render(<IssueDetail issue={{
      ...issue,
      repair: {
        iteration: 2,
        delivery: {
          summary: "Expired sessions are handled.",
          evidence: [{ type: "recording", evidenceId, label: "Checkout recording" }],
        },
      },
    }} onRefresh={async () => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "播放 Checkout recording" }));

    const dialog = screen.getByRole("dialog", { name: "Checkout recording" });
    const player = within(dialog).getByLabelText("Checkout recording 视频");
    expect(player).toHaveAttribute("controls");
    expect(player).toHaveAttribute("autoplay");
  });

  it("offers an explicit retry for a normal recoverable Agent failure", async () => {
    const onRetry = vi.fn(async () => undefined);
    render(<IssueDetail issue={{ ...issue, status: "REPAIR_FAILED", resolution: undefined, lastFailure: { stage: "REPAIR", code: "TEST_FAILED" } }} onRefresh={async () => undefined} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("测试未通过");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试实现" })); });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "重建 Agent 会话" })).not.toBeInTheDocument();
  });

  it("shows preserved implementation state while evidence is captured", () => {
    render(<IssueDetail
      issue={{ ...issue, status: "EVIDENCE_CAPTURE", resolution: undefined }}
      onCancel={async () => undefined}
      onRefresh={async () => undefined}
    />);

    expect(screen.getByText("实现完成，正在采集证据")).toBeVisible();
    expect(screen.getByRole("button", { name: "取消 Agent 运行" })).toBeEnabled();
  });

  it("retries only evidence after evidence capture fails", async () => {
    const onRetry = vi.fn(async () => undefined);
    render(<IssueDetail
      issue={{
        ...issue,
        status: "EVIDENCE_FAILED",
        resolution: undefined,
        lastFailure: { stage: "EVIDENCE", code: "EVIDENCE_RETRY_LIMIT_REACHED" },
      }}
      onRefresh={async () => undefined}
      onRetry={onRetry}
    />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("error-banner");
    expect(alert).toHaveTextContent("证据采集失败；实现改动和工作目录已保留。");
    expect(alert.querySelector("svg")).not.toBeNull();
    expect(alert).not.toHaveAttribute("data-slot", "alert");
    expect(screen.getByText("证据采集失败")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重新实现" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试证据" }));
    });
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("hides the previous failure banner as soon as retry starts", async () => {
    let finishRetry: (() => void) | undefined;
    const onRetry = vi.fn(() => new Promise<void>((resolve) => {
      finishRetry = resolve;
    }));
    render(<IssueDetail issue={{ ...issue, status: "REPAIR_FAILED", resolution: undefined, lastFailure: { stage: "REPAIR", code: "AGENT_FAILURE" } }} onRefresh={async () => undefined} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Codex 未能完成实现");
    fireEvent.click(screen.getByRole("button", { name: "重试实现" }));

    expect(screen.queryByText("Codex 未能完成实现")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试中…" })).toBeDisabled();

    await act(async () => finishRetry?.());
  });

  it("shows session reconstruction only for the exact unavailable-session failure", async () => {
    const onRetry = vi.fn(async () => undefined);
    const onRebuildSession = vi.fn(async () => undefined);
    render(<IssueDetail issue={{ ...issue, status: "REPAIR_FAILED", resolution: undefined, lastFailure: { stage: "REPAIR", code: "AGENT_SESSION_UNAVAILABLE" } }} onRefresh={async () => undefined} onRetry={onRetry} onRebuildSession={onRebuildSession} />);

    expect(screen.getByText("Agent 会话已被删除或不可用")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重试实现" })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重建 Agent 会话" })); });
    expect(onRebuildSession).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("lets the user cancel an active Agent operation", async () => {
    const onCancel = vi.fn(async () => undefined);
    render(<IssueDetail issue={{ ...issue, status: "REPAIRING", resolution: undefined }} onRefresh={async () => undefined} onCancel={onCancel} />);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "取消 Agent 运行" })); });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps Assessment actions outside the scrolling document and closes through cancel", async () => {
    const onCancel = vi.fn(async () => undefined);
    const onRefresh = vi.fn(async () => undefined);
    render(<IssueDetail
      issue={{ ...issue, status: "ASSESSMENT_REVIEW", repair: undefined, resolution: undefined }}
      onApproveAssessment={async () => undefined}
      onCancel={onCancel}
      onRefresh={onRefresh}
      onRequestReassessment={async () => undefined}
    />);

    const dock = screen.getByTestId("assessment-approval-dock");
    expect(dock.parentElement).toHaveClass("issue-detail");
    expect(dock.previousElementSibling).toHaveClass("issue-detail-document");
    fireEvent.click(screen.getByRole("button", { name: "关闭 Issue" }));
    fireEvent.click(screen.getByRole("button", { name: "确认关闭" }));
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps retry available beside a destructive failure alert", async () => {
    render(<IssueDetail issue={{ ...issue, status: "REPAIR_FAILED", resolution: undefined, lastFailure: { stage: "REPAIR", code: "TEST_FAILED" } }} onRefresh={async () => undefined} onRetry={async () => Promise.reject(new Error("重试服务不可用"))} />);

    const retry = screen.getByRole("button", { name: "重试实现" });
    fireEvent.click(retry);

    const retryError = await screen.findByText("重试服务不可用");
    expect(retryError.closest('[data-slot="alert"]')).toHaveAttribute("data-slot", "alert");
    expect(screen.getByText("测试未通过")).toBeVisible();
    expect(retry).toBeVisible();
  });

  it("keeps cancel available beside a destructive failure alert", async () => {
    render(<IssueDetail issue={{ ...issue, status: "REPAIRING", resolution: undefined }} onRefresh={async () => undefined} onCancel={async () => Promise.reject(new Error("取消服务不可用"))} />);

    const cancel = screen.getByRole("button", { name: "取消 Agent 运行" });
    fireEvent.click(cancel);

    const cancelError = await screen.findByText("取消服务不可用");
    expect(cancelError.closest('[data-slot="alert"]')).toHaveAttribute("data-slot", "alert");
    expect(cancel).toBeVisible();
  });

  it("keeps session reconstruction available beside a destructive failure alert", async () => {
    render(<IssueDetail issue={{ ...issue, status: "REPAIR_FAILED", resolution: undefined, lastFailure: { stage: "REPAIR", code: "AGENT_SESSION_UNAVAILABLE" } }} onRefresh={async () => undefined} onRebuildSession={async () => Promise.reject(new Error("重建服务不可用"))} />);

    const rebuild = screen.getByRole("button", { name: "重建 Agent 会话" });
    fireEvent.click(rebuild);

    const rebuildError = await screen.findByText("重建服务不可用");
    expect(rebuildError.closest('[data-slot="alert"]')).toHaveAttribute("data-slot", "alert");
    expect(rebuild).toBeVisible();
  });

  it("shows retry while an approved branch is waiting to publish", async () => {
    const onApproveDelivery = vi.fn(async () => undefined);
    render(<IssueDetail
      issue={{ ...issue, status: "APPROVED", repair: undefined }}
      onApproveDelivery={onApproveDelivery}
      onRefresh={async () => undefined}
    />);

    expect(within(screen.getByRole("region", { name: "分支发布" }))
      .getByText("发布中 / 待重试")).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试发布" }));
    });
    expect(onApproveDelivery).toHaveBeenCalledOnce();
  });

  it("shows the returned branch separately from the completed Issue", () => {
    render(<IssueDetail
      branch={{ name: "ohmybug/chk-1", commit: "abcdef123456", remote: "origin" }}
      issue={issue}
      onRefresh={async () => undefined}
    />);

    expect(screen.getByText("ohmybug/chk-1")).toBeVisible();
    expect(screen.getByText("abcdef1")).toBeVisible();
    expect(screen.getByText("origin")).toBeVisible();
  });
});
