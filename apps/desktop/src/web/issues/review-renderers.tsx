import type { IssueDto, ReviewSubmissionInput } from "../api/types.js";
import { Input } from "../components/ui/input.js";

type ReviewData = ReviewSubmissionInput["data"];

interface ReviewResponseFieldsProps {
  issue: IssueDto;
  choiceId: string;
  data: ReviewData;
  onDataChange(data: ReviewData): void;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function ReviewRenderer({ issue }: { issue: IssueDto }) {
  const review = issue.review;
  if (!review) return null;
  const payload = record(review.payload) ?? {};

  if (review.kind === "assessment") {
    const verdict = text(payload.verdict) ?? issue.assessment?.verdict;
    return (
      <div className="review-decision-context">
        <p>当前判断：<strong>{verdict ?? "待确认"}</strong></p>
        <p>确认实现会允许 Agent 修改本机 Issue 工作区并运行项目验证。</p>
      </div>
    );
  }

  if (review.kind === "delivery") {
    return (
      <div className="review-decision-context">
        <p>批准后会确认当前迭代的证据，并发布已验证的 Issue commit。</p>
        <dl>
          <div><dt>Repair iteration</dt><dd>{String(payload.repairIteration ?? issue.repair?.iteration ?? "-")}</dd></div>
          <div><dt>证据数量</dt><dd>{String(payload.evidenceCount ?? issue.repair?.delivery?.evidence.length ?? 0)}</dd></div>
        </dl>
      </div>
    );
  }

  if (review.kind === "business-merge-conflict") {
    return (
      <div className="business-conflict-review">
        <p className="business-conflict-summary">{text(payload.summary) ?? "AI 发现两种业务行为无法同时成立。"}</p>
        <div className="business-intent-comparison">
          <div><span>基线行为</span><p>{text(payload.baseIntent) ?? "未提供"}</p></div>
          <div><span>Issue 行为</span><p>{text(payload.issueIntent) ?? "未提供"}</p></div>
        </div>
        <div className="business-conflict-reason">
          <strong>互斥原因</strong>
          <p>{text(payload.incompatibility) ?? "需要人工确认最终业务语义。"}</p>
        </div>
        {strings(payload.conflictPaths).length > 0 ? (
          <div className="business-conflict-paths">
            <span>影响路径</span>
            {strings(payload.conflictPaths).map((path) => <code key={path}>{path}</code>)}
          </div>
        ) : null}
        <div className="business-recommendation">
          <span>AI 建议：{text(payload.recommendation) ?? "请根据业务目标选择"}</span>
          <p>{text(payload.rationale) ?? ""}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="review-decision-context">
      <p>此审核类型来自扩展模块。请选择明确操作后继续。</p>
      <dl>{Object.entries(payload).slice(0, 12).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{safeSummary(value)}</dd>
        </div>
      ))}</dl>
    </div>
  );
}

export function ReviewResponseFields({
  issue,
  choiceId,
  data,
  onDataChange,
}: ReviewResponseFieldsProps) {
  if (issue.review?.kind !== "assessment") return null;
  const response = record(data) ?? {};

  if (choiceId === "implement") {
    return (
      <label className="feedback-field">
        Issue 标题
        <Input
          value={text(response.title) ?? issue.assessment?.suggestedTitle ?? issue.title}
          onChange={(event) => onDataChange({ ...response, title: event.target.value })}
        />
      </label>
    );
  }

  if (choiceId === "duplicate") {
    return (
      <label className="feedback-field">
        重复 Issue
        <Input
          value={text(response.duplicateOf) ?? ""}
          onChange={(event) => onDataChange({ ...response, duplicateOf: event.target.value })}
        />
      </label>
    );
  }

  return null;
}

function safeSummary(value: unknown): string {
  if (value === null) return "null";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).slice(0, 300);
  if (Array.isArray(value)) return `${value.length} 项`;
  return value && typeof value === "object" ? `${Object.keys(value).length} 个字段` : "-";
}
