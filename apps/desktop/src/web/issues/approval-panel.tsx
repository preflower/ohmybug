import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import type { ApproveAssessmentInput, AssessmentReference } from "../api/types.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Textarea } from "../components/ui/textarea.js";

type AssessmentProps = {
  stage: "ASSESSMENT";
  revision: number;
  contentHash: string;
  title: string;
  verdict: "BUG" | "FEATURE" | "NOT_A_BUG" | "UNCERTAIN";
  suspectedDuplicateOf?: string;
  onApprove?: (approval: ApproveAssessmentInput) => Promise<void>;
  onClose?: () => Promise<void>;
  onConfirmNotABug?: (reference: AssessmentReference) => Promise<void>;
  onConfirmDuplicate?: (reference: AssessmentReference, duplicateOf: string) => Promise<void>;
  onRequestChanges: (feedback: string) => Promise<void>;
};

type DeliveryProps = {
  stage: "DELIVERY";
  revision: number;
  verdict: "BUG" | "FEATURE";
  onApprove: () => Promise<void>;
  onRequestChanges: (feedback: string) => Promise<void>;
};

type ApprovalPanelProps = AssessmentProps | DeliveryProps;

export function ApprovalPanel(props: ApprovalPanelProps) {
  const [feedback, setFeedback] = useState("");
  const [title, setTitle] = useState(props.stage === "ASSESSMENT" ? props.title : "");
  const [duplicateOf, setDuplicateOf] = useState(props.stage === "ASSESSMENT" ? props.suspectedDuplicateOf ?? "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const isAssessment = props.stage === "ASSESSMENT";
  const implementableAssessment = isAssessment && (props.verdict === "BUG" || props.verdict === "FEATURE");
  const compactAssessment = implementableAssessment && !props.suspectedDuplicateOf;
  const assessmentHeading = isAssessment
    ? props.suspectedDuplicateOf
      ? "确认重复 Issue"
      : props.verdict === "BUG"
        ? "确认并开始修复"
        : props.verdict === "FEATURE"
          ? "确认并开始实现"
          : props.verdict === "NOT_A_BUG"
            ? "确认不是 Bug"
            : "补充信息并重新分析"
    : "";
  const reference = isAssessment ? {
    assessmentRevision: props.revision,
    assessmentContentHash: props.contentHash,
  } : undefined;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const requestChanges = () => {
    const value = feedback.trim();
    if (compactAssessment && !feedbackOpen) {
      setFeedbackOpen(true);
      return;
    }
    if (!value) return;
    void run(() => props.onRequestChanges(value));
  };

  const closeIssue = () => {
    if (!isAssessment || !props.onClose) return;
    void run(props.onClose).then((closed) => {
      if (closed) setCloseOpen(false);
    });
  };

  if (compactAssessment) {
    return (
      <section className="approval-panel approval-dock" data-testid="assessment-approval-dock" aria-label="评估结果操作">
        <div className="approval-dock-summary">
          <ShieldCheck aria-hidden="true" size={27} strokeWidth={1.6} />
          <div>
            <span className="approval-kicker">等待授权</span>
            <strong>{props.verdict === "FEATURE" ? "确认并开始实现" : "确认并开始修复"}</strong>
            <p>将解锁：修改本机代码并运行项目命令</p>
          </div>
        </div>
        <div className="approval-actions">
          {props.onClose ? <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
            <DialogTrigger render={<Button disabled={busy} type="button" variant="ghost" />}>关闭 Issue</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>关闭 Issue？</DialogTitle>
                <DialogDescription>关闭后 Issue 将标记为已取消；项目文件和已有修改不会被删除。</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button disabled={busy} type="button" variant="secondary" />}>返回</DialogClose>
                <Button disabled={busy} type="button" variant="destructive" onClick={closeIssue}>{busy ? "关闭中…" : "确认关闭"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog> : null}
          <Button disabled={busy} type="button" variant="secondary" onClick={requestChanges}>重新分析</Button>
          {props.onApprove ? <Button disabled={busy || !title.trim()} type="button" onClick={() => void run(() => props.onApprove!({ ...reference!, title: title.trim() }))}>{props.verdict === "FEATURE" ? "开始实现" : "开始修复"}</Button> : null}
        </div>
        {feedbackOpen ? <div className="approval-feedback"><label className="feedback-field">修改意见<Textarea autoFocus value={feedback} onChange={(event) => setFeedback(event.target.value)} /></label><div className="approval-feedback-actions"><Button type="button" variant="ghost" onClick={() => setFeedbackOpen(false)}>取消</Button><Button disabled={busy || !feedback.trim()} type="button" onClick={requestChanges}>提交并重新分析</Button></div></div> : null}
        {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      </section>
    );
  }

  return (
    <section className="approval-panel" aria-label={isAssessment ? "评估结果操作" : "Delivery 审核"}>
      <div className="approval-meta">
        <strong>{isAssessment ? assessmentHeading : "确认验收结果"}</strong>
      </div>

      {implementableAssessment ? <>
        <p>确认后，Codex 将按当前方案修改代码并运行验证。</p>
        <label className="feedback-field">Issue 标题<Input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      </> : isAssessment && props.verdict === "NOT_A_BUG" ? (
        <p>确认后，此 Issue 将按“不是 Bug”关闭。</p>
      ) : isAssessment && props.verdict === "UNCERTAIN" ? (
        <p>补充受影响页面、组件或复现方式，Codex 将重新分析。</p>
      ) : (
        <p>批准后将确认当前证据有效，并把 Issue 完成为 {props.verdict === "FEATURE" ? "IMPLEMENTED" : "FIXED"}。</p>
      )}

      {isAssessment && props.suspectedDuplicateOf ? (
        <label className="feedback-field">重复 Issue<Input value={duplicateOf} onChange={(event) => setDuplicateOf(event.target.value)} /></label>
      ) : null}
      <label className="feedback-field">{isAssessment && props.verdict === "UNCERTAIN" ? "补充信息" : "修改意见（可选）"}<Textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} /></label>
      {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="approval-actions">
        <Button disabled={busy || !feedback.trim()} type="button" variant="secondary" onClick={requestChanges}>{isAssessment ? props.verdict === "UNCERTAIN" ? "提交并重新分析" : "要求重新分析" : "要求修改"}</Button>
        {isAssessment && props.suspectedDuplicateOf && props.onConfirmDuplicate ? (
          <Button disabled={busy || !duplicateOf.trim()} type="button" variant="secondary" onClick={() => void run(() => props.onConfirmDuplicate!(reference!, duplicateOf.trim()))}>确认重复并关闭</Button>
        ) : null}
        {implementableAssessment && props.onApprove ? (
          <Button disabled={busy || !title.trim()} type="button" onClick={() => void run(() => props.onApprove!({ ...reference!, title: title.trim() }))}>{props.verdict === "FEATURE" ? "确认是 Feature 并开始实现" : "确认是 Bug 并开始修复"}</Button>
        ) : null}
        {isAssessment && props.verdict === "NOT_A_BUG" && props.onConfirmNotABug ? (
          <Button disabled={busy} type="button" onClick={() => void run(() => props.onConfirmNotABug!(reference!))}>确认不是 Bug 并关闭</Button>
        ) : null}
        {!isAssessment ? (
          <Button disabled={busy} type="button" onClick={() => void run(props.onApprove)}>批准验收并完成 Issue</Button>
        ) : null}
      </div>
    </section>
  );
}
