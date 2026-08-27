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
    content = <ActionRow>
      {cancel ? <CancelIssueButton disabled={Boolean(busy)} onCancel={cancel} /> : null}
      <Button disabled={Boolean(busy)} type="button" variant="secondary" onClick={() => void run("pause", onPause, "暂停失败")}>
        <Pause aria-hidden="true" size={13} />{busy === "pause" ? "暂停中…" : "暂停 Agent"}
      </Button>
    </ActionRow>;
  } else if (issue.status === "PAUSED") {
    const pauseReady = issue.pauseContext?.ready === true;
    content = <ActionRow>
      {cancel ? <CancelIssueButton disabled={Boolean(busy)} onCancel={cancel} /> : null}
      {onResume ? <Button disabled={Boolean(busy) || !pauseReady} type="button" onClick={() => void run("resume", onResume, "继续执行失败")}>
        <Play aria-hidden="true" size={13} />{busy === "resume" ? "继续中…" : pauseReady ? "继续执行" : "等待暂停完成"}
      </Button> : null}
    </ActionRow>;
  } else if (issue.status === "FINALIZATION_FAILED" && onApproveDelivery) {
    content = <ActionRow>
      {cancel ? <CancelIssueButton disabled={Boolean(busy)} onCancel={cancel} /> : null}
      <Button disabled={Boolean(busy)} type="button" variant="secondary" onClick={() => void run("finalize", onApproveDelivery, "重新验证失败")}>
        <RotateCcw aria-hidden="true" size={13} />{busy === "finalize" ? "重新验证中…" : "重新验证并修复"}
      </Button>
    </ActionRow>;
  } else if (issue.lastFailure?.code === "AGENT_SESSION_UNAVAILABLE" && onRebuildSession) {
    content = <ActionRow>
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
      content = <ActionRow>
        {cancel ? <CancelIssueButton disabled={Boolean(busy)} onCancel={cancel} /> : null}
        <Button disabled={Boolean(busy)} type="button" variant="secondary" onClick={() => void run("retry", onRetry, "重试失败")}>
          <RotateCcw aria-hidden="true" size={13} />{busy === "retry" ? "重试中…" : retryLabel}
        </Button>
      </ActionRow>;
    } else if (cancel) {
      content = <ActionRow>
        <CancelIssueButton onCancel={cancel} />
      </ActionRow>;
    } else {
      return null;
    }
  }

  return <section aria-label="Issue 操作" className="issue-actions">
    <div className="issue-actions-track">
      {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {content}
    </div>
  </section>;
}

function ActionRow({ children }: { children: ReactNode }) {
  return <div className="issue-action-row">
    <div className="issue-action-buttons">{children}</div>
  </div>;
}
