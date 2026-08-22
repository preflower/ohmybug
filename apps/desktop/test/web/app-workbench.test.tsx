// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/web/app.js";
import { api } from "../../src/web/api/client.js";
import type { IssueDto, ProjectDto } from "../../src/web/api/types.js";

const project: ProjectDto = {
  id: "project-1",
  name: "Checkout",
  key: "CHK",
  path: "/work/checkout",
  commands: { test: "pnpm test" },
  agent: { plugin: "codex" },
  integrations: {},
  workspace: { provider: "local", config: {} },
  revision: 1,
  createdAt: "2026-08-19T09:00:00.000Z",
  updatedAt: "2026-08-19T09:00:00.000Z",
};

const issue: IssueDto = {
  id: "issue-1",
  projectId: "project-1",
  identifier: "CHK-1",
  title: "Checkout returns 500",
  titleSource: "integration",
  status: "ASSESSMENT_REVIEW",
  inputs: [{
    id: "input-1",
    integration: "manual",
    inputKey: "manual-1",
    rawData: { content: "Expired session" },
    data: { content: "Expired session" },
    receivedAt: "2026-08-19T09:00:00.000Z",
  }],
  assessment: {
    revision: 1,
    contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    verdict: "BUG",
    suggestedTitle: "Checkout returns 500",
    reasoning: "The failure follows cart hydration.",
    rootCause: "Cart hydration returns null.",
    solution: "Return a recoverable result.",
  },
  revision: 4,
  createdAt: "2026-08-19T09:00:00.000Z",
  updatedAt: "2026-08-19T09:01:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState({}, "", "/");
});

describe("control center workbench", () => {
  it("orders the Issue list newest first and selects the newest Issue", async () => {
    const newestIssue: IssueDto = {
      ...issue,
      id: "issue-10",
      identifier: "CHK-10",
      title: "Newest checkout regression",
      createdAt: "2026-08-20T09:00:00.000Z",
      updatedAt: "2026-08-20T09:01:00.000Z",
    };
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([issue, newestIssue]);
    vi.spyOn(api, "issue").mockResolvedValue(newestIssue);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);

    render(<App />);

    const list = await screen.findByRole("region", { name: "Issue 列表" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("CHK-10"),
      expect.stringContaining("CHK-1"),
    ]);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(await screen.findByRole("heading", { level: 2, name: "Newest checkout regression" })).toBeVisible();
  });

  it("labels the empty Issue list with a heading and supporting guidance", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([]);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});

    render(<App />);

    expect(await screen.findByRole("heading", { name: "暂无 Issue" })).toBeVisible();
    expect(screen.getByText("手动创建，或为项目连接 Sentry 与 DingTalk。")).toBeVisible();
  });

  it("loads Runtime issues, opens manual creation, and navigates to project configuration", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([issue]);
    vi.spyOn(api, "issue").mockResolvedValue(issue);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);
    const submitManual = vi.spyOn(api, "submitManual").mockResolvedValue({
      ...issue,
      id: "issue-2",
      identifier: "CHK-2",
      title: "Manual checkout failure",
    });

    render(<App />);

    expect(await screen.findByText("Checkout returns 500", { selector: ".issue-row strong" })).toBeVisible();
    expect(await screen.findByText("Cart hydration returns null.")).toBeVisible();
    expect(screen.getByTestId("issue-metadata-rail")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "隐藏详情栏" }));
    expect(screen.queryByTestId("issue-metadata-rail")).not.toBeInTheDocument();
    const issuesHeader = screen.getByRole("heading", { name: "Issues" }).closest(".view-header");
    expect(issuesHeader).not.toBeNull();
    fireEvent.click(within(issuesHeader as HTMLElement).getByRole("button", { name: "显示详情栏" }));
    expect(screen.getByTestId("issue-metadata-rail")).toBeVisible();

    expect(screen.getByRole("button", { name: "新建 Issue" })).toHaveAttribute("data-slot", "button");
    expect(screen.getByText("Ctrl", { selector: '[data-slot="kbd"]' })).toBeVisible();
    expect(screen.getByText("+", { selector: '[data-slot="kbd-separator"]' })).toBeVisible();
    expect(screen.getByText("N", { selector: '[data-slot="kbd"]' })).toBeVisible();
    expect(screen.queryByRole("button", { name: "筛选" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checkout" })).toHaveAttribute("data-slot", "button");
    const issueRow = screen.getByRole("button", { name: /Checkout returns 500/ });
    expect(issueRow).toHaveAttribute("data-slot", "button");

    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));
    expect(screen.queryByRole("region", { name: "Issue 详情" })).not.toBeInTheDocument();
    fireEvent.click(issueRow);
    expect(await screen.findByText("Cart hydration returns null.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "新建 Issue" }));
    expect(screen.getByRole("dialog", { name: "新建 Issue" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "项目" })).toHaveAttribute(
      "data-slot",
      "select-trigger",
    );
    expect(screen.getByRole("combobox", { name: "项目" })).toHaveTextContent("Checkout");
    expect(screen.getByLabelText("摘要（可选）")).toHaveAttribute("data-slot", "input");
    expect(screen.getByLabelText("问题内容")).toHaveAttribute("data-slot", "textarea");
    fireEvent.change(screen.getByLabelText("摘要（可选）"), {
      target: { value: "Manual checkout failure" },
    });
    fireEvent.change(screen.getByLabelText("问题内容"), {
      target: { value: "Checkout failed after login" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建并开始分析" }));
    await waitFor(() => expect(submitManual).toHaveBeenCalledWith({
      projectId: "project-1",
      commandId: expect.stringMatching(/^manual-/),
      summary: "Manual checkout failure",
      content: "Checkout failed after login",
    }));
    expect(screen.queryByRole("dialog", { name: "新建 Issue" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Projects" }));
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeVisible();
    const projectList = screen.getByRole("region", { name: "本机项目" });
    expect(within(projectList).getByRole("searchbox", { name: "搜索项目" })).toBeVisible();
    expect(within(projectList).getByRole("combobox", { name: "项目排序" })).toHaveTextContent("最近更新");
    expect(within(projectList).getByText("/work/checkout")).toBeVisible();
    const projectRow = within(projectList).getByRole("button", { name: /打开项目 Checkout.*\/work\/checkout/ });
    expect(projectRow).toHaveAttribute("data-slot", "button");
    fireEvent.click(projectRow);
    expect(screen.getByRole("heading", { name: "项目配置" })).toBeVisible();
    expect(screen.getByRole("button", { name: "返回项目列表" })).toHaveAttribute("data-slot", "button");
  });
});
