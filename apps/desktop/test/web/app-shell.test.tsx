// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/web/app.js";
import { api } from "../../src/web/api/client.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
});

function stubEmptyControlCenter() {
  vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
  vi.spyOn(api, "projects").mockResolvedValue([]);
  vi.spyOn(api, "issues").mockResolvedValue([]);
  vi.spyOn(api, "integrationHealth").mockResolvedValue({});
}

describe("application shell", () => {
  it("routes first launch to project onboarding and hides issue creation", async () => {
    stubEmptyControlCenter();
    const { container } = render(<App />);

    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByText("Oh My Bug ?!")).toBeVisible();
    expect(container.querySelector("img.brand-mark")).toHaveAttribute("alt", "");
    expect(await screen.findByRole("heading", { name: "打开第一个本机项目" })).toBeVisible();
    expect(screen.getByRole("button", { name: "打开项目目录" })).toHaveAttribute(
      "data-slot",
      "button",
    );
    expect(screen.getByRole("button", { name: "高级：手动输入路径" })).toHaveAttribute(
      "data-slot",
      "button",
    );
    expect(screen.queryByRole("button", { name: "新建 Issue" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "新建 Issue" })).not.toBeInTheDocument();
  });

  it("keeps settings focused on integrations and preferences", async () => {
    stubEmptyControlCenter();
    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

    const preferences = screen.getByRole("region", { name: "偏好设置" });
    expect(within(preferences).getByRole("heading", { name: "外观" })).toBeVisible();
    expect(within(preferences).getByRole("group", { name: "主题" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "集成运行状态" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Runtime" })).not.toBeInTheDocument();
  });

  it("keeps onboarding open when the native picker is canceled", async () => {
    stubEmptyControlCenter();
    const openProjectDirectory = vi.spyOn(api, "openProjectDirectory").mockResolvedValue({ canceled: true });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "打开项目目录" }));

    expect(openProjectDirectory).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "打开第一个本机项目" })).toBeVisible();
    expect(screen.queryByLabelText("本机项目路径")).not.toBeInTheDocument();
  });

  it("prefills the project editor after choosing a directory", async () => {
    stubEmptyControlCenter();
    vi.spyOn(api, "openProjectDirectory").mockResolvedValue({
      canceled: false,
      inspection: {
        path: "/work/checkout",
        name: "checkout",
        key: "CHECKOUT",
        workspaces: {}
      }
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "打开项目目录" }));

    expect(await screen.findByLabelText("本机项目路径")).toHaveValue("/work/checkout");
    expect(screen.getByLabelText("项目标识")).toHaveValue("CHECKOUT");
  });

  it("keeps visible save confirmation after manually creating the project", async () => {
    stubEmptyControlCenter();
    vi.spyOn(api, "createProject").mockResolvedValue({
      id: "project-1",
      name: "Checkout",
      key: "CHK",
      path: "/work/checkout",
      agent: { plugin: "codex" },
      commands: {},
      integrations: {},
      workspace: { provider: "local", config: {} },
      revision: 1,
      createdAt: "2026-08-20T08:00:00.000Z",
      updatedAt: "2026-08-20T08:00:00.000Z"
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "高级：手动输入路径" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Checkout" } });
    fireEvent.change(screen.getByLabelText("项目标识"), { target: { value: "CHK" } });
    fireEvent.change(screen.getByLabelText("本机项目路径"), { target: { value: "/work/checkout" } });
    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));

    expect(await screen.findByRole("status")).toHaveTextContent("已保存");
  });
});
