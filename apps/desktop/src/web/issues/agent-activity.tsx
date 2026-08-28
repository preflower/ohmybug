import { Activity, ChevronDown, CircleAlert, CircleCheck, Clock3, FilePenLine, MessageSquareText, Terminal } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { AgentEventDto } from "../api/types.js";
import { Button } from "../components/ui/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip.js";
import { hasExecutionEvents, useCurrentExecutionEvents } from "./terminal-execution.js";

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
  BASE_INTEGRATION_STALE: "基线已更新，正在重新集成并验证",
  DELIVERY_FINALIZATION_RECOVERY_STARTED: "交付失败，已启动 AI 自动恢复",
  DELIVERY_FINALIZATION_RECOVERY_COMPLETED: "AI 交付恢复已完成",
  DELIVERY_FINALIZATION_RECOVERY_FAILED: "AI 交付恢复未能安全完成",
  DELIVERY_FINALIZATION_MERGE_PREPARED: "已准备合并冲突供 AI 解析",
  DELIVERY_FINALIZATION_MERGE_RESOLVED: "AI 已解析合并冲突，等待重新验证",
  DELIVERY_FINALIZATION_REVALIDATION_REQUIRED: "交付内容发生变化，需要重新验证",
  DELIVERY_FINALIZATION_AUTO_RETRIED: "交付阻塞已解除，正在自动重试",
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
  ISSUE_PAUSED: "Issue 已暂停",
  ISSUE_PAUSE_READY: "暂停已安全完成",
  ISSUE_RESUMED: "Issue 已继续执行",
  AGENT_PAUSE_FAILED: "Agent 暂停请求未正常结束",
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
    if (event.data.operation === "RECOVER_FINALIZATION") return "Runtime 已重启，正在恢复交付修复";
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

  if (event.type === "AGENT_COMMAND_OUTPUT") {
    const correlationId = typeof event.data.correlationId === "string"
      ? event.data.correlationId
      : undefined;
    const detail = typeof event.data.detail === "string" ? event.data.detail : "";
    const pending = correlationId
      ? pendingCommands.get(`id:${correlationId}`)?.at(-1)
      : undefined;
    if (pending && detail) {
      pending.output = `${pending.output ?? ""}${detail}`;
      pending.occurredAt = event.occurredAt;
      return;
    }
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
      if (pending.output === undefined && content.output !== undefined) pending.output = content.output;
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
      const closesTurn = event.type === "AGENT_ERROR"
        || event.type === "ISSUE_CANCELED"
        || event.type === "ISSUE_PAUSED"
        || event.type === "RUNTIME_INTERRUPTED";
      if (event.data.level === "error" || event.type === "AGENT_COMMAND_FAILED" || event.type === "AGENT_ERROR") {
        activeTurn.status = "error";
      } else if (event.type === "ISSUE_CANCELED") {
        activeTurn.status = "canceled";
      } else if (event.type === "RUNTIME_INTERRUPTED" || event.type === "ISSUE_PAUSED") {
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
      || event.type === "ISSUE_PAUSED"
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
        if (event.type === "RUNTIME_INTERRUPTED" || event.type === "ISSUE_PAUSED") looseGroup.status = "interrupted";
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
  const [detailExpanded, setDetailExpanded] = useState(false);
  const level = line.event.data.level === "error" ? "error" : "info";
  const status = line.event.type === "AGENT_STATUS";
  const message = line.event.type === "AGENT_MESSAGE";
  const reassessmentDetail = line.event.type === "REASSESSMENT_REQUESTED" && line.detail;
  const detailId = `activity-detail-${line.event.id}`;
  const Icon = level === "error"
    ? CircleAlert
    : message
      ? MessageSquareText
    : line.event.type.includes("FILES")
      ? FilePenLine
      : line.event.type.endsWith("COMPLETED") || line.event.type.endsWith("READY")
        ? CircleCheck
        : Activity;
  return <div className={`activity-log-entry activity-log-event${status ? " activity-log-status" : ""}${message ? " activity-log-message" : ""}${level === "error" ? " activity-log-error" : ""}`}>
    <div className="activity-log-entry-heading">
      <Icon aria-hidden="true" size={12} />
      <span className="activity-log-actor">{actorLabels[line.event.actor]}</span>
      <p>{line.message}</p>
      <time>{formatTime(line.event.occurredAt)}</time>
      {reassessmentDetail ? <Tooltip>
        <TooltipTrigger render={<Button
          aria-controls={detailId}
          aria-expanded={detailExpanded}
          aria-label={detailExpanded ? "收起重新分析说明" : "查看重新分析说明"}
          className="activity-detail-toggle"
          size="icon-xs"
          type="button"
          variant="ghost"
          onClick={() => setDetailExpanded((value) => !value)}
        >
          <ChevronDown aria-hidden="true" size={12} />
        </Button>} />
        <TooltipContent side="left">{detailExpanded ? "收起重新分析说明" : "查看重新分析说明"}</TooltipContent>
      </Tooltip> : null}
    </div>
    {reassessmentDetail
      ? detailExpanded ? <pre aria-label={`${line.message}详情`} className="activity-log-output" id={detailId} tabIndex={0}>{line.detail}</pre> : null
      : line.detail ? <pre aria-label={`${line.message}详情`} className="activity-log-output" tabIndex={0}>{line.detail}</pre> : null}
  </div>;
}

function ActivityLogLine({ line }: { line: ActivityLine }) {
  return line.kind === "command"
    ? <CommandLogLine line={line} />
    : <EventLogLine line={line} />;
}

function FlatActivityLines({ group }: { group: ActivityGroup }) {
  return <div className="activity-flat-lines">
    {group.lines.map((line) => <ActivityLogLine
      key={line.kind === "command" ? line.id : line.event.id}
      line={line}
    />)}
  </div>;
}

function ActivityTurn({
  expanded,
  group,
  onToggle,
}: {
  expanded: boolean;
  group: ActivityGroup;
  onToggle: () => void;
}) {
  const bodyId = `activity-turn-body-${group.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return <section aria-label={group.label} className={`activity-turn activity-turn-${group.status}`} role="group">
    <Button
      aria-controls={bodyId}
      aria-expanded={expanded}
      aria-label={group.label}
      className="activity-turn-toggle"
      type="button"
      variant="ghost"
      onClick={onToggle}
    >
      <span className="activity-turn-title">
        {group.turn ? <Terminal aria-hidden="true" size={13} /> : <Clock3 aria-hidden="true" size={13} />}
        <span>{group.label}</span>
      </span>
      <span className="activity-turn-meta">
        <time>{formatTime(group.occurredAt)}{group.finishedAt ? `–${formatTime(group.finishedAt)}` : ""}</time>
        <span>{groupStatus(group)}</span>
      </span>
      <ChevronDown aria-hidden="true" className={expanded ? "activity-chevron-open" : ""} size={14} />
    </Button>
    {expanded ? <div
      aria-label={`${group.label} Terminal`}
      aria-live="off"
      className="activity-terminal activity-turn-body"
      id={bodyId}
      role="log"
    >
      {group.lines.length ? group.lines.map((line) => <ActivityLogLine
        key={line.kind === "command" ? line.id : line.event.id}
        line={line}
      />)
        : <p className="activity-turn-empty">等待活动…</p>}
    </div> : null}
  </section>;
}

export function CodexTerminal({
  active,
  events,
  sessionId,
  terminalAction,
}: {
  active: boolean;
  events: AgentEventDto[];
  sessionId?: string;
  terminalAction?: ReactNode;
}) {
  const issueId = events.at(-1)?.issueId;
  const visibleEvents = useCurrentExecutionEvents(events, issueId, sessionId);
  const terminalKey = `${issueId ?? ""}\0${sessionId ?? ""}`;
  const logRef = useRef<HTMLDivElement>(null);
  const [followState, setFollowState] = useState({ key: terminalKey, following: true });
  const followingLatest = followState.key === terminalKey ? followState.following : true;
  const visible = hasExecutionEvents(visibleEvents, active);
  const lines = visible ? groupEvents(visibleEvents, active).flatMap((group) => group.lines) : [];

  useEffect(() => {
    const log = logRef.current;
    if (!log || !followingLatest) return;
    log.scrollTop = log.scrollHeight;
  }, [followingLatest, visibleEvents.length]);

  if (!visible) return null;

  const returnToLatest = () => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
    setFollowState({ key: terminalKey, following: true });
  };

  return <section aria-label="Codex Terminal" className="codex-terminal">
    <header className="codex-terminal-header">
      <span>Codex Terminal</span>
      {terminalAction}
    </header>
    <div
      aria-label="Codex Terminal 输出"
      aria-live="off"
      className="codex-terminal-log"
      onScroll={(event) => {
        const log = event.currentTarget;
        setFollowState({
          key: terminalKey,
          following: log.scrollHeight - log.scrollTop - log.clientHeight <= 8,
        });
      }}
      ref={logRef}
      role="log"
      tabIndex={0}
    >
      {lines.length ? lines.map((line) => <ActivityLogLine
        key={line.kind === "command" ? line.id : line.event.id}
        line={line}
      />) : <p className="codex-terminal-empty">等待 Codex 输出…</p>}
    </div>
    {!followingLatest ? <Button className="codex-terminal-latest" size="xs" type="button" variant="secondary" onClick={returnToLatest}>回到最新</Button> : null}
  </section>;
}

export function AgentActivity({ events, active }: { events: AgentEventDto[]; active: boolean }) {
  const latestEvent = events.at(-1);
  const issueId = latestEvent?.issueId;
  const [expandedGroups, setExpandedGroups] = useState<{ issueId?: string; ids: Set<string> }>({
    issueId,
    ids: new Set(),
  });
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
  const expandedGroupIds = expandedGroups.issueId === issueId ? expandedGroups.ids : new Set<string>();
  const visibleEvents = events.slice(-visibleEventCount);
  const groups = groupEvents(visibleEvents, active);
  const hiddenEventCount = Math.max(0, events.length - visibleEvents.length);
  const toggleGroup = (groupId: string) => setExpandedGroups((current) => {
    const ids = current.issueId === issueId ? new Set(current.ids) : new Set<string>();
    if (ids.has(groupId)) ids.delete(groupId);
    else ids.add(groupId);
    return { issueId, ids };
  });

  return <section className="agent-activity">
    <header className="agent-activity-header">
      <span><Activity aria-hidden="true" size={14} />Agent 活动</span>
      <span aria-live="polite" className={currentClass} title={active ? currentSummary : undefined}>{active ? currentSummary : `${events.length} 条事件`}</span>
    </header>
    <div className="activity-groups">
      {hiddenEventCount ? <Button className="activity-history-more" type="button" variant="ghost" onClick={() => setPagination({
        count: Math.min(events.length, visibleEventCount + activityPageSize),
        issueId,
      })}>
        加载更早活动（剩余 {hiddenEventCount} 条）
      </Button> : null}
      {groups.length ? groups.map((group) => group.turn
        ? <ActivityTurn
            expanded={expandedGroupIds.has(group.id)}
            group={group}
            key={group.id}
            onToggle={() => toggleGroup(group.id)}
          />
        : <FlatActivityLines group={group} key={group.id} />)
        : <p className="activity-empty">Agent 尚未产生事件。</p>}
    </div>
  </section>;
}
