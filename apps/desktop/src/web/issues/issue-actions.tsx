import { Pause, Play, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { IssueDto, ReviewSubmissionInput } from "../api/types.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { CancelIssueButton } from "./cancel-issue-button.js";
import { CapabilityRequestPanel } from "./capability-request-panel.js";
import { ReviewPanel } from "./review-panel.js";

interface IssueActionsProps {
  issue: IssueDto;
  onRefresh(): Promise<void>;
  onApproveDelivery?: () => Promise<void>;
  onSubmitReview?: (input: ReviewSubmissionInput) => Promise<void>;
  onPause?: () => Promise<void>;
  onResume?: () => Promise<void>;
  onCancel?: () => Promise<void>;
  onRetry?: () => Promise<void>;
  onRebuildSession?: () => Promise<void>;
  onGrantCapabilities?: (expectedRevision: number, requestId: string) => Promise<void>;
}

const pauseable = new Set<IssueDto["status"]>([
  "ASSESSING",
  "REPAIRING",
  "EVIDENCE_CAPTURE",
  "FINALIZATION_RECOVERY",
]);

const terminalOrPublishing = new Set<IssueDto["status"]>([
  "FINALIZING",
  "COMPLETED",
  "CLOSED",
  "CANCELED",
]);

export function IssueActions({
  issue,
  onRefresh,
  onApproveDelivery,
  onSubmitReview,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onRebuildSession,
  onGrantCapabilities,
}: IssueActionsProps) {
  const [busy, setBusy] = useState<"pause" | "resume" | "retry" | "rebuild" | "finalize">();
  const [error, setError] = useState("");

  if (terminalOrPublishing.has(issue.status)) return null;

  const refreshAfter = async (action: () => Promise<void>) => {
    await action();
    await onRefresh();
  };
  const run = async (
    kind: NonNullable<typeof busy>,
    action: () => Promise<void>,
    fallback: string,
  ) => {
    setBusy(kind);
    setError("");
    try {
      await refreshAfter(action);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(undefined);
    }
  };
  const cancel = onCancel ? () => refreshAfter(onCancel) : undefined;

  let content: ReactNode;
  if (issue.status === "REVIEW_REQUIRED" && issue.review && onSubmitReview) {
    content = <ReviewPanel
      issue={issue}
      onCancel={cancel}
      onSubmit={(input) => refreshAfter(() => onSubmitReview(input))}
    />;
  } else if (
    issue.status === "PERMISSION_REQUIRED"
    && issue.pendingCapabilityRequest
    && onGrantCapabilities
    && cancel
  ) {
    const request = issue.pendingCapabilityRequest;
    content = <CapabilityRequestPanel
      request={request}
      onCancel={cancel}
      onGrant={() => refreshAfter(() => onGrantCapabilities(issue.revision, request.id))}
    />;
  } else if (pauseable.has(issue.status)) {
    if (!onPause) return null;
    content = <ActionRow
      description="暂停只会结束当前 Agent 回合；工作目录和阶段上下文会保留，可以稍后继续。"
      title="Agent 正在执行"
    >
      <Button disabled={Boolean(busy)} type="button" variant="secondary" onClick={() => void run("pause", onPause, "暂停失败")}>
        <Pause aria-hidden="true" size={13} />{busy === "pause" ? "暂停中…" : "暂停 Agent"}
      </Button>
    </ActionRow>;
  } else if (issue.status === "PAUSED") {
    content = <ActionRow
      description="继续会回到暂停前的阶段；取消则会让 Issue 进入不可继续的终态。"
      title="Agent 已暂停"
    >
      {cancel ? <CancelIssueButton disabled={Boolean(busy)} onCancel={cancel} /> : null}
      {onResume ? <Button disabled={Boolean(busy)} type="button" onClick={() => void run("resume", onResume, "继续执行失败")}>
        <Play aria-hidden="true" size={13} />{busy === "resume" ? "继续中…" : "继续执行"}
      </Button> : null}
    </ActionRow>;
  } else if (issue.status === "FINALIZATION_FAILED" && onApproveDelivery) {
    content = <section aria-label="交付恢复" className="failure-actions">
      <div>
        <strong>交付失败，待重新验证</strong>
        <span>代码和工作目录已保留；AI 会从 Repair 重新验证、修复后再发布。</span>
        {issue.finalizationRecovery?.automaticAttempts === 1 ? <span>自动恢复尝试 1/1 已用尽</span> : null}
        {issue.finalizationRecovery?.summary ? <span>自动恢复结果：{issue.finalizationRecovery.summary}</span> : null}
        {issue.finalizationRecovery?.diagnostic ? <>
          <code>{issue.finalizationRecovery.diagnostic.step} · {issue.finalizationRecovery.diagnostic.code}</code>
          <span>{issue.finalizationRecovery.diagnostic.message}</span>
        </> : null}
      </div>
      <div className="issue-action-buttons">
        {cancel ? <CancelIssueButton disabled={Boolean(busy)} onCancel={cancel} /> : null}
        <Button disabled={Boolean(busy)} type="button" variant="secondary" onClick={() => void run("finalize", onApproveDelivery, "重新验证失败")}>
          <RotateCcw aria-hidden="true" size={13} />{busy === "finalize" ? "重新验证中…" : "重新验证并修复"}
        </Button>
      </div>
    </section>;
  } else if (issue.lastFailure?.code === "AGENT_SESSION_UNAVAILABLE" && onRebuildSession) {
    content = <ActionRow
      description="重建后会保留 Issue、Assessment、反馈和证据记录，并用新会话继续当前阶段。"
      failure
      title="Agent 会话已被删除或不可用"
    >
      {cancel ? <CancelIssueButton disabled={Boolean(busy)} onCancel={cancel} /> : null}
      <Button disabled={Boolean(busy)} type="button" variant="secondary" onClick={() => void run("rebuild", onRebuildSession, "重建会话失败")}>
        <RotateCcw aria-hidden="true" size={13} />{busy === "rebuild" ? "重建中…" : "重建 Agent 会话"}
      </Button>
    </ActionRow>;
  } else {
    const retryLabel = issue.status === "ASSESSMENT_FAILED"
      ? "重试分析"
      : issue.status === "REPAIR_FAILED"
        ? "重试实现"
        : issue.status === "EVIDENCE_FAILED"
          ? "重试证据"
          : undefined;
    if (retryLabel && onRetry) {
      content = <ActionRow
        description={issue.status === "EVIDENCE_FAILED"
          ? "实现改动和工作目录已保留，只会重新采集证据。"
          : "Issue 上下文和已确认内容会保留，并从可恢复阶段继续。"}
        failure
        title={retryLabel}
      >
        {cancel ? <CancelIssueButton disabled={Boolean(busy)} onCancel={cancel} /> : null}
        <Button disabled={Boolean(busy)} type="button" variant="secondary" onClick={() => void run("retry", onRetry, "重试失败")}>
          <RotateCcw aria-hidden="true" size={13} />{busy === "retry" ? "重试中…" : retryLabel}
        </Button>
      </ActionRow>;
    } else if (cancel) {
      content = <ActionRow description="取消后 Issue 将进入终态，不能继续执行。" title="Issue 生命周期">
        <CancelIssueButton onCancel={cancel} />
      </ActionRow>;
    } else {
      return null;
    }
  }

  return <section aria-label="Issue 操作" className="issue-actions">
    {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    {content}
  </section>;
}

function ActionRow({
  title,
  description,
  failure = false,
  children,
}: {
  title: string;
  description: string;
  failure?: boolean;
  children: ReactNode;
}) {
  return <div className={`failure-actions issue-action-row${failure ? " issue-action-row-failure" : ""}`}>
    <div><strong>{title}</strong><span>{description}</span></div>
    <div className="issue-action-buttons">{children}</div>
  </div>;
}
