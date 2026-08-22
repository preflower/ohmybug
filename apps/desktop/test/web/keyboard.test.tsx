// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/web/app.js";
import { api } from "../../src/web/api/client.js";

const project = {
  id: "project-1",
  name: "Checkout",
  key: "CHK",
  path: "/work/checkout",
  commands: {},
  agent: { plugin: "codex" },
  integrations: {},
  workspace: { provider: "local", config: {} },
  revision: 1,
  createdAt: "2026-08-20T08:00:00.000Z",
  updatedAt: "2026-08-20T08:00:00.000Z",
};

function stubProductApi() {
  vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
  vi.spyOn(api, "projects").mockResolvedValue([project]);
  vi.spyOn(api, "issues").mockResolvedValue([]);
  vi.spyOn(api, "integrationHealth").mockResolvedValue({});
}

function installLightSystemTheme() {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches: true,
    media: "(prefers-color-scheme: light)",
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") listeners.add(listener as (event: MediaQueryListEvent) => void);
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") listeners.delete(listener as (event: MediaQueryListEvent) => void);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as MediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn(() => media));
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
  delete window.ohMyBug;
});

describe("keyboard and theme interactions", () => {
  it("limits the command menu to creating issues and opening projects", async () => {
    stubProductApi();
    installLightSystemTheme();
    const openProjectDirectory = vi.spyOn(api, "openProjectDirectory").mockResolvedValue({ canceled: true });
    render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.keyDown(window, { key: "c" });
    expect(screen.queryByRole("dialog", { name: "新建 Issue" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "新建 Issue" })).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "新建 Issue" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(screen.getByRole("dialog", { name: "新建 Issue" })).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });

    const createTrigger = screen.getByRole("button", { name: "新建 Issue" });
    fireEvent.click(createTrigger);
    expect(screen.getByRole("dialog", { name: "新建 Issue" })).toHaveAttribute(
      "data-slot",
      "dialog-content",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(createTrigger).toHaveFocus());

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const commandMenu = screen.getByRole("dialog", { name: "命令菜单" });
    expect(commandMenu).toBeVisible();
    expect(within(commandMenu).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
      "关闭",
      "新建 IssueCtrl+N",
      "打开项目Ctrl+O",
    ]);
    fireEvent.click(within(commandMenu).getByRole("button", { name: "打开项目" }));
    expect(openProjectDirectory).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "命令菜单" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(openProjectDirectory).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    expect(openProjectDirectory).toHaveBeenCalledTimes(3);
  });

  it("synchronizes system, light, and dark theme controls in Settings", async () => {
    stubProductApi();
    installLightSystemTheme();
    render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    const group = screen.getByRole("group", { name: "主题" });
    const systemTheme = within(group).getByRole("button", { name: "跟随系统" });
    const lightTheme = within(group).getByRole("button", { name: "浅色" });
    const darkTheme = within(group).getByRole("button", { name: "深色" });
    expect(systemTheme).toHaveAttribute("aria-pressed", "true");
    expect(systemTheme).toHaveAttribute("data-variant", "default");
    expect(lightTheme).toHaveAttribute("data-variant", "ghost");
    expect(screen.queryByText(/当前显示：/)).not.toBeInTheDocument();

    fireEvent.click(darkTheme);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("oh-my-bug-theme")).toBe("dark");
    expect(darkTheme).toHaveAttribute("data-variant", "default");
    expect(systemTheme).toHaveAttribute("data-variant", "ghost");
  });

  it("keeps navigation in browser history and restores direct routes", async () => {
    history.replaceState({}, "", "/settings");
    stubProductApi();

    render(<App />);
    await act(async () => Promise.resolve());
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Projects" }));
    expect(location.pathname).toBe("/projects");
    expect(screen.getByRole("heading", { name: "Projects" })).toBeVisible();
  });

  it("uses hash routing for the packaged desktop renderer", async () => {
    Object.defineProperty(window, "ohMyBug", { value: {}, configurable: true });
    history.replaceState({}, "", "#/settings");
    stubProductApi();

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeVisible();

    fireEvent.click(screen.getByRole("link", { name: "Projects" }));
    expect(location.hash).toBe("#/projects");
    expect(screen.getByRole("heading", { name: "Projects" })).toBeVisible();
  });
});
