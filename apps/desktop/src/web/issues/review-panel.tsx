import { ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { IssueDto, ReviewSubmissionInput } from "../api/types.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Textarea } from "../components/ui/textarea.js";
import { ReviewRenderer, reviewTitle } from "./review-renderers.js";

interface ReviewPanelProps {
  issue: IssueDto;
  onSubmit(input: ReviewSubmissionInput): Promise<void>;
  onCancel?: () => Promise<void>;
}

export function ReviewPanel({ issue, onSubmit, onCancel }: ReviewPanelProps) {
  const review = issue.review;
  const [choiceId, setChoiceId] = useState(review?.choices[0]?.id ?? "");
  const [feedback, setFeedback] = useState("");
  const [data, setData] = useState<ReviewSubmissionInput["data"]>();
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setChoiceId(review?.choices[0]?.id ?? "");
    setFeedback("");
    setData(undefined);
    setError("");
  }, [review?.id]);

  const selected = useMemo(
    () => review?.choices.find((choice) => choice.id === choiceId),
    [choiceId, review],
  );
  if (!review) return null;
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

      <ReviewRenderer issue={issue} choiceId={choiceId} data={data} onDataChange={setData} />

      <fieldset className="review-choice-list" disabled={busy || canceling}>
        <legend>选择处理方式</legend>
        {review.choices.map((choice) => (
          <label className="review-choice" key={choice.id}>
            <input
              checked={choiceId === choice.id}
              name={`review-${review.id}`}
              onChange={() => setChoiceId(choice.id)}
              type="radio"
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
      </fieldset>

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
