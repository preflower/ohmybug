// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AgentEventDto } from "../../src/web/api/types.js";
import { AgentActivity, CodexTerminal } from "../../src/web/issues/agent-activity.js";

function openActivity(label: string | RegExp): HTMLElement {
  const toggle = screen.getByRole("button", { name: label });
  fireEvent.click(toggle);
  return toggle;
}

describe("Agent activity", () => {
  it("renders CLI-equivalent statuses, messages, and correlated live command output", () => {
    const streamedOutput = "x".repeat(2_100);
    render(<CodexTerminal active events={[
      { id: "issue-1:1", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { logicalSessionId: "session-1", message: "Codex 开始实现" } },
      { id: "issue-1:2", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "AGENT_STATUS", occurredAt: "2026-08-24T09:00:01Z", data: { logicalSessionId: "session-1", message: "Started" } },
      { id: "issue-1:3", issueId: "issue-1", sequence: 3, actor: "AGENT", type: "AGENT_STATUS", occurredAt: "2026-08-24T09:00:02Z", data: { logicalSessionId: "session-1", message: "Working" } },
      { id: "issue-1:4", issueId: "issue-1", sequence: 4, actor: "AGENT", type: "AGENT_MESSAGE", occurredAt: "2026-08-24T09:00:03Z", data: { logicalSessionId: "session-1", message: "I’ll inspect the checkout path first." } },
      { id: "issue-1:5", issueId: "issue-1", sequence: 5, actor: "AGENT", type: "AGENT_STATUS", occurredAt: "2026-08-24T09:00:04Z", data: { logicalSessionId: "session-1", message: "Explored", detail: "Search checkout in src" } },
      { id: "issue-1:6", issueId: "issue-1", sequence: 6, actor: "AGENT", type: "AGENT_COMMAND_STARTED", occurredAt: "2026-08-24T09:00:05Z", data: { logicalSessionId: "session-1", correlationId: "command-1", message: "正在执行项目命令", detail: "$ pnpm test" } },
      { id: "issue-1:7", issueId: "issue-1", sequence: 7, actor: "AGENT", type: "AGENT_COMMAND_OUTPUT", occurredAt: "2026-08-24T09:00:06Z", data: { logicalSessionId: "session-1", correlationId: "command-1", message: "命令输出", detail: streamedOutput.slice(0, 1_050) } },
      { id: "issue-1:8", issueId: "issue-1", sequence: 8, actor: "AGENT", type: "AGENT_COMMAND_OUTPUT", occurredAt: "2026-08-24T09:00:07Z", data: { logicalSessionId: "session-1", correlationId: "command-1", message: "命令输出", detail: streamedOutput.slice(1_050) } },
      { id: "issue-1:9", issueId: "issue-1", sequence: 9, actor: "AGENT", type: "AGENT_STATUS", occurredAt: "2026-08-24T09:00:08Z", data: { logicalSessionId: "session-1", message: "Waiting", detail: "等待子 Agent" } },
      { id: "issue-1:10", issueId: "issue-1", sequence: 10, actor: "AGENT", type: "AGENT_COMMAND_COMPLETED", occurredAt: "2026-08-24T09:00:09Z", data: { logicalSessionId: "session-1", correlationId: "command-1", message: "项目命令执行完成", detail: `$ pnpm test\n${"x".repeat(1_997)}...` } },
    ]} sessionId="session-1" />);

    const terminal = screen.getByRole("region", { name: "Codex Terminal" });
    for (const status of ["Started", "Working", "Explored", "Waiting"]) {
      expect(within(terminal).getByText(status).closest(".activity-log-status")).not.toBeNull();
    }
    expect(within(terminal).getByText("I’ll inspect the checkout path first.").closest(".activity-log-message"))
      .not.toBeNull();
    expect(within(terminal).getByText("Search checkout in src")).toBeVisible();
    expect(within(terminal).getByText("等待子 Agent")).toBeVisible();
    expect(within(terminal).queryByText("命令输出")).not.toBeInTheDocument();
    expect(within(terminal).getByLabelText("命令输出：$ pnpm test")).toHaveTextContent(streamedOutput);
  });

  it("shows a read-only Codex Terminal only after current execution output arrives", () => {
    const events: AgentEventDto[] = [
      { id: "issue-1:1", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "Codex 开始实现" } },
      { id: "issue-1:2", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "AGENT_COMMAND_STARTED", occurredAt: "2026-08-24T09:00:01Z", data: { message: "正在执行项目命令", detail: "$ pnpm test" } },
      { id: "issue-1:3", issueId: "issue-1", sequence: 3, actor: "AGENT", type: "AGENT_COMMAND_COMPLETED", occurredAt: "2026-08-24T09:00:02Z", data: { message: "项目命令执行完成", detail: "$ pnpm test\n12 passed" } },
    ];
    const view = render(<CodexTerminal
      active
      events={[]}
      sessionId="session-1"
      terminalAction={<button type="button">在 Terminal 中打开</button>}
    />);

    expect(screen.queryByRole("region", { name: "Codex Terminal" })).not.toBeInTheDocument();

    view.rerender(<CodexTerminal
      active
      events={events}
      sessionId="session-1"
      terminalAction={<button type="button">在 Terminal 中打开</button>}
    />);

    const terminal = screen.getByRole("region", { name: "Codex Terminal" });
    expect(within(terminal).getByRole("button", { name: "在 Terminal 中打开" })).toBeVisible();
    expect(within(terminal).getByText("$ pnpm test")).toBeVisible();
    expect(within(terminal).getByText("12 passed")).toBeVisible();
    expect(within(terminal).queryByRole("textbox")).not.toBeInTheDocument();

    view.rerender(<CodexTerminal active={false} events={events} sessionId="session-1" />);
    expect(screen.queryByRole("region", { name: "Codex Terminal" })).not.toBeInTheDocument();
  });

  it("drops previous-session output after the Agent session is rebuilt", () => {
    render(<CodexTerminal active events={[
      { id: "issue-1:old-turn", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "旧会话开始实现" } },
      { id: "issue-1:old-message", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { message: "旧会话输出" } },
      { id: "issue-1:rebuilt", issueId: "issue-1", sequence: 3, actor: "SYSTEM", type: "AGENT_SESSION_REBUILT", occurredAt: "2026-08-24T09:01:00Z", data: { oldLogicalSessionId: "session-1", newLogicalSessionId: "session-2" } },
      { id: "issue-1:new-turn", issueId: "issue-1", sequence: 4, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:01:01Z", data: { message: "新会话开始实现" } },
      { id: "issue-1:new-message", issueId: "issue-1", sequence: 5, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-24T09:01:02Z", data: { message: "新会话输出" } },
    ]} sessionId="session-2" />);

    const terminal = screen.getByRole("region", { name: "Codex Terminal" });
    expect(within(terminal).getByText("新会话输出")).toBeVisible();
    expect(within(terminal).queryByText("旧会话输出")).not.toBeInTheDocument();
  });

  it("keeps workflow transitions out of the execution terminal", () => {
    render(<CodexTerminal active events={[
      { id: "issue-1:created", issueId: "issue-1", sequence: 1, actor: "SYSTEM", type: "ISSUE_CREATED", occurredAt: "2026-08-24T09:00:00Z", data: {} },
      { id: "issue-1:ready", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "IMPLEMENTATION_READY", occurredAt: "2026-08-24T09:00:01Z", data: {} },
      { id: "issue-1:turn", issueId: "issue-1", sequence: 3, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:02Z", data: { message: "Codex 开始实现" } },
      { id: "issue-1:message", issueId: "issue-1", sequence: 4, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-24T09:00:03Z", data: { message: "正在修改详情布局" } },
    ]} sessionId="session-1" />);

    const terminal = screen.getByRole("region", { name: "Codex Terminal" });
    expect(within(terminal).getByText("正在修改详情布局")).toBeVisible();
    expect(within(terminal).queryByText("Issue 已创建")).not.toBeInTheDocument();
    expect(within(terminal).queryByText("实现完成，准备采集证据")).not.toBeInTheDocument();
  });

  it("removes the terminal at the completed execution boundary even before status refresh", () => {
    const running: AgentEventDto[] = [
      { id: "issue-1:turn", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "Codex 开始实现" } },
      { id: "issue-1:message", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { message: "正在修改详情布局" } },
    ];
    const view = render(<CodexTerminal active events={running} sessionId="session-1" />);
    expect(screen.getByRole("region", { name: "Codex Terminal" })).toBeVisible();

    view.rerender(<CodexTerminal active events={[...running, {
      id: "issue-1:completed",
      issueId: "issue-1",
      sequence: 3,
      actor: "AGENT",
      type: "AGENT_TURN_COMPLETED",
      occurredAt: "2026-08-24T09:00:02Z",
      data: { message: "Codex 已完成实现" },
    }]} sessionId="session-1" />);

    expect(screen.queryByRole("region", { name: "Codex Terminal" })).not.toBeInTheDocument();
  });

  it("honors an untagged pause boundary after tagged current-session output", () => {
    render(<CodexTerminal active events={[
      { id: "issue-1:turn", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { logicalSessionId: "session-1", message: "Codex 开始实现" } },
      { id: "issue-1:message", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { logicalSessionId: "session-1", message: "正在修改详情布局" } },
      { id: "issue-1:paused", issueId: "issue-1", sequence: 3, actor: "USER", type: "ISSUE_PAUSED", occurredAt: "2026-08-24T09:00:02Z", data: {} },
    ]} sessionId="session-1" />);

    expect(screen.queryByRole("region", { name: "Codex Terminal" })).not.toBeInTheDocument();
  });

  it.each(["AGENT_TURN_COMPLETED", "AGENT_ERROR"] as const)(
    "does not reopen the terminal for cleanup diagnostics after %s",
    (boundaryType) => {
      render(<CodexTerminal active events={[
        { id: "issue-1:turn", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { logicalSessionId: "session-1", message: "Codex 开始实现" } },
        { id: "issue-1:message", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { logicalSessionId: "session-1", message: "正在修改详情布局" } },
        { id: "issue-1:boundary", issueId: "issue-1", sequence: 3, actor: "AGENT", type: boundaryType, occurredAt: "2026-08-24T09:00:02Z", data: { logicalSessionId: "session-1", message: "Codex 已结束本轮" } },
        { id: "issue-1:cleanup", issueId: "issue-1", sequence: 4, actor: "AGENT", type: "AGENT_TEMP_CLEANUP_FAILED", occurredAt: "2026-08-24T09:00:03Z", data: { logicalSessionId: "session-1", message: "临时目录清理失败" } },
      ]} sessionId="session-1" />);

      expect(screen.queryByRole("region", { name: "Codex Terminal" })).not.toBeInTheDocument();
    },
  );

  it("waits for output tagged to a replacement session before showing the terminal", () => {
    const oldEvents: AgentEventDto[] = [
      { id: "issue-1:old-turn", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { logicalSessionId: "session-1", message: "旧会话开始实现" } },
      { id: "issue-1:old-message", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { logicalSessionId: "session-1", message: "旧会话输出" } },
    ];
    const view = render(<CodexTerminal active events={oldEvents} sessionId="session-2" />);
    expect(screen.queryByRole("region", { name: "Codex Terminal" })).not.toBeInTheDocument();

    view.rerender(<CodexTerminal active events={[...oldEvents,
      { id: "issue-1:new-turn", issueId: "issue-1", sequence: 3, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:01:00Z", data: { logicalSessionId: "session-2", message: "新会话开始实现" } },
      { id: "issue-1:new-message", issueId: "issue-1", sequence: 4, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-24T09:01:01Z", data: { logicalSessionId: "session-2", message: "新会话输出" } },
    ]} sessionId="session-2" />);

    const terminal = screen.getByRole("region", { name: "Codex Terminal" });
    expect(within(terminal).getByText("新会话输出")).toBeVisible();
    expect(within(terminal).queryByText("旧会话输出")).not.toBeInTheDocument();
  });

  it("suppresses legacy output while a replacement session has no attributable events", () => {
    const legacyEvents: AgentEventDto[] = [
      { id: "issue-1:old-turn", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "旧会话开始实现" } },
      { id: "issue-1:old-message", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { message: "旧会话输出" } },
    ];
    const view = render(<CodexTerminal active events={legacyEvents} sessionId="session-1" />);
    expect(screen.getByRole("region", { name: "Codex Terminal" })).toBeVisible();

    view.rerender(<CodexTerminal active events={legacyEvents} sessionId="session-2" />);
    expect(screen.queryByRole("region", { name: "Codex Terminal" })).not.toBeInTheDocument();

    view.rerender(<CodexTerminal active events={[...legacyEvents, {
      id: "issue-1:new-message",
      issueId: "issue-1",
      sequence: 3,
      actor: "AGENT",
      type: "MESSAGE",
      occurredAt: "2026-08-24T09:01:00Z",
      data: { logicalSessionId: "session-2", message: "新会话输出" },
    }]} sessionId="session-2" />);
    expect(screen.getByText("新会话输出")).toBeVisible();
    expect(screen.queryByText("旧会话输出")).not.toBeInTheDocument();
  });

  it("pauses follow-latest when scrolled up and resumes on request", () => {
    render(<CodexTerminal active events={[
      { id: "issue-1:turn", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "Codex 开始实现" } },
      { id: "issue-1:message", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { message: "正在检查布局" } },
    ]} sessionId="session-1" />);

    const log = screen.getByRole("log", { name: "Codex Terminal 输出" });
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    fireEvent.scroll(log);

    const latest = screen.getByRole("button", { name: "回到最新" });
    fireEvent.click(latest);
    expect(log.scrollTop).toBe(400);
    expect(screen.queryByRole("button", { name: "回到最新" })).not.toBeInTheDocument();
  });

  it("renders non-turn events directly without an activity-record disclosure", () => {
    render(<AgentActivity active={false} events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "SYSTEM",
        type: "DELIVERY_FINALIZATION_MERGE_PREPARED",
        occurredAt: "2026-08-25T09:00:00Z",
        data: { conflictCount: 1 },
      },
      {
        id: "issue-1:2",
        issueId: "issue-1",
        sequence: 2,
        actor: "SYSTEM",
        type: "DELIVERY_FINALIZATION_MERGE_RESOLVED",
        occurredAt: "2026-08-25T09:00:01Z",
        data: { resolvedPathCount: 1 },
      },
    ]} />);

    expect(screen.queryByRole("button", { name: "活动记录" })).not.toBeInTheDocument();
    expect(screen.getByText("已准备合并冲突供 AI 解析")).toBeVisible();
    expect(screen.getByText("AI 已解析合并冲突，等待重新验证")).toBeVisible();
  });

  it("labels a non-fatal Agent temp cleanup failure in the activity log", () => {
    render(<AgentActivity active={false} events={[{
      id: "issue-1:1",
      issueId: "issue-1",
      sequence: 1,
      actor: "AGENT",
      type: "AGENT_TEMP_CLEANUP_FAILED",
      occurredAt: "2026-08-24T09:00:05Z",
      data: { detail: "ENOTEMPTY: directory not empty", level: "error" },
    }]} />);

    expect(screen.getByText("临时目录清理失败")).toBeVisible();
    expect(screen.getByText("ENOTEMPTY: directory not empty")).toBeVisible();
  });

  it("renders each Codex turn as a default-collapsed terminal disclosure", () => {
    render(<AgentActivity active={false} events={[
      { id: "issue-1:1", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "Codex 开始分析" } },
      { id: "issue-1:2", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "AGENT_COMMAND_STARTED", occurredAt: "2026-08-24T09:00:01Z", data: { message: "正在执行项目命令", detail: "$ pnpm test" } },
      { id: "issue-1:3", issueId: "issue-1", sequence: 3, actor: "AGENT", type: "AGENT_COMMAND_COMPLETED", occurredAt: "2026-08-24T09:00:02Z", data: { message: "项目命令执行完成", detail: "$ pnpm test\n12 passed" } },
      { id: "issue-1:4", issueId: "issue-1", sequence: 4, actor: "AGENT", type: "AGENT_TURN_COMPLETED", occurredAt: "2026-08-24T09:00:03Z", data: { message: "Codex 已完成分析" } },
    ]} />);

    expect(screen.getByText("Agent 活动")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Agent 活动" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Codex 开始分析" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("log", { name: "Codex 开始分析 Terminal" })).not.toBeInTheDocument();
    expect(screen.queryByText("$ pnpm test")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const terminal = screen.getByRole("log", { name: "Codex 开始分析 Terminal" });
    const output = screen.getByText("12 passed");
    expect(terminal).toBeVisible();
    expect(terminal).toHaveClass("activity-turn-body", "activity-terminal");
    expect(output).toHaveClass("activity-log-output");
    expect(output.parentElement).toBe(terminal.querySelector(".activity-log-command"));
    expect(screen.getAllByText("$ pnpm test")).toHaveLength(1);
    expect(output).toBeVisible();
  });

  it("expands Codex turns independently", () => {
    const turn = (prefix: string, sequence: number, message: string) => [
      { id: `issue-1:${prefix}-start`, issueId: "issue-1", sequence, actor: "AGENT" as const, type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message } },
      { id: `issue-1:${prefix}-message`, issueId: "issue-1", sequence: sequence + 1, actor: "AGENT" as const, type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { message: `${prefix} output` } },
      { id: `issue-1:${prefix}-end`, issueId: "issue-1", sequence: sequence + 2, actor: "AGENT" as const, type: "AGENT_TURN_COMPLETED", occurredAt: "2026-08-24T09:00:02Z", data: { message: `${message}完成` } },
    ];
    render(<AgentActivity active={false} events={[
      ...turn("analysis", 1, "Codex 开始分析"),
      ...turn("repair", 4, "Codex 开始实现"),
    ]} />);

    openActivity("Codex 开始分析");
    expect(screen.getByText("analysis output")).toBeVisible();
    expect(screen.queryByText("repair output")).not.toBeInTheDocument();

    openActivity("Codex 开始实现");
    expect(screen.getByText("analysis output")).toBeVisible();
    expect(screen.getByText("repair output")).toBeVisible();
  });

  it("does not leak expanded turns when switching Issues", () => {
    const events = (issueId: string) => [
      { id: `${issueId}:1`, issueId, sequence: 1, actor: "AGENT" as const, type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "Codex 开始分析" } },
      { id: `${issueId}:2`, issueId, sequence: 2, actor: "AGENT" as const, type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { message: `${issueId} output` } },
    ];
    const view = render(<AgentActivity active events={events("issue-1")} />);
    openActivity("Codex 开始分析");
    expect(screen.getByRole("log", { name: "Codex 开始分析 Terminal" })).toHaveTextContent("issue-1 output");

    view.rerender(<AgentActivity active events={events("issue-2")} />);

    expect(screen.getByRole("button", { name: "Codex 开始分析" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("log", { name: "Codex 开始分析 Terminal" })).not.toBeInTheDocument();
  });

  it("merges command lifecycle events into one continuous turn log", () => {
    render(<AgentActivity active={false} events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "AGENT",
        type: "AGENT_TURN_STARTED",
        occurredAt: "2026-08-24T09:00:00Z",
        data: { message: "Codex 开始实现", stage: "REPAIR" },
      },
      {
        id: "issue-1:2",
        issueId: "issue-1",
        sequence: 2,
        actor: "AGENT",
        type: "AGENT_COMMAND_STARTED",
        occurredAt: "2026-08-24T09:00:01Z",
        data: { message: "正在执行项目命令", detail: "$ pnpm test" },
      },
      {
        id: "issue-1:3",
        issueId: "issue-1",
        sequence: 3,
        actor: "AGENT",
        type: "AGENT_COMMAND_COMPLETED",
        occurredAt: "2026-08-24T09:00:03Z",
        data: { message: "项目命令执行完成", detail: "$ pnpm test\nTests 12 passed" },
      },
      {
        id: "issue-1:4",
        issueId: "issue-1",
        sequence: 4,
        actor: "AGENT",
        type: "AGENT_FILES_CHANGED",
        occurredAt: "2026-08-24T09:00:04Z",
        data: { message: "已更新 2 个文件", detail: "src/log.ts\ntest/log.test.ts" },
      },
      {
        id: "issue-1:5",
        issueId: "issue-1",
        sequence: 5,
        actor: "AGENT",
        type: "AGENT_TURN_COMPLETED",
        occurredAt: "2026-08-24T09:00:05Z",
        data: { message: "Codex 已完成实现", stage: "REPAIR" },
      },
    ]} />);

    openActivity("Codex 开始实现");

    expect(screen.getByRole("log", { name: "Codex 开始实现 Terminal" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Codex 开始实现" })).toBeVisible();
    expect(screen.getAllByText("$ pnpm test")).toHaveLength(1);
    expect(screen.getByText("Tests 12 passed")).toBeVisible();
    expect(screen.getByText(/src\/log\.ts\s+test\/log\.test\.ts/)).toBeVisible();
    expect(screen.getByText("完成")).toBeVisible();
    expect(screen.queryByText("正在执行项目命令")).not.toBeInTheDocument();
    expect(screen.queryByText("项目命令执行完成")).not.toBeInTheDocument();
    expect(screen.queryByText("查看详情")).not.toBeInTheDocument();
  });

  it("keeps an unfinished command as one running log entry", () => {
    render(<AgentActivity active events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "AGENT",
        type: "AGENT_TURN_STARTED",
        occurredAt: "2026-08-24T09:00:00Z",
        data: { message: "Codex 开始分析", stage: "ASSESSMENT" },
      },
      {
        id: "issue-1:2",
        issueId: "issue-1",
        sequence: 2,
        actor: "AGENT",
        type: "AGENT_COMMAND_STARTED",
        occurredAt: "2026-08-24T09:00:01Z",
        data: { message: "正在执行项目命令", detail: "$ rg AgentActivity" },
      },
    ]} />);

    openActivity("Codex 开始分析");

    expect(screen.getAllByText("$ rg AgentActivity")).toHaveLength(1);
    expect(screen.getByText("运行中")).toBeVisible();
    expect(screen.queryByText("正在执行项目命令")).not.toBeInTheDocument();
  });

  it("keeps a turn truthful when a failed command is followed by turn completion", () => {
    render(<AgentActivity active={false} events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "AGENT",
        type: "AGENT_TURN_STARTED",
        occurredAt: "2026-08-24T09:00:00Z",
        data: { message: "Codex 开始实现" },
      },
      {
        id: "issue-1:2",
        issueId: "issue-1",
        sequence: 2,
        actor: "AGENT",
        type: "AGENT_COMMAND_STARTED",
        occurredAt: "2026-08-24T09:00:01Z",
        data: { message: "正在执行项目命令", detail: "$ pnpm test" },
      },
      {
        id: "issue-1:3",
        issueId: "issue-1",
        sequence: 3,
        actor: "AGENT",
        type: "AGENT_COMMAND_FAILED",
        occurredAt: "2026-08-24T09:00:02Z",
        data: { message: "项目命令执行失败", detail: "$ pnpm test\nTests 1 failed", level: "error" },
      },
      {
        id: "issue-1:4",
        issueId: "issue-1",
        sequence: 4,
        actor: "AGENT",
        type: "AGENT_TURN_COMPLETED",
        occurredAt: "2026-08-24T09:00:03Z",
        data: { message: "Codex 已完成实现" },
      },
    ]} />);

    openActivity("Codex 开始实现");

    expect(screen.getByText("失败")).toBeVisible();
    expect(screen.getByText("有错误")).toBeVisible();
    expect(screen.getByText("Tests 1 failed")).toBeVisible();
  });

  it("closes an interrupted turn before a recovered turn starts", () => {
    render(<AgentActivity active events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "AGENT",
        type: "AGENT_TURN_STARTED",
        occurredAt: "2026-08-24T09:00:00Z",
        data: { message: "Codex 开始实现" },
      },
      {
        id: "issue-1:2",
        issueId: "issue-1",
        sequence: 2,
        actor: "AGENT",
        type: "AGENT_COMMAND_STARTED",
        occurredAt: "2026-08-24T09:00:01Z",
        data: { message: "正在执行项目命令", detail: "$ pnpm test" },
      },
      {
        id: "issue-1:3",
        issueId: "issue-1",
        sequence: 3,
        actor: "SYSTEM",
        type: "RUNTIME_INTERRUPTED",
        occurredAt: "2026-08-24T09:00:02Z",
        data: { operation: "REPAIR" },
      },
      {
        id: "issue-1:4",
        issueId: "issue-1",
        sequence: 4,
        actor: "AGENT",
        type: "AGENT_TURN_STARTED",
        occurredAt: "2026-08-24T09:00:03Z",
        data: { message: "Codex 开始实现" },
      },
    ]} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Codex 开始实现" })[0]!);

    expect(screen.getAllByText("已中断")).toHaveLength(2);
    expect(screen.getAllByText("进行中")).toHaveLength(1);
    expect(screen.queryByText("运行中")).not.toBeInTheDocument();
    expect(screen.getByText("Runtime 已重启，正在恢复实现")).toBeVisible();
  });

  it("marks an unfinished command canceled with its turn", () => {
    render(<AgentActivity active={false} events={[
      { id: "issue-1:1", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "Codex 开始实现" } },
      { id: "issue-1:2", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "AGENT_COMMAND_STARTED", occurredAt: "2026-08-24T09:00:01Z", data: { message: "正在执行项目命令", detail: "$ pnpm test" } },
      { id: "issue-1:3", issueId: "issue-1", sequence: 3, actor: "SYSTEM", type: "ISSUE_CANCELED", occurredAt: "2026-08-24T09:00:02Z", data: {} },
    ]} />);

    openActivity("Codex 开始实现");

    expect(screen.getAllByText("已取消")).toHaveLength(2);
    expect(screen.queryByText("运行中")).not.toBeInTheDocument();
  });

  it("marks a paused turn interrupted and records a later resume without a fake command", () => {
    render(<AgentActivity active={false} events={[
      { id: "issue-1:1", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "Codex 开始实现" } },
      { id: "issue-1:2", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "AGENT_COMMAND_STARTED", occurredAt: "2026-08-24T09:00:01Z", data: { message: "正在执行项目命令", detail: "$ pnpm test" } },
      { id: "issue-1:3", issueId: "issue-1", sequence: 3, actor: "USER", type: "ISSUE_PAUSED", occurredAt: "2026-08-24T09:00:02Z", data: {} },
      { id: "issue-1:4", issueId: "issue-1", sequence: 4, actor: "USER", type: "ISSUE_RESUMED", occurredAt: "2026-08-24T09:01:00Z", data: { operation: "REPAIR" } },
    ]} />);

    openActivity("Codex 开始实现");

    expect(screen.getByText("Issue 已暂停")).toBeVisible();
    expect(screen.getByText("Issue 已继续执行")).toBeVisible();
    expect(screen.getAllByText("已中断")).toHaveLength(2);
    expect(screen.queryByText("已取消")).not.toBeInTheDocument();
    expect(screen.getAllByText("$ pnpm test")).toHaveLength(1);
  });

  it("uses correlation IDs when identical commands finish out of order", () => {
    render(<AgentActivity active={false} events={[
      { id: "issue-1:1", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "Codex 开始实现" } },
      { id: "issue-1:2", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "AGENT_COMMAND_STARTED", occurredAt: "2026-08-24T09:00:01Z", data: { correlationId: "command-a", message: "正在执行项目命令", detail: "$ pnpm test" } },
      { id: "issue-1:3", issueId: "issue-1", sequence: 3, actor: "AGENT", type: "AGENT_COMMAND_STARTED", occurredAt: "2026-08-24T09:00:02Z", data: { correlationId: "command-b", message: "正在执行项目命令", detail: "$ pnpm test" } },
      { id: "issue-1:4", issueId: "issue-1", sequence: 4, actor: "AGENT", type: "AGENT_COMMAND_FAILED", occurredAt: "2026-08-24T09:00:03Z", data: { correlationId: "command-b", message: "项目命令执行失败", detail: "$ pnpm test\noutput B", level: "error" } },
      { id: "issue-1:5", issueId: "issue-1", sequence: 5, actor: "AGENT", type: "AGENT_COMMAND_COMPLETED", occurredAt: "2026-08-24T09:00:04Z", data: { correlationId: "command-a", message: "项目命令执行完成", detail: "$ pnpm test\noutput A" } },
      { id: "issue-1:6", issueId: "issue-1", sequence: 6, actor: "AGENT", type: "AGENT_TURN_COMPLETED", occurredAt: "2026-08-24T09:00:05Z", data: { message: "Codex 已完成实现" } },
    ]} />);

    openActivity("Codex 开始实现");

    expect(screen.getByText("output A").closest(".activity-log-command")).toHaveTextContent("完成");
    expect(screen.getByText("output B").closest(".activity-log-command")).toHaveTextContent("失败");
  });

  it("loads long activity history progressively", () => {
    const events = Array.from({ length: 90 }, (_, index) => ({
      id: `issue-1:${index + 1}`,
      issueId: "issue-1",
      sequence: index + 1,
      actor: "AGENT" as const,
      type: "MESSAGE",
      occurredAt: `2026-08-24T09:${String(index).padStart(2, "0")}:00Z`,
      data: { message: `活动 ${index + 1}` },
    }));
    render(<AgentActivity active={false} events={events} />);

    expect(screen.queryByText("活动 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /加载更早活动/ }));
    expect(screen.getByText("活动 1")).toBeVisible();
    expect(screen.getByText("活动 90")).toBeVisible();
  });

  it("keeps cancellation truthful when pagination starts inside a turn", () => {
    const earlierEvents = Array.from({ length: 12 }, (_, index) => ({
      id: `issue-1:${index + 1}`,
      issueId: "issue-1",
      sequence: index + 1,
      actor: "AGENT" as const,
      type: index === 0 ? "AGENT_TURN_STARTED" : "MESSAGE",
      occurredAt: "2026-08-24T09:00:00Z",
      data: { message: `较早活动 ${index + 1}` },
    }));
    const visibleEvents = [
      { id: "issue-1:13", issueId: "issue-1", sequence: 13, actor: "AGENT" as const, type: "AGENT_COMMAND_STARTED", occurredAt: "2026-08-24T09:00:01Z", data: { message: "正在执行项目命令", detail: "$ pnpm test" } },
      ...Array.from({ length: 78 }, (_, index) => ({ id: `issue-1:${index + 14}`, issueId: "issue-1", sequence: index + 14, actor: "AGENT" as const, type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { message: `当前活动 ${index + 1}` } })),
      { id: "issue-1:92", issueId: "issue-1", sequence: 92, actor: "SYSTEM" as const, type: "ISSUE_CANCELED", occurredAt: "2026-08-24T09:00:02Z", data: {} },
    ];
    render(<AgentActivity active={false} events={[...earlierEvents, ...visibleEvents]} />);

    expect(screen.getByText("已取消")).toBeVisible();
    expect(screen.getByText("任务已取消")).toBeVisible();
    expect(screen.queryByText("已中断")).not.toBeInTheDocument();
  });

  it("resets the activity page when switching issues", () => {
    const issueEvents = (issueId: string, count: number) => Array.from({ length: count }, (_, index) => ({
      id: `${issueId}:${index + 1}`,
      issueId,
      sequence: index + 1,
      actor: "AGENT" as const,
      type: "MESSAGE",
      occurredAt: "2026-08-24T09:00:00Z",
      data: { message: `${issueId} 活动 ${index + 1}` },
    }));
    const view = render(<AgentActivity active={false} events={issueEvents("issue-1", 170)} />);
    fireEvent.click(screen.getByRole("button", { name: /加载更早活动/ }));
    expect(screen.getByText("issue-1 活动 11")).toBeVisible();

    view.rerender(<AgentActivity active={false} events={issueEvents("issue-2", 170)} />);

    expect(screen.queryByText("issue-2 活动 11")).not.toBeInTheDocument();
    expect(screen.getByText("issue-2 活动 91")).toBeVisible();
  });

  it("keeps a command failure visible in the collapsed live summary", () => {
    render(<AgentActivity active events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "AGENT",
        type: "AGENT_COMMAND_FAILED",
        occurredAt: "2026-08-24T09:00:02Z",
        data: { message: "项目命令执行失败", detail: "$ pnpm test\nTests 1 failed", level: "error" },
      },
    ]} />);

    expect(screen.getByText("项目命令执行失败")).toBeVisible();
    expect(screen.queryByText("Codex 正在工作")).not.toBeInTheDocument();
  });

  it("keeps every persisted line of a multiline running command visible", () => {
    render(<AgentActivity active events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "AGENT",
        type: "AGENT_COMMAND_STARTED",
        occurredAt: "2026-08-24T09:00:01Z",
        data: { message: "正在执行项目命令", detail: "$ printf 'first\nsecond'" },
      },
    ]} />);

    expect(screen.getByText("second'")).toBeVisible();
    expect(screen.getByText("$ printf 'first")).toHaveAttribute("title", "$ printf 'first");
  });

  it("shows tool facts and logs without exposing hidden reasoning", () => {
    render(<AgentActivity active events={[
      { id: "issue-1:0", issueId: "issue-1", sequence: 0, actor: "SYSTEM", type: "ISSUE_CREATED", occurredAt: "2026-08-19T08:59:00Z", data: {} },
      { id: "issue-1:1", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-19T09:00:00Z", data: { message: "Tracing checkout" } },
      { id: "issue-1:2", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "COMMAND", occurredAt: "2026-08-19T09:01:00Z", data: { message: "pnpm test" } }
    ]} />);

    expect(screen.getAllByText("pnpm test")).toHaveLength(2);
    expect(screen.getByText("Agent 活动")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Agent 活动" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "活动记录" })).not.toBeInTheDocument();
    expect(screen.getByText("Issue 已创建")).toBeVisible();
    expect(screen.getByText("Oh My Bug ?!")).toBeVisible();
    expect(screen.queryByText("ISSUE_CREATED")).not.toBeInTheDocument();
    expect(screen.getByText("Tracing checkout")).toBeVisible();
    expect(screen.getAllByText("pnpm test")).toHaveLength(2);
  });

  it("expands and collapses reassessment feedback inside user activity", () => {
    render(<AgentActivity active events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "USER",
        type: "REASSESSMENT_REQUESTED",
        occurredAt: "2026-08-24T09:00:00Z",
        data: { detail: "请检查窄窗口下的活动记录" },
      },
    ]} />);

    expect(screen.queryByText("请检查窄窗口下的活动记录")).not.toBeInTheDocument();
    expect(screen.getAllByText("已要求重新分析")).toHaveLength(2);
    expect(screen.getByText("用户")).toBeVisible();
    const detailToggle = screen.getByRole("button", { name: "查看重新分析说明" });
    expect(detailToggle).toHaveAttribute("aria-expanded", "false");
    expect(detailToggle).toHaveAttribute("data-size", "icon-xs");
    expect(detailToggle).toHaveTextContent("");
    expect(detailToggle.closest(".activity-log-entry-heading")).not.toBeNull();
    expect(screen.queryByText("查看说明")).not.toBeInTheDocument();
    expect(screen.queryByText("请检查窄窗口下的活动记录")).not.toBeInTheDocument();

    fireEvent.click(detailToggle);
    expect(detailToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("收起说明")).not.toBeInTheDocument();
    expect(screen.getByText("请检查窄窗口下的活动记录")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "收起重新分析说明" }));
    expect(detailToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("请检查窄窗口下的活动记录")).not.toBeInTheDocument();
  });

  it("shows a concise failure with diagnostic output in the continuous log", () => {
    render(<AgentActivity active events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "AGENT",
        type: "AGENT_ERROR",
        occurredAt: "2026-08-22T03:33:48Z",
        data: {
          message: "Codex 网络连接中断",
          detail: "stream disconnected before completion: error sending request",
          level: "error",
        },
      },
    ]} />);

    expect(screen.getAllByText("Codex 网络连接中断")).toHaveLength(2);
    expect(screen.getByText("stream disconnected before completion: error sending request")).toBeVisible();
    expect(screen.queryByText("查看详情")).not.toBeInTheDocument();
  });

  it("presents Runtime interruption as recovery instead of failure", () => {
    render(<AgentActivity active events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "SYSTEM",
        type: "RUNTIME_INTERRUPTED",
        occurredAt: "2026-08-22T03:33:48Z",
        data: { operation: "ASSESS" },
      },
      {
        id: "issue-1:2",
        issueId: "issue-1",
        sequence: 2,
        actor: "SYSTEM",
        type: "RUNTIME_INTERRUPTED",
        occurredAt: "2026-08-22T03:34:48Z",
        data: { operation: "REPAIR" },
      },
    ]} />);

    expect(screen.getAllByText("Runtime 已重启，正在恢复实现")).toHaveLength(2);
    expect(screen.getByText("Runtime 已重启，正在恢复分析")).toBeVisible();
    expect(screen.queryByText("任务意外中断")).not.toBeInTheDocument();
  });

  it("explains that a newer baseline requires another verified Delivery", () => {
    render(<AgentActivity active events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "SYSTEM",
        type: "BASE_INTEGRATION_STALE",
        occurredAt: "2026-08-22T03:33:48Z",
        data: { currentBaseCommit: "b".repeat(40), iteration: 3 },
      },
    ]} />);

    expect(screen.getByTitle("基线已更新，正在重新集成并验证")).toBeVisible();
    const eventEntry = document.querySelector<HTMLElement>(".activity-log-event");
    expect(eventEntry).not.toBeNull();
    expect(within(eventEntry!).getByText("基线已更新，正在重新集成并验证")).toBeVisible();
    expect(screen.queryByText("状态已更新")).not.toBeInTheDocument();
  });

  it("describes the independent evidence lifecycle", () => {
    render(<AgentActivity active events={[
      {
        id: "issue-1:1",
        issueId: "issue-1",
        sequence: 1,
        actor: "AGENT",
        type: "IMPLEMENTATION_READY",
        occurredAt: "2026-08-22T03:33:48Z",
        data: {},
      },
      {
        id: "issue-1:2",
        issueId: "issue-1",
        sequence: 2,
        actor: "SYSTEM",
        type: "RUNTIME_INTERRUPTED",
        occurredAt: "2026-08-22T03:34:48Z",
        data: { operation: "CAPTURE_EVIDENCE" },
      },
    ]} />);

    expect(screen.getAllByText("Runtime 已重启，正在恢复证据采集")).toHaveLength(2);
    expect(screen.getByText("实现完成，准备采集证据")).toBeVisible();
  });
});
