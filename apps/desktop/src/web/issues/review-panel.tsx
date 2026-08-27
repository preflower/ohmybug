import { MoreHorizontal } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { IssueDto, ReviewSubmissionInput } from "../api/types.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.js";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group.js";
import { Textarea } from "../components/ui/textarea.js";
import { CancelIssueButton } from "./cancel-issue-button.js";
import {
  ReviewCompactContext,
  ReviewRenderer,
  ReviewResponseFields,
} from "./review-renderers.js";

interface ReviewPanelProps {
  issue: IssueDto;
  onSubmit(input: ReviewSubmissionInput): Promise<void>;
  onCancel?: () => Promise<void>;
}

type Review = NonNullable<IssueDto["review"]>;
type ReviewChoice = Review["choices"][number];
type ReviewMode = "collapsed" | "composing" | "expanded";

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
}: ReviewPanelProps & { review: Review }) {
  const duplicateCandidate = issue.assessment?.suspectedDuplicateOf?.trim();
  const choices = useMemo(
    () => review.choices.filter((choice) => choice.id !== "duplicate" || Boolean(duplicateCandidate)),
    [duplicateCandidate, review.choices],
  );
  const dockChoices = useMemo(
    () => [...choices].sort((left, right) =>
      Number(isPrimaryChoice(left.id)) - Number(isPrimaryChoice(right.id))
    ),
    [choices],
  );
  const [mode, setMode] = useState<ReviewMode>("collapsed");
  const [choiceId, setChoiceId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [choiceData, setChoiceData] = useState<Record<string, ReviewSubmissionInput["data"]>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => choices.find((choice) => choice.id === choiceId),
    [choiceId, choices],
  );
  const response = choiceData[choiceId] ?? defaultResponse(issue, review.kind, choiceId);
  const missingRequiredData = review.kind === "assessment" && choiceId === "duplicate"
    && (!response || typeof response !== "object" || Array.isArray(response)
      || typeof response.duplicateOf !== "string" || !response.duplicateOf.trim());

  const submit = async (submittedChoiceId: string) => {
    if (busyRef.current) return;
    const submittedChoice = choices.find((choice) => choice.id === submittedChoiceId);
    const submittedResponse = choiceData[submittedChoiceId]
      ?? defaultResponse(issue, review.kind, submittedChoiceId);
    if (!submittedChoice || (submittedChoice.feedbackRequired && !feedback.trim())) return;
    busyRef.current = true;
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
      busyRef.current = false;
      setBusy(false);
    }
  };

  const openOrSubmit = (choice: ReviewChoice) => {
    setChoiceId(choice.id);
    setFeedback("");
    setError("");
    if (needsComposer(review.kind, choice)) {
      setMode("composing");
      return;
    }
    void submit(choice.id);
  };

  const collapse = () => {
    setChoiceId("");
    setFeedback("");
    setError("");
    setMode("collapsed");
  };

  const submitDisabled = busy
    || !selected
    || missingRequiredData
    || Boolean(selected?.feedbackRequired && !feedback.trim());

  return (
    <section
      aria-label={reviewTitle(review.kind)}
      className="review-dock"
      data-review-kind={review.kind}
      data-review-mode={busy ? "submitting" : mode}
    >
      {mode === "expanded" ? <div className="review-dock-expanded">
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
            {choices.map((choice) => <label className="review-choice" key={choice.id}>
              <RadioGroupItem value={choice.id} />
              <span>
                {choice.label}
                {choiceDescription(review.payload, choice.id)
                  ? <small>{choiceDescription(review.payload, choice.id)}</small>
                  : null}
              </span>
            </label>)}
          </RadioGroup>
        </div>
        <div className="review-expanded-actions">
          <Button disabled={busy} type="button" variant="ghost" onClick={collapse}>收起</Button>
          <Button disabled={submitDisabled} type="button" onClick={() => void submit(choiceId)}>
            {busy ? "提交中…" : selected?.label ?? "提交审核"}
          </Button>
        </div>
      </div> : null}

      {mode === "composing" && selected ? <div className="review-composer">
        <ReviewResponseFields
          issue={issue}
          choiceId={choiceId}
          data={response}
          onDataChange={(next) => setChoiceData((current) => ({
            ...current,
            [choiceId]: next,
          }))}
        />
        {selected.feedbackRequired ? <label className="feedback-field">
          {review.kind === "delivery" ? "修改说明（必填）" : "补充说明（必填）"}
          <Textarea
            autoFocus
            disabled={busy}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
        </label> : null}
        <div className="review-composer-actions">
          <Button
            aria-label="返回审核操作"
            disabled={busy}
            type="button"
            variant="ghost"
            onClick={collapse}
          >取消</Button>
          <Button disabled={submitDisabled} type="button" onClick={() => void submit(choiceId)}>
            {busy ? "提交中…" : composerSubmitLabel(review.kind, choiceId, selected.label)}
          </Button>
        </div>
      </div> : null}

      {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="review-dock-row">
        <div className="review-dock-context">
          <ReviewCompactContext issue={issue} />
        </div>
        <div className="review-dock-actions">
          {isComplexReview(review.kind) ? (
            <Button
              disabled={busy || mode === "expanded"}
              type="button"
              variant="secondary"
              onClick={() => {
                setChoiceId("");
                setError("");
                setMode("expanded");
              }}
            >选择处理方式</Button>
          ) : dockChoices.map((choice) => (
            <Button
              disabled={busy}
              key={choice.id}
              type="button"
              variant={isPrimaryChoice(choice.id) ? "default" : "secondary"}
              onClick={() => openOrSubmit(choice)}
            >{choice.label}</Button>
          ))}
          {onCancel ? <ReviewOverflow disabled={busy} onCancel={onCancel} /> : null}
        </div>
      </div>
    </section>
  );
}

function ReviewOverflow({
  disabled,
  onCancel,
}: {
  disabled: boolean;
  onCancel(): Promise<void>;
}) {
  return <Popover>
    <PopoverTrigger
      render={<Button
        aria-label="更多 Issue 操作"
        disabled={disabled}
        size="icon-sm"
        title="更多 Issue 操作"
        type="button"
        variant="ghost"
      />}
    ><MoreHorizontal aria-hidden="true" /></PopoverTrigger>
    <PopoverContent aria-label="更多 Issue 操作" className="review-overflow" side="top">
      <CancelIssueButton disabled={disabled} onCancel={onCancel} />
    </PopoverContent>
  </Popover>;
}

function defaultResponse(
  issue: IssueDto,
  kind: string,
  choiceId: string,
): ReviewSubmissionInput["data"] {
  if (kind !== "assessment") return undefined;
  if (choiceId === "implement") {
    return { title: issue.assessment?.suggestedTitle ?? issue.title };
  }
  const duplicateCandidate = issue.assessment?.suspectedDuplicateOf?.trim();
  if (choiceId === "duplicate" && duplicateCandidate) {
    return { duplicateOf: duplicateCandidate };
  }
  return undefined;
}

function needsComposer(kind: string, choice: ReviewChoice): boolean {
  return Boolean(choice.feedbackRequired)
    || (kind === "assessment" && ["implement", "duplicate"].includes(choice.id));
}

function composerSubmitLabel(kind: string, choiceId: string, fallback: string): string {
  if (kind === "delivery" && choiceId === "request-changes") return "提交修改要求";
  return fallback;
}

function isComplexReview(kind: string): boolean {
  return kind === "business-merge-conflict" || !["assessment", "delivery"].includes(kind);
}

function isPrimaryChoice(choiceId: string): boolean {
  return choiceId === "accept" || choiceId === "implement";
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
