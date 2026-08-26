import { ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import type { IssueDto, ReviewSubmissionInput } from "../api/types.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group.js";
import { Textarea } from "../components/ui/textarea.js";
import { CancelIssueButton } from "./cancel-issue-button.js";
import { ReviewCompactContext, ReviewRenderer, ReviewResponseFields } from "./review-renderers.js";

interface ReviewPanelProps {
  issue: IssueDto;
  onSubmit(input: ReviewSubmissionInput): Promise<void>;
  onCancel?: () => Promise<void>;
}

export function ReviewPanel({ issue, onSubmit, onCancel }: ReviewPanelProps) {
  const review = issue.review;
  if (!review) return null;
  return <ReviewPanelContent
    issue={issue}
    key={review.id}
    review={review}
    onCancel={onCancel}
    onSubmit={onSubmit}
  />;
}

function ReviewPanelContent({
  issue,
  review,
  onSubmit,
  onCancel,
}: ReviewPanelProps & { review: NonNullable<IssueDto["review"]> }) {
  const duplicateCandidate = issue.assessment?.suspectedDuplicateOf?.trim();
  const choices = useMemo(
    () => review.choices.filter((choice) => choice.id !== "duplicate" || Boolean(duplicateCandidate)),
    [duplicateCandidate, review.choices],
  );
  const [choiceId, setChoiceId] = useState(choices[0]?.id ?? "");
  const [feedback, setFeedback] = useState("");
  const [choiceData, setChoiceData] = useState<Record<string, ReviewSubmissionInput["data"]>>({});
  const [mode, setMode] = useState<"collapsed" | "composing">("collapsed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => choices.find((choice) => choice.id === choiceId),
    [choiceId, choices],
  );
  const response = choiceData[choiceId] ?? (review.kind === "assessment"
    ? choiceId === "implement"
      ? { title: issue.assessment?.suggestedTitle ?? issue.title }
      : choiceId === "duplicate" && duplicateCandidate
        ? { duplicateOf: duplicateCandidate }
        : undefined
    : undefined);
  const missingRequiredData = review.kind === "assessment" && choiceId === "duplicate"
    && (!response || typeof response !== "object" || Array.isArray(response)
      || typeof response.duplicateOf !== "string" || !response.duplicateOf.trim());

  const submit = async (submittedChoiceId = choiceId) => {
    const submittedChoice = choices.find((choice) => choice.id === submittedChoiceId);
    const submittedResponse = choiceData[submittedChoiceId] ?? (review.kind === "assessment"
      ? submittedChoiceId === "implement"
        ? { title: issue.assessment?.suggestedTitle ?? issue.title }
        : submittedChoiceId === "duplicate" && duplicateCandidate
          ? { duplicateOf: duplicateCandidate }
          : undefined
      : undefined);
    if (!submittedChoice || (submittedChoice.feedbackRequired && !feedback.trim())) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        expectedRevision: issue.revision,
        requestId: review.id,
        choiceId: submittedChoice.id,
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
        ...(submittedResponse === undefined ? {} : { data: submittedResponse }),
      });
    } catch (caught) {
      setError(reviewErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (review.kind === "delivery") {
    const requestChanges = choices.find((choice) => choice.id === "request-changes");
    return (
      <section
        aria-label={reviewTitle(review.kind)}
        className="review-dock"
        data-review-kind={review.kind}
        data-review-mode={busy ? "submitting" : mode}
      >
        {mode === "composing" && selected ? <div className="review-composer">
          <label className="feedback-field">
            {selected.feedbackRequired ? "修改说明（必填）" : "修改说明（可选）"}
            <Textarea
              autoFocus
              disabled={busy}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </label>
          <div className="review-composer-actions">
            <Button
              aria-label="返回审核操作"
              disabled={busy}
              type="button"
              variant="ghost"
              onClick={() => {
                setChoiceId(choices[0]?.id ?? "");
                setFeedback("");
                setError("");
                setMode("collapsed");
              }}
            >取消</Button>
            <Button
              disabled={busy || Boolean(selected.feedbackRequired && !feedback.trim())}
              type="button"
              onClick={() => void submit(selected.id)}
            >{busy ? "提交中…" : "提交修改要求"}</Button>
          </div>
        </div> : null}
        {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <div className="review-dock-row">
          <div className="review-dock-summary">
            <span className="approval-kicker">等待人工决定</span>
            <ReviewCompactContext issue={issue} />
          </div>
          <div className="review-dock-actions">
            {requestChanges ? <Button
              disabled={busy}
              type="button"
              variant="secondary"
              onClick={() => {
                setChoiceId(requestChanges.id);
                setError("");
                setMode("composing");
              }}
            >{requestChanges.label}</Button> : null}
            {choices.filter((choice) => choice.id !== "request-changes").map((choice) => <Button
              disabled={busy}
              key={choice.id}
              type="button"
              onClick={() => void submit(choice.id)}
            >{busy ? "提交中…" : choice.label}</Button>)}
            {onCancel ? <CancelIssueButton disabled={busy} onCancel={onCancel} /> : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="approval-panel review-panel" aria-label={reviewTitle(review.kind)}>
      <div className="approval-dock-summary">
        <ShieldCheck aria-hidden="true" size={24} strokeWidth={1.6} />
        <div>
          <span className="approval-kicker">等待人工决定</span>
          <strong>{reviewTitle(review.kind)}</strong>
          <p>选择会被记录，并只解锁该选项声明的下一步。</p>
        </div>
      </div>

      <ReviewRenderer issue={issue} />

      <div className="review-choice-list">
        <span className="review-choice-legend">选择处理方式</span>
        <RadioGroup
          aria-label="选择处理方式"
          disabled={busy}
          name={`review-${review.id}`}
          value={choiceId}
          onValueChange={setChoiceId}
        >
        {choices.map((choice) => (
          <label className="review-choice" key={choice.id}>
            <RadioGroupItem
              value={choice.id}
            />
            <span>
              {choice.label}
              {choiceDescription(review.payload, choice.id) ? (
                <small>{choiceDescription(review.payload, choice.id)}</small>
              ) : null}
            </span>
          </label>
        ))}
        </RadioGroup>
      </div>

      <ReviewResponseFields
        issue={issue}
        choiceId={choiceId}
        data={response}
        onDataChange={(next) => setChoiceData((current) => ({
          ...current,
          [choiceId]: next,
        }))}
      />

      <label className="feedback-field">
        {selected?.feedbackRequired ? "补充说明（必填）" : "补充说明（可选）"}
        <Textarea
          disabled={busy}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
        />
      </label>
      {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="approval-actions">
        {onCancel ? <CancelIssueButton disabled={busy} onCancel={onCancel} /> : null}
        <Button
          disabled={busy || !selected || missingRequiredData || Boolean(selected.feedbackRequired && !feedback.trim())}
          type="button"
          onClick={() => void submit()}
        >{busy ? "提交中…" : selected?.label ?? "提交审核"}</Button>
      </div>
    </section>
  );
}

function reviewErrorMessage(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : "审核提交失败";
  if (message.includes("DUPLICATE_NOT_SUGGESTED")) {
    return "Agent 尚未提供疑似重复目标，请选择其他处理方式或要求重新分析。";
  }
  if (message.includes("DUPLICATE_TARGET_NOT_FOUND")) {
    return "找不到该重复 Issue，请检查编号后重试。";
  }
  if (message.includes("DUPLICATE_TARGET_SELF")) {
    return "不能把 Issue 标记为自身的重复项。";
  }
  return message;
}

function reviewTitle(kind: string): string {
  if (kind === "assessment") return "确认 Assessment";
  if (kind === "delivery") return "验收 Delivery";
  if (kind === "business-merge-conflict") return "确认业务冲突处理";
  return "人工审核";
}

function choiceDescription(payload: unknown, choiceId: string): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return undefined;
  const choice = choices.find((item) => item && typeof item === "object"
    && !Array.isArray(item) && (item as Record<string, unknown>).id === choiceId);
  if (!choice || Array.isArray(choice)) return undefined;
  const description = (choice as Record<string, unknown>).description;
  return typeof description === "string" ? description : undefined;
}
