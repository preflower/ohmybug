import { Activity, ChevronDown, CircleAlert, CircleCheck, Terminal } from "lucide-react";
import { useState } from "react";

import type { AgentEventDto } from "../api/types.js";
import { Button } from "../components/ui/button.js";

const actorLabels: Record<AgentEventDto["actor"], string> = {
  SYSTEM: "Oh My Bug",
  USER: "用户",
  AGENT: "Codex",
};

const eventLabels: Record<string, string> = {
  ISSUE_CREATED: "Issue 已创建",
  INPUT_APPENDED: "收到新的 Issue 信息",
  ASSESSMENT_STARTED: "开始分析",
  ASSESSMENT_READY: "分析完成，等待确认",
  ASSESSMENT_FAILED: "分析失败",
  ASSESSMENT_APPROVED: "已确认改动类型并授权实现",
  NOT_A_BUG_CONFIRMED: "已确认不是 Bug",
  DUPLICATE_CONFIRMED: "已确认重复 Issue",
  REASSESSMENT_REQUESTED: "已要求重新分析",
  ASSESSMENT_RETRIED: "正在重新分析",
  REPAIR_STARTED: "开始实现",
  REPAIR_RETRIED: "正在重新实现",
  IMPLEMENTATION_READY: "实现完成，准备采集证据",
  EVIDENCE_CAPTURE_STARTED: "开始采集验证证据",
  EVIDENCE_CAPTURE_REQUEUED: "证据未通过，正在重新采集",
  EVIDENCE_FAILED: "证据采集失败；实现改动已保留",
  EVIDENCE_RETRIED: "正在重新采集证据",
  DELIVERY_READY: "改动完成，等待验收",
  DELIVERY_REJECTED: "验收未通过，继续实现",
  DELIVERY_APPROVED: "改动已验收",
  EVIDENCE_ACCEPTED: "验证证据已通过",
  EVIDENCE_REJECTED: "验证证据未通过",
  AGENT_SESSION_REBUILD_REQUESTED: "正在重建 Codex 会话",
  AGENT_SESSION_REBUILT: "Codex 会话已重建",
  AGENT_SESSION_CONNECTED: "Codex 会话已连接",
  AGENT_TURN_STARTED: "Codex 已开始工作",
  AGENT_TURN_COMPLETED: "Codex 已完成工作",
  AGENT_COMMAND_STARTED: "正在执行项目命令",
  AGENT_COMMAND_COMPLETED: "项目命令执行完成",
  AGENT_COMMAND_FAILED: "项目命令执行失败",
  AGENT_FILES_CHANGED: "文件已更新",
  AGENT_FILES_CHANGE_FAILED: "文件更新失败",
  AGENT_ERROR: "Codex 运行失败",
  ISSUE_CANCELED: "任务已取消",
  RUNTIME_INTERRUPTED: "Runtime 已重启，正在恢复任务",
};

export function AgentActivity({ events, active }: { events: AgentEventDto[]; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const message = (event: AgentEventDto) => {
    if (typeof event.data.message === "string") return event.data.message;
    if (event.type === "RUNTIME_INTERRUPTED") {
      if (event.data.operation === "ASSESS") return "Runtime 已重启，正在恢复分析";
      if (event.data.operation === "REPAIR") return "Runtime 已重启，正在恢复实现";
      if (event.data.operation === "CAPTURE_EVIDENCE") return "Runtime 已重启，正在恢复证据采集";
      if (event.data.operation === "EVIDENCE") return "Runtime 已重启，正在恢复证据检查";
    }
    return eventLabels[event.type] ?? "状态已更新";
  };
  const latestEvent = events.at(-1);
  const latestMessage = latestEvent ? message(latestEvent) : "Agent 正在工作";
  const currentClass = active
    ? latestEvent?.data.level === "error"
      ? "activity-current activity-current-error"
      : "activity-active activity-current"
    : "activity-current";
  return <section className="agent-activity">
    <Button aria-expanded={expanded} aria-label="Agent 活动" className="h-auto w-full justify-between" type="button" variant="ghost" onClick={() => setExpanded((value) => !value)}>
      <span><Activity size={14} />Agent 活动</span>
      <span aria-live="polite" className={currentClass} title={active ? latestMessage : undefined}>{active ? latestMessage : `${events.length} 条事件`}</span>
      <ChevronDown className={expanded ? "activity-chevron-open" : ""} size={14} />
    </Button>
    {expanded ? <ol>{events.length ? events.map((event) => {
      const detail = typeof event.data.detail === "string" ? event.data.detail : undefined;
      const level = event.data.level === "error" ? "error" : "info";
      const Icon = level === "error"
        ? CircleAlert
        : event.type.includes("COMMAND")
          ? Terminal
          : event.type.endsWith("COMPLETED") || event.type.endsWith("READY")
            ? CircleCheck
            : Activity;
      return <li className={level === "error" ? "activity-error" : undefined} key={event.id}><div className="activity-event"><span className="activity-event-heading"><Icon aria-hidden="true" size={13} /><span>{actorLabels[event.actor]}</span></span><p>{message(event)}</p>{detail ? <details className="activity-detail"><summary>查看详情</summary><pre>{detail}</pre></details> : null}</div><time>{new Date(event.occurredAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></li>;
    }) : <li className="activity-empty">Agent 尚未产生事件。</li>}</ol> : null}
  </section>;
}
