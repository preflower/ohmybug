// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentActivity } from "../../src/web/issues/agent-activity.js";

describe("Agent activity", () => {
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

  it("shows a concise failure and keeps diagnostic output collapsed", () => {
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
    const details = screen.getByText("查看详情").closest("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("查看详情"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("stream disconnected before completion: error sending request")).toBeVisible();
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
