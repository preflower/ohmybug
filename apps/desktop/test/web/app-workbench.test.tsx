// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/web/app.js";
import { api } from "../../src/web/api/client.js";
import type { AgentEventDto, IssueDto, ProjectDto } from "../../src/web/api/types.js";

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
  localStorage.clear();
  vi.restoreAllMocks();
  delete window.ohMyBug;
  history.replaceState({}, "", "/");
});

describe("control center workbench", () => {
  it("updates a non-selected Issue row when its Runtime event arrives", async () => {
    const selected: IssueDto = {
      ...issue,
      id: "issue-selected",
      identifier: "CHK-2",
      title: "Selected issue",
      updatedAt: "2026-08-20T09:00:00.000Z",
    };
    const background: IssueDto = {
      ...issue,
      id: "issue-background",
      identifier: "CHK-1",
      title: "Background issue",
      status: "FINALIZING",
      revision: 5,
    };
    const terminal: IssueDto = {
      ...issue,
      id: "issue-terminal",
      identifier: "CHK-0",
      title: "Terminal issue",
      status: "COMPLETED",
    };
    const completed: IssueDto = {
      ...background,
      status: "COMPLETED",
      revision: 6,
      updatedAt: "2026-08-20T09:02:00.000Z",
    };
    const listeners = new Map<
      string,
      (events: AgentEventDto[], cursor: number) => void
    >();

    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([background, selected, terminal]);
    vi.spyOn(api, "issue").mockImplementation(async (id) =>
      id === background.id ? completed : selected
    );
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    const subscribe = vi.spyOn(api, "subscribeIssueEvents").mockImplementation(
      (id, _cursor, listener) => {
        listeners.set(id, listener);
        return () => listeners.delete(id);
      },
    );

    render(<App />);

    expect(await screen.findByRole("heading", { level: 2, name: "Selected issue" })).toBeVisible();
    await waitFor(() => expect(listeners.has(background.id)).toBe(true));
    expect(subscribe.mock.calls.some(([id]) => id === terminal.id)).toBe(false);

    act(() => listeners.get(background.id)?.([{
      id: "event-completed",
      issueId: background.id,
      sequence: 1,
      type: "ISSUE_COMPLETED",
      actor: "SYSTEM",
      data: {},
      occurredAt: "2026-08-20T09:02:00.000Z",
    }], 1));

    const list = screen.getByRole("region", { name: "Issue 列表" });
    const backgroundRow = within(list).getByRole("button", { name: /CHK-1/ });
    await waitFor(() => expect(within(backgroundRow).getByText("已完成")).toBeVisible());
    expect(screen.getByRole("heading", { level: 2, name: "Selected issue" })).toBeVisible();
  });

  it("ignores an older snapshot delivered after a newer Issue revision", async () => {
    const selected: IssueDto = {
      ...issue,
      id: "issue-selected",
      identifier: "CHK-2",
      title: "Selected issue",
      updatedAt: "2026-08-20T09:00:00.000Z",
    };
    const current: IssueDto = {
      ...issue,
      id: "issue-background",
      identifier: "CHK-1",
      title: "Background issue",
      status: "REPAIRING",
      revision: 7,
    };
    const stale: IssueDto = {
      ...current,
      status: "FINALIZING",
      revision: 6,
    };
    let backgroundListener: ((events: AgentEventDto[], cursor: number) => void) | undefined;

    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([current, selected]);
    vi.spyOn(api, "issue").mockImplementation(async (id) =>
      id === current.id ? stale : selected
    );
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockImplementation((id, _cursor, listener) => {
      if (id === current.id) backgroundListener = listener;
      return () => undefined;
    });

    render(<App />);
    await waitFor(() => expect(backgroundListener).toBeDefined());
    act(() => backgroundListener?.([{
      id: "event-stale",
      issueId: current.id,
      sequence: 1,
      type: "DELIVERY_APPROVED",
      actor: "USER",
      data: {},
      occurredAt: "2026-08-20T09:01:00.000Z",
    }], 1));

    const list = screen.getByRole("region", { name: "Issue 列表" });
    const backgroundRow = within(list).getByRole("button", { name: /CHK-1/ });
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(within(backgroundRow).getByText("实现中")).toBeVisible();
    expect(within(backgroundRow).queryByText("交付处理中")).not.toBeInTheDocument();
  });

  it("grants the selected Issue capability request with its revision and request ID", async () => {
    const permissionRequiredIssue: IssueDto = {
      ...issue,
      status: "PERMISSION_REQUIRED",
      revision: 10,
      pendingCapabilityRequest: {
        id: "request-1",
        operation: "REPAIR",
        stage: "REPAIR",
        resumeStatus: "REPAIRING",
        capabilities: ["HOST_EXECUTION"],
        reason: "Launch Electron acceptance",
        requestedAt: "2026-08-24T08:00:00.000Z",
      },
    };
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([permissionRequiredIssue]);
    vi.spyOn(api, "issue").mockResolvedValue(permissionRequiredIssue);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);
    const grant = vi.spyOn(api, "grantIssueCapabilities").mockResolvedValue({
      ...permissionRequiredIssue,
      status: "REPAIRING",
      pendingCapabilityRequest: undefined,
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "授权并继续" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认授权并继续" }));

    await waitFor(() => expect(grant).toHaveBeenCalledWith(
      permissionRequiredIssue.id,
      permissionRequiredIssue.revision,
      "request-1",
    ));
  });

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

  it("toggles the Issue details rail with Ctrl/Cmd+B and exposes a label-only Tooltip", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([issue]);
    vi.spyOn(api, "issue").mockResolvedValue(issue);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);

    render(<App />);

    expect(await screen.findByTestId("issue-metadata-rail")).toBeVisible();
    const hideAction = screen.getByRole("button", { name: "隐藏详情栏" });
    expect(hideAction).toHaveAttribute("aria-keyshortcuts", "Control+B Meta+B");
    fireEvent.focus(hideAction);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("隐藏详情栏");
    expect(screen.getByRole("tooltip").querySelector('[data-slot="kbd-group"]')).toBeNull();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.queryByTestId("issue-metadata-rail")).not.toBeInTheDocument();

    const showAction = screen.getByRole("button", { name: "显示详情栏" });
    expect(showAction).toHaveAttribute("aria-keyshortcuts", "Control+B Meta+B");
    fireEvent.keyDown(window, { key: "B", metaKey: true });
    expect(screen.getByTestId("issue-metadata-rail")).toBeVisible();
  });

  it("does not toggle the details rail for old, repeated, Alt-modified, or editable shortcuts", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([issue]);
    vi.spyOn(api, "issue").mockResolvedValue(issue);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);

    render(<App />);
    expect(await screen.findByTestId("issue-metadata-rail")).toBeVisible();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "b", ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { key: "b", ctrlKey: true, repeat: true });
    expect(screen.getByTestId("issue-metadata-rail")).toBeVisible();

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "b", ctrlKey: true });
    input.remove();

    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.append(editable);
    fireEvent.keyDown(editable, { key: "b", metaKey: true });
    editable.remove();

    expect(screen.getByTestId("issue-metadata-rail")).toBeVisible();
  });

  it("uses sidebar project shortcuts to filter the Issue list", async () => {
    const storefront: ProjectDto = {
      ...project,
      id: "project-2",
      name: "Storefront",
      key: "STO",
      path: "/work/storefront",
    };
    const storefrontIssue: IssueDto = {
      ...issue,
      id: "issue-2",
      projectId: storefront.id,
      identifier: "STO-1",
      title: "Storefront search is stale",
      updatedAt: "2026-08-20T09:01:00.000Z",
    };
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project, storefront]);
    vi.spyOn(api, "issues").mockResolvedValue([issue, storefrontIssue]);
    vi.spyOn(api, "issue").mockImplementation(async (id) => id === storefrontIssue.id ? storefrontIssue : issue);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);

    render(<App />);

    const storefrontShortcut = await screen.findByRole("button", { name: "Storefront" });
    fireEvent.click(storefrontShortcut);

    const filteredList = screen.getByRole("region", { name: "Issue 列表" });
    expect(within(filteredList).getByText("Storefront search is stale")).toBeVisible();
    expect(within(filteredList).queryByText("Checkout returns 500")).not.toBeInTheDocument();
    expect(screen.getByText("Storefront", { selector: ".breadcrumb span:last-child" })).toBeVisible();
    expect(storefrontShortcut).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("link", { name: "Issues" }));

    expect(within(filteredList).getByText("Storefront search is stale")).toBeVisible();
    expect(within(filteredList).getByText("Checkout returns 500")).toBeVisible();
    expect(screen.getByText("全部", { selector: ".breadcrumb span:last-child" })).toBeVisible();
  });

  it("keeps the sidebar project filter after Electron applies the hash route", async () => {
    const storefront: ProjectDto = {
      ...project,
      id: "project-2",
      name: "Storefront",
      key: "STO",
      path: "/work/storefront",
    };
    const storefrontIssue: IssueDto = {
      ...issue,
      id: "issue-2",
      projectId: storefront.id,
      identifier: "STO-1",
      title: "Storefront search is stale",
      updatedAt: "2026-08-20T09:01:00.000Z",
    };
    Object.defineProperty(window, "ohMyBug", { configurable: true, value: {} });
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project, storefront]);
    vi.spyOn(api, "issues").mockResolvedValue([issue, storefrontIssue]);
    vi.spyOn(api, "issue").mockImplementation(async (id) => id === storefrontIssue.id ? storefrontIssue : issue);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Storefront" }));
    fireEvent(window, new HashChangeEvent("hashchange"));

    const filteredList = screen.getByRole("region", { name: "Issue 列表" });
    expect(within(filteredList).getByText("Storefront search is stale")).toBeVisible();
    expect(within(filteredList).queryByText("Checkout returns 500")).not.toBeInTheDocument();
    expect(screen.getByText("Storefront", { selector: ".breadcrumb span:last-child" })).toBeVisible();
  });

  it("defaults a new Issue to the active sidebar project", async () => {
    const storefront: ProjectDto = {
      ...project,
      id: "project-2",
      name: "Storefront",
      key: "STO",
      path: "/work/storefront",
    };
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project, storefront]);
    vi.spyOn(api, "issues").mockResolvedValue([]);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Storefront" }));
    fireEvent.click(screen.getByRole("button", { name: "新建 Issue" }));

    expect(screen.getByRole("combobox", { name: "项目" })).toHaveTextContent("Storefront");
  });

  it("defaults a top-level new Issue to the last successfully used project", async () => {
    const storefront: ProjectDto = {
      ...project,
      id: "project-2",
      name: "Storefront",
      key: "STO",
      path: "/work/storefront",
    };
    localStorage.setItem("oh-my-bug:last-issue-project", storefront.id);
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project, storefront]);
    vi.spyOn(api, "issues").mockResolvedValue([]);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));

    expect(screen.getByRole("combobox", { name: "项目" })).toHaveTextContent("Storefront");
  });

  it("remembers the project after an Issue is created successfully", async () => {
    const storefront: ProjectDto = {
      ...project,
      id: "project-2",
      name: "Storefront",
      key: "STO",
      path: "/work/storefront",
    };
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project, storefront]);
    vi.spyOn(api, "issues").mockResolvedValue([]);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "submitManual").mockResolvedValue({
      ...issue,
      id: "issue-2",
      projectId: storefront.id,
      identifier: "STO-1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Storefront" }));
    fireEvent.click(screen.getByRole("button", { name: "新建 Issue" }));
    fireEvent.change(screen.getByLabelText("问题内容"), {
      target: { value: "Storefront checkout failed" },
    });
    expect(localStorage.getItem("oh-my-bug:last-issue-project")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "创建并开始分析" }));

    await waitFor(() => expect(localStorage.getItem("oh-my-bug:last-issue-project")).toBe(storefront.id));
  });

  it("creates a valid Issue when Enter is pressed in the content field", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([]);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    const submitManual = vi.spyOn(api, "submitManual").mockResolvedValue({
      ...issue,
      id: "issue-2",
      identifier: "CHK-2",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    const contentField = screen.getByLabelText("问题内容");
    fireEvent.change(contentField, { target: { value: "Checkout failed after login" } });
    expect(screen.getByRole("button", { name: "创建并开始分析" })).toBeEnabled();
    fireEvent.keyDown(contentField, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(submitManual).toHaveBeenCalledWith({
      projectId: "project-1",
      commandId: expect.stringMatching(/^manual-/),
      content: "Checkout failed after login",
    }));
  });

  it("keeps Shift+Enter available for a newline in the content field", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([]);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    const submitManual = vi.spyOn(api, "submitManual").mockResolvedValue(issue);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    const contentField = screen.getByLabelText("问题内容");
    fireEvent.change(contentField, { target: { value: "Checkout failed" } });
    fireEvent.keyDown(contentField, { key: "Enter", code: "Enter", shiftKey: true });

    expect(submitManual).not.toHaveBeenCalled();
  });

  it("does not submit when Enter confirms an IME composition", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([]);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    const submitManual = vi.spyOn(api, "submitManual").mockResolvedValue(issue);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    const contentField = screen.getByLabelText("问题内容");
    fireEvent.change(contentField, { target: { value: "结账失败" } });
    fireEvent.keyDown(contentField, {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });

    expect(submitManual).not.toHaveBeenCalled();
  });

  it("does not submit again when Enter is pressed while creation is busy", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([]);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    const submitManual = vi.spyOn(api, "submitManual")
      .mockReturnValue(new Promise<IssueDto>(() => undefined));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    const contentField = screen.getByLabelText("问题内容");
    fireEvent.change(contentField, { target: { value: "Checkout failed" } });
    fireEvent.keyDown(contentField, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(submitManual).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(contentField, { key: "Enter", code: "Enter" });

    expect(submitManual).toHaveBeenCalledTimes(1);
  });

  it("keeps creation disabled and ignores Enter when content is blank", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([]);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    const submitManual = vi.spyOn(api, "submitManual").mockResolvedValue(issue);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    const contentField = screen.getByLabelText("问题内容");
    const createButton = screen.getByRole("button", { name: "创建并开始分析" });
    expect(createButton).toBeDisabled();

    fireEvent.change(contentField, { target: { value: "   " } });
    fireEvent.keyDown(contentField, { key: "Enter", code: "Enter" });

    expect(createButton).toBeDisabled();
    expect(submitManual).not.toHaveBeenCalled();
  });

  it("does not remember a project when Issue creation fails", async () => {
    const storefront: ProjectDto = {
      ...project,
      id: "project-2",
      name: "Storefront",
      key: "STO",
      path: "/work/storefront",
    };
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project, storefront]);
    vi.spyOn(api, "issues").mockResolvedValue([]);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "submitManual").mockRejectedValue(new Error("创建请求失败"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Storefront" }));
    fireEvent.click(screen.getByRole("button", { name: "新建 Issue" }));
    fireEvent.change(screen.getByLabelText("问题内容"), {
      target: { value: "Storefront checkout failed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建并开始分析" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("创建请求失败");
    expect(localStorage.getItem("oh-my-bug:last-issue-project")).toBeNull();
  });

  it("ignores a remembered project that is no longer available", async () => {
    localStorage.setItem("oh-my-bug:last-issue-project", "deleted-project");
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([]);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));

    expect(screen.getByRole("combobox", { name: "项目" })).toHaveTextContent("Checkout");
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

    const createIssueAction = screen.getByRole("button", { name: "新建 Issue" });
    expect(createIssueAction).toHaveAttribute("data-slot", "button");
    expect(createIssueAction.querySelector('[data-slot="kbd-group"]')).toBeNull();
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
    expect(screen.queryByRole("button", { name: "返回项目列表" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存项目（顶部）" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeVisible();
    expect(screen.getByRole("button", { name: "保存项目" })).toBeVisible();
  });

  it("shows a persisted branch with a Worktree tag and hides the row without a branch", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "workspaceProviders").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([issue]);
    vi.spyOn(api, "issue").mockResolvedValue(issue);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);
    const workspace = vi.spyOn(api, "issueWorkspace").mockResolvedValue({
      providerId: "git",
      status: "READY",
      branch: "ohmybug/chk-1",
    });

    const view = render(<App />);

    const rail = await screen.findByTestId("issue-metadata-rail");
    expect(await within(rail).findByText("ohmybug/chk-1")).toBeVisible();
    expect(within(rail).getByText("Worktree")).toBeVisible();
    expect(workspace).toHaveBeenCalledWith(issue.id);

    workspace.mockResolvedValue(null);
    view.unmount();
    render(<App />);
    const railWithoutBranch = await screen.findByTestId("issue-metadata-rail");
    await waitFor(() => expect(workspace).toHaveBeenCalledTimes(2));
    expect(within(railWithoutBranch).queryByText("分支")).not.toBeInTheDocument();
    expect(within(railWithoutBranch).queryByText("Worktree")).not.toBeInTheDocument();
  });

  it("hides cached workspace metadata while the same Issue revision refreshes", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "workspaceProviders").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([issue]);
    vi.spyOn(api, "issue")
      .mockResolvedValueOnce(issue)
      .mockResolvedValue({ ...issue });
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);
    let resolveRefresh: (value: null) => void = () => undefined;
    const pendingRefresh = new Promise<null>((resolve) => { resolveRefresh = resolve; });
    const workspace = vi.spyOn(api, "issueWorkspace")
      .mockResolvedValueOnce({
        providerId: "git",
        status: "READY",
        branch: "ohmybug/chk-1",
      })
      .mockReturnValueOnce(pendingRefresh);
    const cancel = vi.spyOn(api, "cancel").mockResolvedValue({ ...issue });

    render(<App />);

    const rail = await screen.findByTestId("issue-metadata-rail");
    expect(await within(rail).findByText("ohmybug/chk-1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭 Issue" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认关闭" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(issue.id));
    await waitFor(() => expect(workspace).toHaveBeenCalledTimes(2));

    expect(within(rail).queryByText("ohmybug/chk-1")).not.toBeInTheDocument();
    expect(within(rail).queryByText("Worktree")).not.toBeInTheDocument();

    resolveRefresh(null);
    await waitFor(() => expect(within(rail).queryByText("分支")).not.toBeInTheDocument());
  });
});
