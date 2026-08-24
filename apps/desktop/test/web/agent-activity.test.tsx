// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentActivity } from "../../src/web/issues/agent-activity.js";

describe("Agent activity", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));

    expect(screen.getByText("临时目录清理失败")).toBeVisible();
    expect(screen.getByText("ENOTEMPTY: directory not empty")).toBeVisible();
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

    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));

    expect(screen.getByRole("log", { name: "Agent 连续活动日志" })).toBeVisible();
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

    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));

    expect(screen.getAllByText("已取消")).toHaveLength(2);
    expect(screen.queryByText("运行中")).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));

    expect(screen.queryByText("活动 1")).not.toBeInTheDocument();
    expect(screen.getByText("活动 90")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /加载更早活动/ }));
    expect(screen.getByText("活动 1")).toBeVisible();
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

    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));

    expect(screen.getAllByText("已取消")).toHaveLength(2);
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
    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));

    expect(screen.getByText("second'")).toBeVisible();
    expect(screen.getByText("$ printf 'first")).toHaveAttribute("title", "$ printf 'first");
  });

  it("shows tool facts and logs without exposing hidden reasoning", () => {
    render(<AgentActivity active events={[
      { id: "issue-1:0", issueId: "issue-1", sequence: 0, actor: "SYSTEM", type: "ISSUE_CREATED", occurredAt: "2026-08-19T08:59:00Z", data: {} },
      { id: "issue-1:1", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "MESSAGE", occurredAt: "2026-08-19T09:00:00Z", data: { message: "Tracing checkout" } },
      { id: "issue-1:2", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "COMMAND", occurredAt: "2026-08-19T09:01:00Z", data: { message: "pnpm test" } }
    ]} />);

    expect(screen.getByText("pnpm test")).toBeVisible();
    const toggle = screen.getByRole("button", { name: "Agent 活动" });
    expect(toggle).toHaveAttribute("data-slot", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Issue 已创建")).toBeVisible();
    expect(screen.getByText("Oh My Bug")).toBeVisible();
    expect(screen.queryByText("ISSUE_CREATED")).not.toBeInTheDocument();
    expect(screen.getByText("Tracing checkout")).toBeVisible();
    expect(screen.getAllByText("pnpm test")).toHaveLength(2);
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

    expect(screen.getByText("Codex 网络连接中断")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));
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

    expect(screen.getByText("Runtime 已重启，正在恢复实现")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));
    expect(screen.getByText("Runtime 已重启，正在恢复分析")).toBeVisible();
    expect(screen.queryByText("任务意外中断")).not.toBeInTheDocument();
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

    expect(screen.getByText("Runtime 已重启，正在恢复证据采集")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }));
    expect(screen.getByText("实现完成，准备采集证据")).toBeVisible();
  });
});
