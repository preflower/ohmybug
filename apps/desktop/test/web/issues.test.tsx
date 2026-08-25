// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("uses a clear cancellation icon for an active Agent operation", () => {
    render(<IssueDetail issue={{ ...issue, status: "REPAIRING", resolution: undefined }} onRefresh={async () => undefined} onCancel={async () => undefined} />);

    const cancel = screen.getByRole("button", { name: "取消 Agent 运行" });
    expect(cancel.querySelector(".lucide-x")).not.toBeNull();
    expect(cancel.querySelector(".lucide-square")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "取消 Issue" }));
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

  it("shows active finalization without a retry action", () => {
    render(<IssueDetail
      issue={{ ...issue, status: "FINALIZING", repair: undefined }}
      onApproveDelivery={async () => undefined}
      onRefresh={async () => undefined}
    />);

    expect(screen.getByText("交付处理中")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重试交付" })).not.toBeInTheDocument();
    expect(screen.queryByText(/发布/)).not.toBeInTheDocument();
  });

  it("shows bounded AI finalization recovery state without duplicate delivery actions", () => {
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
      onCancel={async () => undefined}
      onRefresh={async () => undefined}
    />);

    expect(screen.getByText("AI 正在恢复交付")).toBeVisible();
    const recovery = screen.getByRole("status", { name: "自动交付恢复" });
    expect(within(recovery).getByText("第 1/1 次自动恢复")).toBeVisible();
    expect(within(recovery).getByText("生成的临时目录阻塞了 Git 暂存")).toBeVisible();
    expect(within(recovery).getByText(".pnpm-store/shared/v11/tmp/_tmp_fixture")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重试交付" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消 Agent 运行" })).toBeVisible();
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

    expect(screen.getByText("AI 正在修复合并")).toBeVisible();
    const recovery = screen.getByRole("status", { name: "自动交付恢复" });
    expect(within(recovery).getByText("AI 正在解析合并问题")).toBeVisible();
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

    expect(screen.getByText("AI 正在修复合并")).toBeVisible();
    expect(screen.getByText("AI 正在解析合并问题")).toBeVisible();
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

    const recovery = within(screen.getByRole("region", { name: "交付恢复" }));
    expect(recovery.getByText("交付失败，待重新验证")).toBeVisible();
    expect(recovery.getByText("代码和工作目录已保留；AI 会从 Repair 重新验证、修复后再发布。")).toBeVisible();
    expect(recovery.getByText("自动恢复尝试 1/1 已用尽")).toBeVisible();
    expect(recovery.getByText("自动恢复结果：未找到可安全自动修复的路径")).toBeVisible();
    expect(recovery.getByText("commit · GIT_COMMAND_FAILED:commit")).toBeVisible();
    expect(recovery.getByText("提交钩子拒绝了交付")).toBeVisible();
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
