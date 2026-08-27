// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../src/web/api/client.js";
import type { AgentEventDto, IssueDto } from "../../src/web/api/types.js";
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
    deliveryDraft: {
      summary: "Expired sessions are handled.",
      repairIteration: 2,
      implementationCompletedAt: "2026-08-19T09:08:00.000Z",
      integration: {
        baseBranch: "main",
        baseCommit: "a".repeat(40),
        issueBranch: "ohmybug/chk-1",
        issueCommit: "abcdef123456",
        conflicts: [],
        verification: [],
      },
    },
    delivery: {
      summary: "Expired sessions are handled.",
      evidence: [{ type: "screenshot", evidenceId, label: "Checkout success" }],
    },
  },
  revision: 9,
  createdAt: "2026-08-19T09:00:00.000Z",
  updatedAt: "2026-08-19T09:10:00.000Z",
};

const permissionRequiredIssue: IssueDto = {
  ...issue,
  status: "PERMISSION_REQUIRED",
  resolution: undefined,
  revision: 10,
  pendingCapabilityRequest: {
    id: "request-1",
    operation: "REPAIR",
    stage: "REPAIR",
    resumeStatus: "REPAIRING",
    capabilities: ["HOST_EXECUTION"],
    reason: "Launch Electron acceptance",
    blockedCommand: "pnpm test:e2e:electron",
    requestedAt: "2026-08-24T08:00:00.000Z",
  },
};

afterEach(() => vi.restoreAllMocks());

describe("Issue detail", () => {
  it("shows Assessment and the transient Terminal without result artifacts while executing", () => {
    const events: AgentEventDto[] = [
      { id: "issue-1:turn", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-19T09:05:00.000Z", data: { message: "Codex 开始实现" } },
      { id: "issue-1:command", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "AGENT_COMMAND_STARTED", occurredAt: "2026-08-19T09:05:01.000Z", data: { message: "正在执行项目命令", detail: "$ pnpm test" } },
    ];
    render(<IssueDetail
      agentActive
      agentEvents={events}
      agentSessionId="session-1"
      issue={{ ...issue, status: "REPAIRING", resolution: undefined }}
      onRefresh={async () => undefined}
      terminalAction={<button type="button">在 Terminal 中打开</button>}
    />);

    expect(screen.getByTestId("assessment-review")).toBeVisible();
    expect(screen.getByRole("region", { name: "Codex Terminal" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "证据" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "交付" })).not.toBeInTheDocument();
    expect(screen.queryByText(/结果：/)).not.toBeInTheDocument();
  });

  it("shows concise Evidence and Delivery artifacts after execution", () => {
    vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:checkout-shot" });
    render(<IssueDetail agentActive={false} agentEvents={[]} issue={issue} onRefresh={async () => undefined} />);

    expect(screen.queryByRole("region", { name: "Codex Terminal" })).not.toBeInTheDocument();
    const evidence = screen.getByRole("region", { name: "证据" });
    expect(within(evidence).getByText("Expired sessions are handled.")).toBeVisible();
    expect(within(evidence).queryByText(/项证据|验证结果|验证通过/)).not.toBeInTheDocument();
    const delivery = screen.getByRole("region", { name: "交付" });
    expect(within(delivery).getByText("Expired sessions are handled.")).toBeVisible();
    expect(within(delivery).getByText("ohmybug/chk-1")).toBeVisible();
    expect(within(delivery).getByText("abcdef1")).toBeVisible();
    expect(screen.queryByText("Delivery · 迭代 2")).not.toBeInTheDocument();
    expect(screen.queryByText("交付分支")).not.toBeInTheDocument();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
  });

  it("shows an inline host permission request with grant and cancel actions", async () => {
    const onGrantCapabilities = vi.fn(async () => undefined);
    const onCancel = vi.fn(async () => undefined);
    render(<IssueDetail
      issue={permissionRequiredIssue}
      onRefresh={async () => undefined}
      onGrantCapabilities={onGrantCapabilities}
      onCancel={onCancel}
    />);

    expect(screen.getAllByText("权限不足").length).toBeGreaterThan(0);
    expect(screen.getByText(/不受工作区沙箱限制的宿主命令执行权限/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "暂不授权" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "授权并继续" })).toBeVisible();
    expect(screen.getByRole("button", { name: "取消 Issue" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消 Agent 运行" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "授权并继续" }));
    expect(await screen.findByRole("dialog", { name: "授权宿主执行权限？" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "确认授权并继续" }));
    await waitFor(() => expect(onGrantCapabilities).toHaveBeenCalledWith(
      permissionRequiredIssue.revision,
      "request-1",
    ));
  });

  it("keeps the request actionable when a stale grant is rejected", async () => {
    render(<IssueDetail
      issue={permissionRequiredIssue}
      onRefresh={async () => undefined}
      onGrantCapabilities={async () => { throw new Error("CONCURRENT_UPDATE"); }}
      onCancel={async () => undefined}
    />);

    fireEvent.click(screen.getByRole("button", { name: "授权并继续" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认授权并继续" }));

    expect(await screen.findByText("CONCURRENT_UPDATE")).toBeVisible();
    expect(screen.getByRole("button", { name: "授权并继续" })).toBeEnabled();
  });

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
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the Assessment and visual Delivery evidence without duplicate closure state", async () => {
    vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:checkout-shot" });
    render(<IssueDetail issue={issue} onRefresh={async () => undefined} />);

    expect(screen.getByRole("heading", { level: 2, name: "Checkout returns 500" })).toBeVisible();
    expect(screen.getByText("评估结果 · Assessment")).toBeVisible();
    expect(screen.getByRole("heading", { name: "判断：是 Bug" })).toBeVisible();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    expect(screen.queryByText(hash.slice(0, 8))).not.toBeInTheDocument();
    expect(screen.getByText("Cart hydration returns null.")).toBeVisible();
    expect(screen.getByText("Return a recoverable result.")).toBeVisible();
    expect(await screen.findByRole("img", { name: "Checkout success" })).toHaveAttribute("src", "blob:checkout-shot");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => fireEvent.error(screen.getByRole("img", { name: "Checkout success" })));
    expect(screen.getByRole("alert")).toHaveTextContent("证据文件不可用");
  });

  it("does not repeat the outer FIXED state inside the detail document", () => {
    vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:checkout-shot" });
    render(<IssueDetail issue={issue} onRefresh={async () => undefined} />);

    expect(screen.queryByText(/FIXED/)).not.toBeInTheDocument();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
  });

  it("renders the Delivery summary as body copy instead of a section heading", () => {
    vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:checkout-shot" });
    render(<IssueDetail issue={issue} onRefresh={async () => undefined} />);

    expect(screen.queryByRole("heading", { level: 3, name: "Expired sessions are handled." })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "证据" })).getByText("Expired sessions are handled.")).toHaveProperty("tagName", "P");
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
    expect(dialog.querySelector(".evidence-preview-header")).not.toBeInTheDocument();
    expect(dialog.querySelector(".evidence-preview-stage > .evidence-preview-toolbar")).toBeInTheDocument();
  });

  it("zooms, pans, and resets screenshot evidence", async () => {
    vi.spyOn(api, "evidenceSource").mockResolvedValue({ url: "blob:checkout-shot" });
    render(<IssueDetail issue={issue} onRefresh={async () => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "预览 Checkout success" }));

    const dialog = screen.getByRole("dialog", { name: "Checkout success" });
    const preview = within(dialog);
    const image = preview.getByRole("img", { name: "Checkout success" });
    const stage = image.closest(".evidence-preview-stage");
    expect(stage).not.toBeNull();
    expect(preview.getByLabelText("当前缩放比例")).toHaveTextContent("100%");

    fireEvent.click(preview.getByRole("button", { name: "放大" }));
    fireEvent.click(preview.getByRole("button", { name: "放大" }));
    expect(preview.getByLabelText("当前缩放比例")).toHaveTextContent("150%");

    fireEvent.pointerDown(stage!, { button: 0, clientX: 120, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(stage!, { clientX: 150, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(stage!, { pointerId: 1 });
    expect(image).toHaveStyle({ transform: "translate3d(30px, 20px, 0) scale(1.5)" });

    fireEvent.click(preview.getByRole("button", { name: "重置视图" }));
    expect(preview.getByLabelText("当前缩放比例")).toHaveTextContent("100%");
    expect(image).toHaveStyle({ transform: "translate3d(0px, 0px, 0) scale(1)" });

    fireEvent.wheel(stage!, { clientX: 200, clientY: 160, deltaY: -100 });
    expect(preview.getByLabelText("当前缩放比例")).toHaveTextContent("125%");
    expect(image).not.toHaveStyle({ transform: "translate3d(0px, 0px, 0) scale(1.25)" });
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
    expect(screen.queryByText("Issue 上下文和已确认内容会保留，并从可恢复阶段继续。")).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试实现" })); });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "重建 Agent 会话" })).not.toBeInTheDocument();
  });

  it("shows preserved implementation state while evidence is captured", () => {
    render(<IssueDetail
      issue={{ ...issue, status: "EVIDENCE_CAPTURE", resolution: undefined }}
      onPause={async () => undefined}
      onRefresh={async () => undefined}
    />);

    expect(screen.queryByText("实现完成，正在采集证据")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂停 Agent" })).toBeEnabled();
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
    expect(screen.queryByRole("button", { name: "重新实现" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试证据" }));
    });
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps failure context visible while retry starts", async () => {
    let finishRetry: (() => void) | undefined;
    const onRetry = vi.fn(() => new Promise<void>((resolve) => {
      finishRetry = resolve;
    }));
    render(<IssueDetail issue={{ ...issue, status: "REPAIR_FAILED", resolution: undefined, lastFailure: { stage: "REPAIR", code: "AGENT_FAILURE" } }} onRefresh={async () => undefined} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Codex 未能完成实现");
    fireEvent.click(screen.getByRole("button", { name: "重试实现" }));

    expect(screen.getByText("Codex 未能完成实现")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试中…" })).toBeDisabled();

    await act(async () => finishRetry?.());
  });

  it("shows session reconstruction only for the exact unavailable-session failure", async () => {
    const onRetry = vi.fn(async () => undefined);
    const onRebuildSession = vi.fn(async () => undefined);
    render(<IssueDetail issue={{ ...issue, status: "REPAIR_FAILED", resolution: undefined, lastFailure: { stage: "REPAIR", code: "AGENT_SESSION_UNAVAILABLE" } }} onRefresh={async () => undefined} onRetry={onRetry} onRebuildSession={onRebuildSession} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Codex 会话不可用");
    expect(screen.queryByText("重建后会保留 Issue、Assessment、反馈和证据记录，并用新会话继续当前阶段。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试实现" })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重建 Agent 会话" })); });
    expect(onRebuildSession).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("keeps pause and cancel together without duplicating workflow copy", async () => {
    const onPause = vi.fn(async () => undefined);
    const onCancel = vi.fn(async () => undefined);
    render(<IssueDetail issue={{ ...issue, status: "REPAIRING", resolution: undefined }} onRefresh={async () => undefined} onPause={onPause} onCancel={onCancel} />);

    const actions = screen.getByRole("region", { name: "Issue 操作" });
    expect(within(actions).getByRole("button", { name: "取消 Issue" })).toBeVisible();
    expect(within(actions).queryByText("Issue 正在执行")).not.toBeInTheDocument();
    expect(within(actions).queryByText("暂停会停止当前执行；工作目录和阶段上下文会保留，可以稍后继续。")).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "暂停 Agent" })); });
    expect(onPause).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("continues or cancels a paused Issue from one action area", () => {
    render(<IssueDetail issue={{
      ...issue,
      status: "PAUSED",
      resolution: undefined,
      pauseContext: {
        operation: "REPAIR",
        resumeStatus: "REPAIRING",
        pausedAt: issue.updatedAt,
        ready: true,
      },
    }} onRefresh={async () => undefined} onResume={async () => undefined} onCancel={async () => undefined} />);

    const actions = screen.getByRole("region", { name: "Issue 操作" });
    expect(within(actions).getByRole("button", { name: "继续执行" })).toBeVisible();
    expect(within(actions).getByRole("button", { name: "取消 Issue" })).toBeVisible();
    expect(within(actions).queryByText("Agent 已暂停")).not.toBeInTheDocument();
  });

  it("keeps resume disabled until paused work has safely settled", () => {
    render(<IssueDetail issue={{
      ...issue,
      status: "PAUSED",
      resolution: undefined,
      pauseContext: {
        operation: "REPAIR",
        resumeStatus: "REPAIRING",
        pausedAt: issue.updatedAt,
        ready: false,
      },
    }} onRefresh={async () => undefined} onResume={async () => undefined} onCancel={async () => undefined} />);

    expect(screen.getByRole("button", { name: "等待暂停完成" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消 Issue" })).toBeEnabled();
  });

  it("renders the unified Assessment review and cancels through the generic control", async () => {
    const onCancel = vi.fn(async () => undefined);
    const onRefresh = vi.fn(async () => undefined);
    render(<IssueDetail
      issue={{
        ...issue,
        status: "REVIEW_REQUIRED",
        repair: undefined,
        resolution: undefined,
        review: {
          id: "review-assessment-1",
          kind: "assessment",
          requestedFrom: "ASSESSING",
          payload: { verdict: "BUG" },
          choices: [{
            id: "implement",
            label: "开始实现",
            continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
          }],
          requestedAt: "2026-08-25T08:00:00.000Z",
        },
      }}
      onCancel={onCancel}
      onRefresh={onRefresh}
      onSubmitReview={async () => undefined}
    />);

    expect(screen.getByRole("region", { name: "确认 Assessment" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "更多 Issue 操作" }));
    fireEvent.click(screen.getByRole("button", { name: "取消 Issue" }));
    expect(screen.getByRole("dialog", { name: "确认取消 Issue？" })).toBeVisible();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认取消" }));
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps terminal cancellation actionable when the request fails", async () => {
    const onCancel = vi.fn(async () => { throw new Error("取消服务不可用"); });
    render(<IssueDetail
      issue={{ ...issue, status: "ASSESSMENT_FAILED", resolution: undefined }}
      onCancel={onCancel}
      onRefresh={async () => undefined}
      onRetry={async () => undefined}
    />);

    const actions = screen.getByRole("region", { name: "Issue 操作" });
    expect(within(actions).getByRole("button", { name: "重试分析" })).toBeVisible();
    fireEvent.click(within(actions).getByRole("button", { name: "取消 Issue" }));
    fireEvent.click(screen.getByRole("button", { name: "确认取消" }));

    expect(await screen.findByText("取消服务不可用")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认取消" })).toBeEnabled();
  });

  it.each(["FINALIZING", "COMPLETED", "CLOSED", "CANCELED"] as const)(
    "does not render Issue actions while %s",
    (status) => {
      render(<IssueDetail
        issue={{ ...issue, status }}
        onCancel={async () => undefined}
        onRefresh={async () => undefined}
      />);
      expect(screen.queryByRole("region", { name: "Issue 操作" })).not.toBeInTheDocument();
    },
  );

  it("keeps retry available beside a destructive failure alert", async () => {
    render(<IssueDetail issue={{ ...issue, status: "REPAIR_FAILED", resolution: undefined, lastFailure: { stage: "REPAIR", code: "TEST_FAILED" } }} onRefresh={async () => undefined} onRetry={async () => Promise.reject(new Error("重试服务不可用"))} />);

    const retry = screen.getByRole("button", { name: "重试实现" });
    fireEvent.click(retry);

    const retryError = await screen.findByText("重试服务不可用");
    expect(retryError.closest('[data-slot="alert"]')).toHaveAttribute("data-slot", "alert");
    expect(screen.getByText("测试未通过")).toBeVisible();
    expect(retry).toBeVisible();
  });

  it("keeps session reconstruction available beside a destructive failure alert", async () => {
    render(<IssueDetail issue={{ ...issue, status: "REPAIR_FAILED", resolution: undefined, lastFailure: { stage: "REPAIR", code: "AGENT_SESSION_UNAVAILABLE" } }} onRefresh={async () => undefined} onRebuildSession={async () => Promise.reject(new Error("重建服务不可用"))} />);

    const rebuild = screen.getByRole("button", { name: "重建 Agent 会话" });
    fireEvent.click(rebuild);

    const rebuildError = await screen.findByText("重建服务不可用");
    expect(rebuildError.closest('[data-slot="alert"]')).toHaveAttribute("data-slot", "alert");
    expect(rebuild).toBeVisible();
  });

  it("shows active finalization without a retry action", () => {
    render(<IssueDetail
      issue={{ ...issue, status: "FINALIZING", repair: undefined }}
      onApproveDelivery={async () => undefined}
      onRefresh={async () => undefined}
    />);

    expect(screen.queryByText("交付处理中")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试交付" })).not.toBeInTheDocument();
    expect(screen.queryByText(/发布/)).not.toBeInTheDocument();
  });

  it("keeps finalization diagnostics without adding a second workflow state source", () => {
    render(<IssueDetail
      issue={{
        ...issue,
        status: "FINALIZATION_RECOVERY",
        resolution: "FIXED",
        finalizationRecovery: {
          automaticAttempts: 1,
          attemptId: "attempt-1",
          fingerprintRef: "fingerprint-1",
          diagnostic: {
            providerId: "git",
            step: "add",
            code: "GIT_ADD_FAILED",
            message: "生成的临时目录阻塞了 Git 暂存",
            relatedPaths: [".pnpm-store/shared/v11/tmp/_tmp_fixture"],
          },
        },
      }}
      onApproveDelivery={async () => undefined}
      onPause={async () => undefined}
      onCancel={async () => undefined}
      onRefresh={async () => undefined}
    />);

    const recovery = screen.getByRole("region", { name: "交付恢复诊断" });
    expect(screen.queryByRole("status", { name: "自动交付恢复" })).not.toBeInTheDocument();
    expect(within(recovery).queryByText("第 1/1 次自动恢复")).not.toBeInTheDocument();
    expect(within(recovery).queryByText(/AI 正在/)).not.toBeInTheDocument();
    expect(within(recovery).getByText("生成的临时目录阻塞了 Git 暂存")).toBeVisible();
    expect(within(recovery).getByText(".pnpm-store/shared/v11/tmp/_tmp_fixture")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重试交付" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂停 Agent" })).toBeVisible();
  });

  it("shows merge-aware recovery copy and conflict context", () => {
    render(<IssueDetail
      issue={{
        ...issue,
        status: "FINALIZATION_RECOVERY",
        resolution: "FIXED",
        finalizationRecovery: {
          automaticAttempts: 1,
          attemptId: "attempt-merge",
          fingerprintRef: "fingerprint-merge",
          diagnostic: {
            providerId: "git",
            step: "merge",
            code: "GIT_AUTO_MERGE_CONFLICT",
            message: "自动合并发现内容冲突",
            relatedPaths: ["apps/desktop/src/web/issues/issue-detail.tsx"],
          },
          context: {
            recoveryKind: "MERGE_CONFLICT",
            merge: {
              kind: "MERGE_CONFLICT",
              baseBranch: "main",
              baseCommit: "a".repeat(40),
              issueBranch: "ohmybug/ohmybug-21",
              issueCommit: "b".repeat(40),
              conflictPaths: ["apps/desktop/src/web/issues/issue-detail.tsx"],
              mergeMessages: ["content conflict"],
              mergePrepared: true,
            },
          },
        },
      }}
      onCancel={async () => undefined}
      onRefresh={async () => undefined}
    />);

    const recovery = screen.getByRole("region", { name: "交付恢复诊断" });
    expect(within(recovery).queryByText("AI 正在解析合并问题")).not.toBeInTheDocument();
    expect(within(recovery).getByText("基线分支：main")).toBeVisible();
    expect(within(recovery).getByText("apps/desktop/src/web/issues/issue-detail.tsx"))
      .toBeVisible();
    expect(screen.queryByRole("button", { name: "重试交付" })).not.toBeInTheDocument();
  });

  it("uses merge recovery copy for older persisted Issues without context", () => {
    render(<IssueDetail
      issue={{
        ...issue,
        status: "FINALIZATION_RECOVERY",
        resolution: "FIXED",
        finalizationRecovery: {
          automaticAttempts: 1,
          attemptId: "attempt-legacy-merge",
          fingerprintRef: "fingerprint-legacy-merge",
          diagnostic: {
            providerId: "git",
            step: "merge",
            code: "GIT_AUTO_MERGE_CONFLICT",
            message: "旧版本保存的合并冲突",
            relatedPaths: ["src/conflict.ts"],
          },
        },
      }}
      onCancel={async () => undefined}
      onRefresh={async () => undefined}
    />);

    const recovery = screen.getByRole("region", { name: "交付恢复诊断" });
    expect(within(recovery).queryByText("AI 正在解析合并问题")).not.toBeInTheDocument();
    expect(within(recovery).getByText("旧版本保存的合并冲突")).toBeVisible();
    expect(within(recovery).getByText("src/conflict.ts")).toBeVisible();
  });

  it("retries only a failed finalization", async () => {
    const onApproveDelivery = vi.fn(async () => undefined);
    render(<IssueDetail
      issue={{
        ...issue,
        status: "FINALIZATION_FAILED",
        repair: undefined,
        finalizationRecovery: {
          automaticAttempts: 1,
          attemptId: "attempt-1",
          fingerprintRef: "fingerprint-1",
          summary: "未找到可安全自动修复的路径",
          diagnostic: {
            providerId: "git",
            step: "commit",
            code: "GIT_COMMAND_FAILED:commit",
            message: "提交钩子拒绝了交付",
            relatedPaths: [],
          },
        },
      }}
      onApproveDelivery={onApproveDelivery}
      onRefresh={async () => undefined}
    />);

    const recovery = within(screen.getByRole("region", { name: "Issue 操作" }));
    expect(recovery.queryByText("交付失败，待重新验证")).not.toBeInTheDocument();
    expect(recovery.queryByText("代码和工作目录已保留；AI 会从 Repair 重新验证、修复后再发布。")).not.toBeInTheDocument();
    expect(recovery.queryByText("自动恢复尝试 1/1 已用尽")).not.toBeInTheDocument();
    expect(recovery.queryByText("自动恢复结果：未找到可安全自动修复的路径")).not.toBeInTheDocument();
    expect(recovery.queryByText("commit · GIT_COMMAND_FAILED:commit")).not.toBeInTheDocument();
    expect(recovery.queryByText("提交钩子拒绝了交付")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(recovery.getByRole("button", { name: "重新验证并修复" }));
    });
    expect(onApproveDelivery).toHaveBeenCalledOnce();
  });

  it("shows the delivery retry fallback error", async () => {
    render(<IssueDetail
      issue={{ ...issue, status: "FINALIZATION_FAILED", repair: undefined }}
      onApproveDelivery={async () => Promise.reject("unavailable")}
      onRefresh={async () => undefined}
    />);

    fireEvent.click(screen.getByRole("button", { name: "重新验证并修复" }));

    expect(await screen.findByText("重新验证失败")).toBeVisible();
  });

  it("uses the returned branch inside the Delivery artifact", () => {
    render(<IssueDetail
      branch={{ name: "ohmybug/chk-1", commit: "abcdef123456", remote: "origin" }}
      issue={{
        ...issue,
        repair: { iteration: 2, delivery: issue.repair!.delivery },
      }}
      onRefresh={async () => undefined}
    />);

    const delivery = screen.getByRole("region", { name: "交付" });
    expect(within(delivery).getByText("ohmybug/chk-1")).toBeVisible();
    expect(within(delivery).getByText("abcdef1")).toBeVisible();
    expect(within(delivery).queryByText("origin")).not.toBeInTheDocument();
  });
});
