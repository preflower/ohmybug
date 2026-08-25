import { ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import type { IssueDto, ReviewSubmissionInput } from "../api/types.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group.js";
import { Textarea } from "../components/ui/textarea.js";
import { ReviewRenderer, ReviewResponseFields } from "./review-renderers.js";

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
  const [choiceId, setChoiceId] = useState(review?.choices[0]?.id ?? "");
  const [feedback, setFeedback] = useState("");
  const [data, setData] = useState<ReviewSubmissionInput["data"]>();
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => review?.choices.find((choice) => choice.id === choiceId),
    [choiceId, review],
  );
  const response = data ?? (review.kind === "assessment" && choiceId === "implement"
    ? { title: issue.assessment?.suggestedTitle ?? issue.title }
    : undefined);
  const missingRequiredData = review.kind === "assessment" && choiceId === "duplicate"
    && (!data || typeof data !== "object" || Array.isArray(data)
      || typeof data.duplicateOf !== "string" || !data.duplicateOf.trim());

  const submit = async () => {
    if (!selected || (selected.feedbackRequired && !feedback.trim())) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        expectedRevision: issue.revision,
        requestId: review.id,
        choiceId: selected.id,
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
        ...(response === undefined ? {} : { data: response }),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审核提交失败");
    } finally {
      setBusy(false);
    }
  };

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
          disabled={busy || canceling}
          name={`review-${review.id}`}
          value={choiceId}
          onValueChange={setChoiceId}
        >
        {review.choices.map((choice) => (
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
        data={data}
        onDataChange={setData}
      />

      <label className="feedback-field">
        {selected?.feedbackRequired ? "补充说明（必填）" : "补充说明（可选）"}
        <Textarea
          disabled={busy || canceling}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
        />
      </label>
      {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="approval-actions">
        {onCancel ? (
          <Button
            disabled={busy || canceling}
            type="button"
            variant="secondary"
            onClick={() => {
              setCanceling(true);
              setError("");
              void onCancel()
                .catch((caught) => setError(caught instanceof Error ? caught.message : "取消失败"))
                .finally(() => setCanceling(false));
            }}
          >{canceling ? "取消中…" : "取消 Issue"}</Button>
        ) : null}
        <Button
          disabled={busy || canceling || !selected || missingRequiredData || Boolean(selected.feedbackRequired && !feedback.trim())}
          type="button"
          onClick={() => void submit()}
        >{busy ? "提交中…" : selected?.label ?? "提交审核"}</Button>
      </div>
    </section>
  );
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
