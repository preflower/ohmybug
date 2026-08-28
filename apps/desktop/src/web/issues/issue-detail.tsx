import { CircleAlert, Image as ImageIcon, Maximize2, Minus, Play, Plus, RotateCcw, Search, Wrench, X } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent, useEffect, useRef, useState } from "react";

import { api } from "../api/client.js";
import type {
  BranchInfoDto,
  AgentEventDto,
  IssueDto,
  ReviewSubmissionInput,
} from "../api/types.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog.js";
import { IssueActions } from "./issue-actions.js";
import { CodexTerminal } from "./agent-activity.js";
import { hasExecutionEvents, useCurrentExecutionEvents } from "./terminal-execution.js";

interface IssueDetailProps {
  issue: IssueDto;
  branch?: BranchInfoDto;
  agentActive?: boolean;
  agentEvents?: AgentEventDto[];
  agentSessionId?: string;
  metadataRail?: ReactNode;
  terminalAction?: ReactNode;
  workspaceBranch?: string;
  onRefresh: () => Promise<void>;
  onApproveDelivery?: () => Promise<void>;
  onSubmitReview?: (input: ReviewSubmissionInput) => Promise<void>;
  onPause?: () => Promise<void>;
  onResume?: () => Promise<void>;
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

function isBaseIntegrationRevalidation(issue: IssueDto, events: AgentEventDto[]): boolean {
  const iteration = issue.repair?.iteration;
  return issue.status === "REPAIRING"
    && typeof iteration === "number"
    && events.some((event) =>
      event.type === "BASE_INTEGRATION_STALE" && event.data.iteration === iteration
    );
}

export function IssueDetail({
  issue,
  branch,
  agentActive = false,
  agentEvents = [],
  agentSessionId,
  metadataRail,
  terminalAction,
  workspaceBranch,
  onRefresh,
  onApproveDelivery,
  onSubmitReview,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onRebuildSession,
  onGrantCapabilities,
}: IssueDetailProps) {
  const assessment = issue.assessment;
  const delivery = issue.repair?.delivery;
  const latestInput = issue.inputs.at(-1);
  const deliveryIntegration = issue.repair?.deliveryDraft?.integration;
  const deliveryBranch = deliveryIntegration?.issueBranch ?? workspaceBranch ?? branch?.name;
  const deliveryCommit = deliveryIntegration?.issueCommit ?? branch?.commit;
  const currentExecutionEvents = useCurrentExecutionEvents(agentEvents, issue.id, agentSessionId);
  const terminalVisible = hasExecutionEvents(currentExecutionEvents, agentActive);
  return (
    <article className="issue-detail">
      <div className="issue-detail-document">
        <div className="issue-detail-content">
      <header className="issue-title-block">
        <div className="issue-title-meta">
          <span className="eyebrow">{issue.identifier}</span>
        </div>
        <h2>{issue.title}</h2>
        {latestInput?.data.content ? <p>{latestInput.data.content}</p> : null}
      </header>

      {isBaseIntegrationRevalidation(issue, agentEvents) ? (
        <div className="revalidation-banner" role="status">
          <RotateCcw aria-hidden="true" size={16} />
          <div>
            <strong>基线已更新，正在重新集成并验证</strong>
            <span>完成后会生成新的交付证据，需要再次验收。</span>
          </div>
        </div>
      ) : null}

      {issue.status === "EVIDENCE_FAILED" ? <div className="error-banner" role="alert"><CircleAlert aria-hidden="true" size={15} />证据采集失败；实现改动和工作目录已保留。</div> : issue.lastFailure ? <div className="error-banner" role="alert"><CircleAlert aria-hidden="true" size={15} />{failureMessage(issue.lastFailure)}</div> : null}

      {issue.status === "FINALIZATION_RECOVERY" && issue.finalizationRecovery ? (
        <section
          aria-label="交付恢复诊断"
          className="finalization-recovery-diagnostic-card"
        >
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
      {assessment ? (
        <section className="review-section assessment-review" data-testid="assessment-review">
          <div className="review-heading"><span>评估结果 · Assessment</span></div>
          <div className="assessment-block assessment-verdict"><CircleAlert aria-hidden="true" size={17} /><div><h3>判断：{verdictLabels[assessment.verdict]}</h3><p>{assessment.reasoning}</p></div></div>
          {assessment.rootCause ? <div className="assessment-block"><Search aria-hidden="true" size={17} /><div><h3>Bug 原因</h3><p>{assessment.rootCause}</p></div></div> : null}
          {assessment.solution ? <div className="assessment-block"><Wrench aria-hidden="true" size={17} /><div><h3>{assessment.verdict === "FEATURE" ? "实现方案" : "解决方案"}</h3><p>{assessment.solution}</p></div></div> : null}
          {assessment.suspectedDuplicateOf ? <div><h4>疑似重复</h4><p>{assessment.suspectedDuplicateOf}</p></div> : null}
        </section>
      ) : null}

      <CodexTerminal
        active={agentActive}
        events={agentEvents}
        sessionId={agentSessionId}
        terminalAction={terminalAction}
      />

      {delivery && !terminalVisible ? <>
        {delivery.evidence.length ? <section aria-label="证据" className="review-section issue-evidence-section">
          <div className="review-heading"><span>证据</span></div>
          <p className="evidence-conclusion">{delivery.summary}</p>
          <div className="evidence-gallery">{delivery.evidence.map((evidence, index) => <EvidenceFigure evidence={evidence} issueId={issue.id} key={`${issue.id}-${evidence.evidenceId}-${index}`} />)}</div>
        </section> : null}
        <section aria-label="交付" className="review-section issue-delivery-section">
          <div className="review-heading"><span>交付</span></div>
          <p className="delivery-summary">{issue.repair?.deliveryDraft?.summary ?? delivery.summary}</p>
          {deliveryBranch || deliveryCommit ? <dl className="delivery-metadata">
            {deliveryBranch ? <div><dt>目标分支</dt><dd><code>{deliveryBranch}</code></dd></div> : null}
            {deliveryCommit ? <div><dt>Issue 提交</dt><dd><code>{deliveryCommit.slice(0, 7)}</code></dd></div> : null}
          </dl> : null}
        </section>
      </> : null}

        </div>
      </div>
      {metadataRail}
      <IssueActions
        issue={issue}
        onApproveDelivery={onApproveDelivery}
        onCancel={onCancel}
        onGrantCapabilities={onGrantCapabilities}
        onPause={onPause}
        onRebuildSession={onRebuildSession}
        onRefresh={onRefresh}
        onResume={onResume}
        onRetry={onRetry}
        onSubmitReview={onSubmitReview}
      />
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
