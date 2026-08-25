import { CircleAlert, Image as ImageIcon, Maximize2, Minus, Play, Plus, RotateCcw, Search, Wrench, X } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent, useEffect, useRef, useState } from "react";

import { api } from "../api/client.js";
import type {
  BranchInfoDto,
  IssueDto,
  ReviewSubmissionInput,
} from "../api/types.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog.js";
import { CapabilityRequestPanel } from "./capability-request-panel.js";
import { IssueStatusBadge } from "./issue-status.js";
import { ReviewPanel } from "./review-panel.js";

interface IssueDetailProps {
  issue: IssueDto;
  branch?: BranchInfoDto;
  onRefresh: () => Promise<void>;
  onApproveDelivery?: () => Promise<void>;
  onSubmitReview?: (input: ReviewSubmissionInput) => Promise<void>;
  onCancel?: () => Promise<void>;
  onRetry?: () => Promise<void>;
  onRebuildSession?: () => Promise<void>;
  onGrantCapabilities?: (expectedRevision: number, requestId: string) => Promise<void>;
}

type VisualEvidence = NonNullable<NonNullable<IssueDto["repair"]>["delivery"]>["evidence"][number];
type Point = { x: number; y: number };

const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.25;

const verdictLabels: Record<NonNullable<IssueDto["assessment"]>["verdict"], string> = {
  BUG: "是 Bug",
  FEATURE: "是 Feature",
  NOT_A_BUG: "不是 Bug",
  UNCERTAIN: "暂无法判断",
};

function failureMessage(failure: NonNullable<IssueDto["lastFailure"]>): string {
  const stage = failure.stage === "ASSESSMENT"
    ? "分析"
    : failure.stage === "EVIDENCE"
      ? "证据采集"
      : failure.stage === "FINALIZATION_RECOVERY"
        ? "交付恢复"
        : "实现";
  switch (failure.code) {
    case "AGENT_FAILURE": return `Codex 未能完成${stage}`;
    case "AGENT_SESSION_UNAVAILABLE": return "Codex 会话不可用";
    case "AGENT_PLUGIN_NOT_INSTALLED": return "Codex 未安装或不可用";
    case "AGENT_TIMEOUT": return `Codex ${stage}超时`;
    case "RUNTIME_INTERRUPTED": return `${stage}意外中断`;
    case "TEST_FAILED": return "测试未通过";
    case "EVIDENCE_INTAKE_FAILED": return "验证证据读取失败";
    case "EVIDENCE_INSPECTION_FAILED": return "验证证据检查失败";
    default: return `${stage}失败`;
  }
}

export function IssueDetail({
  issue,
  branch,
  onRefresh,
  onApproveDelivery,
  onSubmitReview,
  onCancel,
  onRetry,
  onRebuildSession,
  onGrantCapabilities,
}: IssueDetailProps) {
  const assessment = issue.assessment;
  const delivery = issue.repair?.delivery;
  const latestInput = issue.inputs.at(-1);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildError, setRebuildError] = useState("");
  const [finalizationRetrying, setFinalizationRetrying] = useState(false);
  const [finalizationRetryError, setFinalizationRetryError] = useState("");
  const capabilityRequest = issue.status === "PERMISSION_REQUIRED"
    ? issue.pendingCapabilityRequest
    : undefined;
  const canCancel = [
    "ASSESSING",
    "REPAIRING",
    "EVIDENCE_CAPTURE",
    "EVIDENCE_CHECK",
    "PERMISSION_REQUIRED",
    "FINALIZATION_RECOVERY",
  ].includes(issue.status);
  const sessionUnavailable = issue.lastFailure?.code === "AGENT_SESSION_UNAVAILABLE";
  const mergeRecovery = issue.finalizationRecovery?.context?.recoveryKind === "MERGE_CONFLICT"
    || issue.finalizationRecovery?.context?.recoveryKind === "MERGE_ENVIRONMENT"
    || issue.finalizationRecovery?.diagnostic?.step === "merge";
  const retryLabel = sessionUnavailable
    ? undefined
    : issue.status === "ASSESSMENT_FAILED"
    ? "重试分析"
    : issue.status === "REPAIR_FAILED"
      ? "重试实现"
      : issue.status === "EVIDENCE_FAILED"
        ? "重试证据"
      : undefined;
  const refreshAfter = async (action: () => Promise<void>) => {
    await action();
    await onRefresh();
  };

  return (
    <article className="issue-detail">
      <div className="issue-detail-document">
        <div className="issue-detail-content">
      <header className="issue-title-block">
        <div className="issue-title-meta">
          <span className="eyebrow">{issue.identifier}</span>
          <div className="issue-title-actions">
            <IssueStatusBadge
              status={issue.status}
              recoveryKind={issue.finalizationRecovery?.context?.recoveryKind}
              recoveryStep={issue.finalizationRecovery?.diagnostic?.step}
              reviewKind={issue.review?.kind}
            />
          </div>
        </div>
        <h2>{issue.title}</h2>
        {latestInput?.data.content ? <p>{latestInput.data.content}</p> : null}
        {issue.inputs.length > 1 ? <span className="occurrence-summary">已收到 {issue.inputs.length} 次输入 · 最近 {new Date(latestInput!.receivedAt).toLocaleString("zh-CN")}</span> : null}
        {issue.resolution ? <p className="resolution-summary" role="status">结果：{issue.resolution}{issue.duplicateOf ? ` · ${issue.duplicateOf}` : ""}{issue.status === "COMPLETED" && issue.resolution === "FIXED" ? " · 修复已验收，Issue 已完成。" : issue.status === "COMPLETED" && issue.resolution === "IMPLEMENTED" ? " · 特性已验收，Issue 已完成。" : ""}</p> : null}
        {issue.status === "EVIDENCE_FAILED" && !retrying ? <div className="error-banner" role="alert"><CircleAlert aria-hidden="true" size={15} />证据采集失败；实现改动和工作目录已保留。</div> : issue.lastFailure && !retrying ? <div className="error-banner" role="alert"><CircleAlert aria-hidden="true" size={15} />{failureMessage(issue.lastFailure)}</div> : null}
      </header>

      {capabilityRequest && onGrantCapabilities && onCancel ? <CapabilityRequestPanel
        request={capabilityRequest}
        onGrant={() => refreshAfter(() => onGrantCapabilities(issue.revision, capabilityRequest.id))}
        onCancel={() => refreshAfter(onCancel)}
      /> : null}

      {issue.status === "FINALIZATION_RECOVERY" && issue.finalizationRecovery ? (
        <section
          aria-label="自动交付恢复"
          aria-live="polite"
          className="finalization-recovery-status"
          role="status"
        >
          <div className="finalization-recovery-heading">
            <Wrench aria-hidden="true" size={15} />
            <div>
              <strong>{issue.finalizationRecovery.context?.recoveryKind === "MERGE_CONFLICT"
                ? "AI 正在解析合并问题"
                : issue.finalizationRecovery.context?.recoveryKind === "MERGE_ENVIRONMENT"
                  ? "AI 正在诊断合并环境"
                  : mergeRecovery
                    ? "AI 正在解析合并问题"
                    : "AI 正在修复交付阻塞"}</strong>
              <span>第 {issue.finalizationRecovery.automaticAttempts}/1 次自动恢复</span>
            </div>
          </div>
          {issue.finalizationRecovery.context?.merge ? (
            <div className="finalization-recovery-diagnostic">
              <p>基线分支：{issue.finalizationRecovery.context.merge.baseBranch}</p>
              {issue.finalizationRecovery.context.merge.conflictPaths.map((path) => (
                <code key={path}>{path}</code>
              ))}
            </div>
          ) : null}
          {issue.finalizationRecovery.diagnostic ? (
            <div className="finalization-recovery-diagnostic">
              <p>{issue.finalizationRecovery.diagnostic.message}</p>
              {!issue.finalizationRecovery.context?.merge
                ? issue.finalizationRecovery.diagnostic.relatedPaths.map((path) => (
                <code key={path}>{path}</code>
                ))
                : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {canCancel && !capabilityRequest && onCancel ? <section aria-label="运行控制" className="failure-actions"><div><strong>Agent 正在运行</strong><span>取消会终止当前回合，并将 Issue 标记为已取消。</span></div>{cancelError ? <Alert className="form-error" variant="destructive"><AlertDescription>{cancelError}</AlertDescription></Alert> : null}<Button disabled={canceling} type="button" variant="secondary" onClick={() => { setCanceling(true); setCancelError(""); void refreshAfter(onCancel).catch((caught) => setCancelError(caught instanceof Error ? caught.message : "取消失败")).finally(() => setCanceling(false)); }}><X aria-hidden="true" size={12} />{canceling ? "取消中…" : "取消 Agent 运行"}</Button></section> : null}

      {retryLabel && onRetry ? <section aria-label="失败恢复" className="failure-actions"><div><strong>{retryLabel}</strong><span>{issue.status === "EVIDENCE_FAILED" ? "实现改动和工作目录已保留，只会重新采集证据。" : "Issue 上下文和已确认内容会保留，并从可恢复阶段继续。"}</span></div>{retryError ? <Alert className="form-error" variant="destructive"><AlertDescription>{retryError}</AlertDescription></Alert> : null}<Button disabled={retrying} type="button" variant="secondary" onClick={() => { setRetrying(true); setRetryError(""); void refreshAfter(onRetry).catch((caught) => setRetryError(caught instanceof Error ? caught.message : "重试失败")).finally(() => setRetrying(false)); }}><RotateCcw size={13} />{retrying ? "重试中…" : retryLabel}</Button></section> : null}

      {sessionUnavailable && onRebuildSession ? <section aria-label="会话恢复" className="failure-actions"><div><strong>Agent 会话已被删除或不可用</strong><span>重建后会保留 Issue、Assessment、反馈和证据记录，并用新会话继续当前阶段。</span></div>{rebuildError ? <Alert className="form-error" variant="destructive"><AlertDescription>{rebuildError}</AlertDescription></Alert> : null}<Button disabled={rebuilding} type="button" variant="secondary" onClick={() => { setRebuilding(true); setRebuildError(""); void refreshAfter(onRebuildSession).catch((caught) => setRebuildError(caught instanceof Error ? caught.message : "重建会话失败")).finally(() => setRebuilding(false)); }}><RotateCcw size={13} />{rebuilding ? "重建中…" : "重建 Agent 会话"}</Button></section> : null}

      {issue.status === "FINALIZATION_FAILED" && onApproveDelivery ? (
        <section aria-label="交付恢复" className="failure-actions">
          <div>
            <strong>交付失败，待重新验证</strong>
            <span>代码和工作目录已保留；AI 会从 Repair 重新验证、修复后再发布。</span>
            {issue.finalizationRecovery?.automaticAttempts === 1 ? (
              <span>自动恢复尝试 1/1 已用尽</span>
            ) : null}
            {issue.finalizationRecovery?.summary ? (
              <span>自动恢复结果：{issue.finalizationRecovery.summary}</span>
            ) : null}
            {issue.finalizationRecovery?.diagnostic ? (
              <>
                <code>
                  {issue.finalizationRecovery.diagnostic.step} · {issue.finalizationRecovery.diagnostic.code}
                </code>
                <span>{issue.finalizationRecovery.diagnostic.message}</span>
              </>
            ) : null}
          </div>
          {finalizationRetryError ? (
            <Alert className="form-error" variant="destructive">
              <AlertDescription>{finalizationRetryError}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            disabled={finalizationRetrying}
            type="button"
            variant="secondary"
            onClick={() => {
              setFinalizationRetrying(true);
              setFinalizationRetryError("");
              void refreshAfter(onApproveDelivery)
                .catch((caught) => setFinalizationRetryError(
                  caught instanceof Error ? caught.message : "重新验证失败",
                ))
                .finally(() => setFinalizationRetrying(false));
            }}
          >
            <RotateCcw size={13} />
            {finalizationRetrying ? "重新验证中…" : "重新验证并修复"}
          </Button>
        </section>
      ) : null}

      {branch ? <section aria-label="交付分支" className="review-section"><div className="review-heading"><span>交付分支</span></div><dl><div><dt>分支</dt><dd><code>{branch.name}</code></dd></div><div><dt>Commit</dt><dd><code>{branch.commit.slice(0, 7)}</code></dd></div>{branch.remote ? <div><dt>Remote</dt><dd><code>{branch.remote}</code></dd></div> : null}</dl></section> : null}

      {assessment ? (
        <section className="review-section assessment-review" data-testid="assessment-review">
          <div className="review-heading"><span>评估结果 · Assessment</span></div>
          <div className="assessment-block assessment-verdict"><CircleAlert aria-hidden="true" size={17} /><div><h3>判断：{verdictLabels[assessment.verdict]}</h3><p>{assessment.reasoning}</p></div></div>
          {assessment.rootCause ? <div className="assessment-block"><Search aria-hidden="true" size={17} /><div><h3>Bug 原因</h3><p>{assessment.rootCause}</p></div></div> : null}
          {assessment.solution ? <div className="assessment-block"><Wrench aria-hidden="true" size={17} /><div><h3>{assessment.verdict === "FEATURE" ? "实现方案" : "解决方案"}</h3><p>{assessment.solution}</p></div></div> : null}
          {assessment.suspectedDuplicateOf ? <div><h4>疑似重复</h4><p>{assessment.suspectedDuplicateOf}</p></div> : null}
        </section>
      ) : null}

      {delivery ? (
        <section className="review-section">
          <div className="review-heading"><div><span className="eyebrow">Delivery · 迭代 {issue.repair?.iteration ?? 1}</span><p className="delivery-summary">{delivery.summary}</p></div></div>
          <div className="evidence-gallery">{delivery.evidence.map((evidence, index) => <EvidenceFigure evidence={evidence} issueId={issue.id} key={`${issue.id}-${evidence.evidenceId}-${index}`} />)}</div>
        </section>
      ) : null}

      {issue.status === "REVIEW_REQUIRED" && issue.review && onSubmitReview ? (
        <ReviewPanel
          issue={issue}
          onCancel={onCancel ? () => refreshAfter(onCancel) : undefined}
          onSubmit={(input) => refreshAfter(() => onSubmitReview(input))}
        />
      ) : null}
        </div>
      </div>
    </article>
  );
}

function EvidenceFigure({ evidence, issueId }: { evidence: VisualEvidence; issueId: string }) {
  const [missing, setMissing] = useState(false);
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    let active = true;
    let revoke: (() => void) | undefined;
    void api.evidenceSource(issueId, evidence.evidenceId)
      .then((source) => {
        if (!active) {
          source.revoke?.();
          return;
        }
        revoke = source.revoke;
        setUrl(source.url);
      })
      .catch(() => {
        if (active) setMissing(true);
      });
    return () => {
      active = false;
      revoke?.();
    };
  }, [evidence.evidenceId, issueId]);

  if (missing) {
    return <figure className="evidence-error"><div role="alert"><CircleAlert size={16} />证据文件不可用</div><figcaption>{evidence.label}</figcaption></figure>;
  }
  if (!url) {
    return <figure className="evidence-loading"><div>正在读取证据…</div><figcaption>{evidence.label}</figcaption></figure>;
  }
  if (evidence.type === "screenshot" || evidence.type === "recording") {
    const recording = evidence.type === "recording";
    const actionLabel = `${recording ? "播放" : "预览"} ${evidence.label}`;
    return <Dialog>
      <figure>
        <DialogTrigger render={
          <Button aria-label={actionLabel} className={`evidence-preview-trigger${recording ? " evidence-preview-trigger-recording" : ""}`} type="button" variant="ghost">
            {recording
              ? <video aria-hidden="true" muted onError={() => setMissing(true)} preload="metadata" src={url} />
              : <img alt={evidence.label} onError={() => setMissing(true)} src={url} />}
            <span aria-hidden="true" className="evidence-preview-affordance">
              {recording ? <Play fill="currentColor" size={18} /> : <Maximize2 size={17} />}
              {recording ? "播放" : "预览"}
            </span>
          </Button>
        } />
        <figcaption>{evidence.label}</figcaption>
      </figure>
      <DialogContent aria-describedby={undefined} className="evidence-preview-dialog">
        <DialogTitle className="sr-only">{evidence.label}</DialogTitle>
        <DialogClose render={<Button aria-label="关闭预览" className="evidence-preview-close" size="icon-sm" title="关闭预览" type="button" variant="ghost" />}><X /></DialogClose>
        {recording
          ? <div className="evidence-preview-stage evidence-preview-video-stage"><video aria-label={`${evidence.label} 视频`} autoPlay controls onError={() => setMissing(true)} playsInline src={url} /></div>
          : <ImagePreview alt={evidence.label} onError={() => setMissing(true)} src={url} />}
      </DialogContent>
    </Dialog>;
  }
  return <figure>
    <a href={url}><ImageIcon size={15} />{evidence.label}</a>
    <figcaption>{evidence.label}</figcaption>
  </figure>;
}

function ImagePreview({ alt, onError, src }: { alt: string; onError: () => void; src: string }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ offset: Point; pointer: Point; pointerId: number } | undefined>(undefined);

  const changeZoom = (requestedZoom: number, anchor?: Point) => {
    const nextZoom = Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, requestedZoom));
    if (nextZoom === zoom) return;
    if (!anchor) {
      setZoom(nextZoom);
      return;
    }
    setOffset((current) => ({
      x: anchor.x - ((anchor.x - current.x) * nextZoom) / zoom,
      y: anchor.y - ((anchor.y - current.y) * nextZoom) / zoom,
    }));
    setZoom(nextZoom);
  };

  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    changeZoom(zoom + (event.deltaY < 0 ? PREVIEW_ZOOM_STEP : -PREVIEW_ZOOM_STEP), {
      x: event.clientX - bounds.left - bounds.width / 2,
      y: event.clientY - bounds.top - bounds.height / 2,
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || zoom === 1) return;
    drag.current = {
      offset,
      pointer: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeDrag = drag.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    setOffset({
      x: activeDrag.offset.x + event.clientX - activeDrag.pointer.x,
      y: activeDrag.offset.y + event.clientY - activeDrag.pointer.y,
    });
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
  };

  return (
    <div
      aria-label="图片预览区域，使用滚轮缩放，拖动图片平移"
      className={`evidence-preview-stage evidence-preview-image-stage${zoom !== 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`}
      onPointerCancel={stopDragging}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onWheel={onWheel}
      role="region"
      tabIndex={0}
    >
      <img
        alt={alt}
        draggable={false}
        onError={onError}
        src={src}
        style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}
      />
      <div aria-label="图片缩放控制" className="evidence-preview-toolbar" onPointerDown={(event) => event.stopPropagation()} role="toolbar">
        <Button aria-label="缩小" disabled={zoom === MIN_PREVIEW_ZOOM} onClick={() => changeZoom(zoom - PREVIEW_ZOOM_STEP)} size="icon-sm" title="缩小" type="button" variant="ghost"><Minus /></Button>
        <output aria-label="当前缩放比例" aria-live="polite">{Math.round(zoom * 100)}%</output>
        <Button aria-label="放大" disabled={zoom === MAX_PREVIEW_ZOOM} onClick={() => changeZoom(zoom + PREVIEW_ZOOM_STEP)} size="icon-sm" title="放大" type="button" variant="ghost"><Plus /></Button>
        <span aria-hidden="true" className="evidence-preview-toolbar-divider" />
        <Button aria-label="重置视图" disabled={zoom === 1 && offset.x === 0 && offset.y === 0} onClick={reset} size="icon-sm" title="重置视图" type="button" variant="ghost"><RotateCcw /></Button>
      </div>
    </div>
  );
}
