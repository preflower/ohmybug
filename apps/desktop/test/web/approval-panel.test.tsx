// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApprovalPanel } from "../../src/web/issues/approval-panel.js";

describe("approval panel", () => {
  it("approves a Bug Assessment from the compact authorization dock", () => {
    const onApprove = vi.fn(async () => undefined);
    render(
      <ApprovalPanel
        stage="ASSESSMENT"
        revision={3}
        contentHash="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        title="Checkout returns 500"
        verdict="BUG"
        onApprove={onApprove}
        onRequestChanges={async () => undefined}
      />
    );

    expect(screen.getByText("等待授权")).toBeVisible();
    expect(screen.getByText("确认并开始修复")).toBeVisible();
    expect(screen.queryByText("01234567")).not.toBeInTheDocument();
    expect(screen.getByText("将解锁：修改本机代码并运行项目命令")).toBeVisible();
    expect(screen.queryByLabelText("修改意见")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认是 Bug 并开始修复" })).toHaveAttribute("data-slot", "button");
    fireEvent.click(screen.getByRole("button", { name: "确认是 Bug 并开始修复" }));

    expect(onApprove).toHaveBeenCalledWith({
      assessmentRevision: 3,
      assessmentContentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      title: "Checkout returns 500",
    });
  });

  it("approves a Feature Assessment from the implementation dock", () => {
    const onApprove = vi.fn(async () => undefined);
    render(
      <ApprovalPanel
        stage="ASSESSMENT"
        revision={4}
        contentHash="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        title="Add CSV export"
        verdict="FEATURE"
        onApprove={onApprove}
        onRequestChanges={async () => undefined}
      />
    );

    expect(screen.getByText("确认并开始实现")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "确认是 Feature 并开始实现" }));
    expect(onApprove).toHaveBeenCalledWith({
      assessmentRevision: 4,
      assessmentContentHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      title: "Add CSV export",
    });
  });

  it("expands feedback only when the user requests changes", () => {
    const onRequestChanges = vi.fn(async () => undefined);
    render(
      <ApprovalPanel
        stage="ASSESSMENT"
        revision={3}
        contentHash="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        title="Checkout returns 500"
        verdict="BUG"
        onApprove={async () => undefined}
        onRequestChanges={onRequestChanges}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "要求重新分析" }));
    fireEvent.change(screen.getByLabelText("修改意见"), { target: { value: "补充窄窗口截图" } });
    fireEvent.click(screen.getByRole("button", { name: "提交并重新分析" }));
    expect(onRequestChanges).toHaveBeenCalledWith("补充窄窗口截图");
  });

  it("states that Delivery approval completes the Issue as fixed", () => {
    render(
      <ApprovalPanel
        stage="DELIVERY"
        verdict="BUG"
        revision={4}
        onApprove={async () => undefined}
        onRequestChanges={async () => undefined}
      />
    );

    expect(screen.getByText(/把 Issue 完成为 FIXED/)).toBeVisible();
    expect(screen.getByRole("button", { name: "批准验收并完成 Issue" })).toBeEnabled();
  });

  it("states that Feature Delivery approval completes the Issue as implemented", () => {
    render(
      <ApprovalPanel
        stage="DELIVERY"
        verdict="FEATURE"
        revision={2}
        onApprove={async () => undefined}
        onRequestChanges={async () => undefined}
      />
    );

    expect(screen.getByText(/把 Issue 完成为 IMPLEMENTED/)).toBeVisible();
  });

  it("requires an explicit confirmation before closing a NOT_A_BUG Assessment", () => {
    const onConfirmNotABug = vi.fn(async () => undefined);
    render(
      <ApprovalPanel
        stage="ASSESSMENT"
        revision={2}
        contentHash="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        title="Expected authentication response"
        verdict="NOT_A_BUG"
        onConfirmNotABug={onConfirmNotABug}
        onRequestChanges={async () => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "确认不是 Bug 并关闭" }));
    expect(onConfirmNotABug).toHaveBeenCalledWith({
      assessmentRevision: 2,
      assessmentContentHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    });
  });

  it("confirms the exact duplicate target suggested by the Assessment", () => {
    const onConfirmDuplicate = vi.fn(async () => undefined);
    render(
      <ApprovalPanel
        stage="ASSESSMENT"
        revision={5}
        contentHash="1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
        title="Duplicate checkout failure"
        verdict="BUG"
        suspectedDuplicateOf="CHK-7"
        onConfirmDuplicate={onConfirmDuplicate}
        onRequestChanges={async () => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "确认重复并关闭" }));
    expect(onConfirmDuplicate).toHaveBeenCalledWith({
      assessmentRevision: 5,
      assessmentContentHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    }, "CHK-7");
  });

  it("routes UNCERTAIN Assessment feedback back to the same Agent session", () => {
    const onRequestChanges = vi.fn(async () => undefined);
    render(
      <ApprovalPanel
        stage="ASSESSMENT"
        revision={6}
        contentHash="fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321"
        title="Intermittent checkout failure"
        verdict="UNCERTAIN"
        onRequestChanges={onRequestChanges}
      />
    );

    expect(screen.getByText("补充信息并重新分析")).toBeVisible();
    expect(screen.getByText("补充受影响页面、组件或复现方式，Codex 将重新分析。")).toBeVisible();
    fireEvent.change(screen.getByLabelText("补充信息"), { target: { value: "Inspect the timeout trace" } });
    fireEvent.click(screen.getByRole("button", { name: "提交并重新分析" }));
    expect(onRequestChanges).toHaveBeenCalledWith("Inspect the timeout trace");
    expect(screen.queryByRole("button", { name: /开始修复/ })).not.toBeInTheDocument();
  });

  it("returns rejected Delivery feedback to the repair loop", () => {
    const onRequestChanges = vi.fn(async () => undefined);
    render(
      <ApprovalPanel
        stage="DELIVERY"
        verdict="BUG"
        revision={3}
        onApprove={async () => undefined}
        onRequestChanges={onRequestChanges}
      />
    );

    fireEvent.change(screen.getByLabelText("修改意见（可选）"), { target: { value: "The recording misses the error state" } });
    fireEvent.click(screen.getByRole("button", { name: "要求修改" }));
    expect(onRequestChanges).toHaveBeenCalledWith("The recording misses the error state");
  });

  it("keeps the approval action visible when the request fails", async () => {
    render(
      <ApprovalPanel
        stage="DELIVERY"
        verdict="BUG"
        revision={4}
        onApprove={async () => Promise.reject(new Error("验收服务不可用"))}
        onRequestChanges={async () => undefined}
      />
    );

    const approve = screen.getByRole("button", { name: "批准验收并完成 Issue" });
    fireEvent.click(approve);

    expect(await screen.findByRole("alert")).toHaveTextContent("验收服务不可用");
    expect(screen.getByRole("alert")).toHaveAttribute("data-slot", "alert");
    expect(approve).toBeVisible();
  });
});
