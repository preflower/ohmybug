import { Activity, ChevronDown, CircleAlert, CircleCheck, Clock3, FilePenLine, Terminal } from "lucide-react";
import { useState } from "react";

import type { AgentEventDto } from "../api/types.js";
import { Button } from "../components/ui/button.js";

const activityPageSize = 80;

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
  AGENT_FILES_CHANGED: "文件已更新",
  AGENT_FILES_CHANGE_FAILED: "文件更新失败",
  AGENT_TEMP_CLEANUP_FAILED: "临时目录清理失败",
  AGENT_ERROR: "Codex 运行失败",
  ISSUE_CANCELED: "任务已取消",
  RUNTIME_INTERRUPTED: "Runtime 已重启，正在恢复任务",
};

type ActivityLine = CommandLine | EventLine;

interface CommandLine {
  kind: "command";
  id: string;
  command: string;
  output?: string;
  occurredAt: string;
  status: "running" | "completed" | "failed" | "interrupted" | "canceled";
}

interface EventLine {
  kind: "event";
  event: AgentEventDto;
  message: string;
  detail?: string;
}

interface ActivityGroup {
  id: string;
  label: string;
  lines: ActivityLine[];
  occurredAt: string;
  finishedAt?: string;
  status: "idle" | "running" | "completed" | "error" | "interrupted" | "canceled";
  turn: boolean;
}

function eventMessage(event: AgentEventDto): string {
  if (typeof event.data.message === "string") return event.data.message;
  if (event.type === "RUNTIME_INTERRUPTED") {
    if (event.data.operation === "ASSESS") return "Runtime 已重启，正在恢复分析";
    if (event.data.operation === "REPAIR") return "Runtime 已重启，正在恢复实现";
    if (event.data.operation === "CAPTURE_EVIDENCE") return "Runtime 已重启，正在恢复证据采集";
    if (event.data.operation === "EVIDENCE") return "Runtime 已重启，正在恢复证据检查";
  }
  return eventLabels[event.type] ?? "状态已更新";
}

function commandContent(event: AgentEventDto): { command: string; output?: string } {
  const detail = typeof event.data.detail === "string" ? event.data.detail : "";
  const [firstLine = "", ...outputLines] = detail.split("\n");
  const command = firstLine.startsWith("$ ") ? firstLine : `$ ${eventMessage(event)}`;
  const output = outputLines.join("\n").trimEnd();
  return { command, ...(output ? { output } : {}) };
}

function commandKey(event: AgentEventDto, command: string): string {
  return typeof event.data.correlationId === "string"
    ? `id:${event.data.correlationId}`
    : `command:${command}`;
}

function finishPendingCommands(
  pendingCommands: Map<string, CommandLine[]>,
  status: Extract<CommandLine["status"], "failed" | "interrupted" | "canceled">,
): void {
  for (const lines of pendingCommands.values()) {
    for (const line of lines) {
      if (line.status === "running") line.status = status;
    }
  }
  pendingCommands.clear();
}

function appendLine(
  group: ActivityGroup,
  event: AgentEventDto,
  pendingCommands: Map<string, CommandLine[]>,
): void {
  if (event.type === "AGENT_COMMAND_STARTED") {
    const content = commandContent(event);
    const line: CommandLine = {
      kind: "command",
      id: event.id,
      command: content.command,
      output: content.output,
      occurredAt: event.occurredAt,
      status: "running",
    };
    group.lines.push(line);
    const key = commandKey(event, content.command);
    const matching = pendingCommands.get(key) ?? [];
    matching.push(line);
    pendingCommands.set(key, matching);
    return;
  }

  if (event.type === "AGENT_COMMAND_COMPLETED" || event.type === "AGENT_COMMAND_FAILED") {
    const content = commandContent(event);
    const key = commandKey(event, content.command);
    const matching = pendingCommands.get(key);
    const pending = matching?.shift();
    if (matching?.length === 0) pendingCommands.delete(key);
    const status = event.type === "AGENT_COMMAND_FAILED" ? "failed" : "completed";
    if (pending) {
      pending.status = status;
      pending.occurredAt = event.occurredAt;
      pending.output = content.output;
    } else {
      group.lines.push({
        kind: "command",
        id: event.id,
        command: content.command,
        output: content.output,
        occurredAt: event.occurredAt,
        status,
      });
    }
    return;
  }

  group.lines.push({
    kind: "event",
    event,
    message: eventMessage(event),
    ...(typeof event.data.detail === "string" ? { detail: event.data.detail } : {}),
  });
}

function groupEvents(events: AgentEventDto[], active: boolean): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  let activeTurn: ActivityGroup | undefined;
  let activePending = new Map<string, CommandLine[]>();
  let looseGroup: ActivityGroup | undefined;
  let loosePending = new Map<string, CommandLine[]>();

  for (const event of events) {
    if (event.type === "AGENT_TURN_STARTED") {
      if (activeTurn?.status === "running") {
        activeTurn.status = "interrupted";
        activeTurn.finishedAt = event.occurredAt;
        finishPendingCommands(activePending, "interrupted");
      }
      activeTurn = {
        id: event.id,
        label: eventMessage(event),
        lines: [],
        occurredAt: event.occurredAt,
        status: "running",
        turn: true,
      };
      activePending = new Map();
      groups.push(activeTurn);
      looseGroup = undefined;
      continue;
    }

    if (event.type === "AGENT_TURN_COMPLETED" && activeTurn) {
      activeTurn.finishedAt = event.occurredAt;
      finishPendingCommands(activePending, "interrupted");
      if (activeTurn.status !== "error") activeTurn.status = "completed";
      activeTurn = undefined;
      activePending = new Map();
      looseGroup = undefined;
      continue;
    }

    if (activeTurn) {
      appendLine(activeTurn, event, activePending);
      const closesTurn = event.type === "AGENT_ERROR" || event.type === "ISSUE_CANCELED" || event.type === "RUNTIME_INTERRUPTED";
      if (event.data.level === "error" || event.type === "AGENT_COMMAND_FAILED" || event.type === "AGENT_ERROR") {
        activeTurn.status = "error";
      } else if (event.type === "ISSUE_CANCELED") {
        activeTurn.status = "canceled";
      } else if (event.type === "RUNTIME_INTERRUPTED") {
        activeTurn.status = "interrupted";
      }
      if (closesTurn) {
        finishPendingCommands(
          activePending,
          event.type === "ISSUE_CANCELED" ? "canceled" : event.type === "AGENT_ERROR" ? "failed" : "interrupted",
        );
        activeTurn.finishedAt = event.occurredAt;
        activeTurn = undefined;
        activePending = new Map();
        looseGroup = undefined;
      }
      continue;
    }

    if (!looseGroup) {
      looseGroup = {
        id: event.id,
        label: "活动记录",
        lines: [],
        occurredAt: event.occurredAt,
        status: event.data.level === "error" ? "error" : "idle",
        turn: false,
      };
      loosePending = new Map();
      groups.push(looseGroup);
    }
    appendLine(looseGroup, event, loosePending);
    if (event.data.level === "error" || event.type === "AGENT_COMMAND_FAILED") looseGroup.status = "error";
    const closesLooseGroup = event.type === "AGENT_ERROR"
      || event.type === "ISSUE_CANCELED"
      || event.type === "RUNTIME_INTERRUPTED"
      || event.type === "AGENT_TURN_COMPLETED";
    if (closesLooseGroup) {
      if (event.type === "ISSUE_CANCELED") {
        looseGroup.status = "canceled";
        finishPendingCommands(loosePending, "canceled");
      } else if (event.type === "AGENT_ERROR") {
        looseGroup.status = "error";
        finishPendingCommands(loosePending, "failed");
      } else {
        if (event.type === "RUNTIME_INTERRUPTED") looseGroup.status = "interrupted";
        else if (looseGroup.status !== "error") looseGroup.status = "completed";
        finishPendingCommands(loosePending, "interrupted");
      }
      looseGroup.finishedAt = event.occurredAt;
      looseGroup = undefined;
      loosePending = new Map();
    }
  }

  if (activeTurn?.status === "running" && !active) {
    activeTurn.status = "interrupted";
    finishPendingCommands(activePending, "interrupted");
  }
  if (!active) finishPendingCommands(loosePending, "interrupted");
  return groups;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function groupStatus(group: ActivityGroup): string {
  if (group.status === "running") return "进行中";
  if (group.status === "completed") return "已完成";
  if (group.status === "error") return "有错误";
  if (group.status === "interrupted") return "已中断";
  if (group.status === "canceled") return "已取消";
  return `${group.lines.length} 条`;
}

function CommandLogLine({ line }: { line: CommandLine }) {
  const status = line.status === "running"
    ? "运行中"
    : line.status === "failed"
      ? "失败"
      : line.status === "interrupted"
        ? "已中断"
        : line.status === "canceled"
          ? "已取消"
          : "完成";
  return <div className={`activity-log-entry activity-log-command activity-log-${line.status}`}>
    <div className="activity-log-entry-heading">
      <span aria-hidden="true" className="activity-terminal-prompt">›</span>
      <code title={line.command}>{line.command}</code>
      <span className="activity-command-status">{status}</span>
      <time>{formatTime(line.occurredAt)}</time>
    </div>
    {line.output ? <pre aria-label={`命令输出：${line.command}`} className="activity-log-output" tabIndex={0}>{line.output}</pre> : null}
  </div>;
}

function EventLogLine({ line }: { line: EventLine }) {
  const level = line.event.data.level === "error" ? "error" : "info";
  const Icon = level === "error"
    ? CircleAlert
    : line.event.type.includes("FILES")
      ? FilePenLine
      : line.event.type.endsWith("COMPLETED") || line.event.type.endsWith("READY")
        ? CircleCheck
        : Activity;
  return <div className={`activity-log-entry activity-log-event${level === "error" ? " activity-log-error" : ""}`}>
    <div className="activity-log-entry-heading">
      <Icon aria-hidden="true" size={12} />
      <span className="activity-log-actor">{actorLabels[line.event.actor]}</span>
      <p>{line.message}</p>
      <time>{formatTime(line.event.occurredAt)}</time>
    </div>
    {line.detail ? <pre aria-label={`${line.message}详情`} className="activity-log-output" tabIndex={0}>{line.detail}</pre> : null}
  </div>;
}

export function AgentActivity({ events, active }: { events: AgentEventDto[]; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const latestEvent = events.at(-1);
  const issueId = latestEvent?.issueId;
  const [pagination, setPagination] = useState({ count: activityPageSize, issueId });
  const visibleEventCount = pagination.issueId === issueId ? pagination.count : activityPageSize;
  const latestMessage = latestEvent ? eventMessage(latestEvent) : "Agent 正在工作";
  const latestIsCommand = latestEvent?.type === "AGENT_COMMAND_STARTED" || latestEvent?.type === "AGENT_COMMAND_COMPLETED";
  const currentSummary = active && latestIsCommand ? "Codex 正在工作" : latestMessage;
  const currentClass = active
    ? latestEvent?.data.level === "error"
      ? "activity-current activity-current-error"
      : "activity-active activity-current"
    : "activity-current";
  const visibleEvents = expanded ? events.slice(-visibleEventCount) : [];
  const groups = expanded ? groupEvents(visibleEvents, active) : [];
  const hiddenEventCount = Math.max(0, events.length - visibleEvents.length);

  return <section className="agent-activity">
    <Button aria-expanded={expanded} aria-label="Agent 活动" className="h-auto w-full justify-between" type="button" variant="ghost" onClick={() => setExpanded((value) => !value)}>
      <span><Activity size={14} />Agent 活动</span>
      <span aria-live="polite" className={currentClass} title={active ? currentSummary : undefined}>{active ? currentSummary : `${events.length} 条事件`}</span>
      <ChevronDown className={expanded ? "activity-chevron-open" : ""} size={14} />
    </Button>
    {expanded ? <div aria-label="Agent 连续活动日志" aria-live="off" className="activity-terminal" role="log">
      {hiddenEventCount ? <Button className="activity-history-more" type="button" variant="ghost" onClick={() => setPagination({
        count: Math.min(events.length, visibleEventCount + activityPageSize),
        issueId,
      })}>
        加载更早活动（剩余 {hiddenEventCount} 条）
      </Button> : null}
      {groups.length ? groups.map((group) => <section aria-label={group.label} className={`activity-turn activity-turn-${group.status}`} key={group.id} role="group">
        <header className="activity-turn-header">
          <span className="activity-turn-title">{group.turn ? <Terminal aria-hidden="true" size={13} /> : <Clock3 aria-hidden="true" size={13} />}<span>{group.label}</span></span>
          <span className="activity-turn-meta"><time>{formatTime(group.occurredAt)}{group.finishedAt ? `–${formatTime(group.finishedAt)}` : ""}</time><span>{groupStatus(group)}</span></span>
        </header>
        <div className="activity-turn-body">
          {group.lines.length ? group.lines.map((line) => line.kind === "command"
            ? <CommandLogLine key={line.id} line={line} />
            : <EventLogLine key={line.event.id} line={line} />)
            : <p className="activity-turn-empty">等待活动…</p>}
        </div>
      </section>) : <p className="activity-empty">Agent 尚未产生事件。</p>}
    </div> : null}
  </section>;
}
