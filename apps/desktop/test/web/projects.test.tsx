// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { IntegrationPluginManifest, ProjectDto, WorkspaceProviderManifest } from "../../src/web/api/types.js";
import { ProjectForm } from "../../src/web/projects/project-form.js";

class ResizeObserverMock {
  disconnect() {}
  observe() {}
  unobserve() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

const manifests: IntegrationPluginManifest[] = [{
  id: "example",
  name: "Example source",
  configFields: [
    { key: "workspace", type: "string", label: "Workspace slug", required: true },
    { key: "channels", type: "string[]", label: "Channels", required: false },
    { key: "batchSize", type: "number", label: "Batch size", required: false, defaultValue: 20 },
    { key: "includeArchived", type: "boolean", label: "Include archived", required: false },
  ],
  secretFields: [
    { key: "apiToken", label: "API token", required: true },
    { key: "signingKey", label: "Signing key", required: false },
  ],
}];

const inspection = { path: "/work/checkout", name: "checkout", key: "CHECKOUT" };
const workspaceProviders: WorkspaceProviderManifest[] = [
  { id: "local", name: "本机目录", configFields: [] },
  {
    id: "git",
    name: "Git Worktree",
    configFields: [
      { key: "baseBranch", type: "string", label: "基线分支", required: true, defaultValue: "main" },
      { key: "delivery", type: "string", label: "交付方式", required: true, defaultValue: "local" },
      { key: "remote", type: "string", label: "远程仓库", required: false, defaultValue: "origin" },
    ],
  },
];

const configuredProject: ProjectDto = {
  id: "project-1",
  name: "Checkout",
  key: "CHK",
  path: "/work/checkout",
  instructions: "Follow checkout conventions.",
  agent: { plugin: "codex" },
  commands: { test: "pnpm test" },
  integrations: {
    example: {
      enabled: true,
      secretConfigured: { apiToken: true, signingKey: false },
      config: { workspace: "acme", channels: ["alerts"], batchSize: 50, includeArchived: true },
    },
  },
  workspace: { provider: "local", config: {} },
  revision: 3,
  createdAt: "2026-08-20T08:00:00.000Z",
  updatedAt: "2026-08-20T09:00:00.000Z",
};

function selectTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

describe("Project configuration", () => {
  it("keeps Local as default and renders Git fields from its manifest", async () => {
    render(<ProjectForm
      inspection={inspection}
      manifests={manifests}
      workspaceProviders={workspaceProviders}
      onSave={async () => undefined}
    />);

    selectTab("工作目录");
    expect(screen.getByRole("combobox", { name: "工作目录方式" }))
      .toHaveTextContent("本机目录");
    expect(screen.queryByLabelText("基线分支")).not.toBeInTheDocument();
    const trigger = screen.getByRole("combobox", { name: "工作目录方式" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const local = await screen.findByRole("option", { name: "本机目录" });
    const git = screen.getByRole("option", { name: "Git Worktree" });
    await waitFor(() => expect(local).toHaveFocus());
    fireEvent.keyDown(local, { key: "ArrowDown" });
    await waitFor(() => expect(git).toHaveFocus());
    fireEvent.keyDown(git, { key: "Enter" });
    expect(await screen.findByLabelText("基线分支")).toHaveValue("main");
    expect(screen.getByLabelText("交付方式")).toHaveValue("local");
    expect(screen.getByLabelText("远程仓库")).toHaveValue("origin");
  });

  it("prefills a new project from directory inspection without assuming Git", () => {
    render(<ProjectForm inspection={inspection} manifests={manifests} onSave={async () => undefined} />);
    expect(screen.getByLabelText("项目名称")).toHaveAttribute("data-slot", "input");
    expect(screen.getByLabelText("项目名称")).toHaveValue("checkout");
    expect(screen.getByLabelText("项目标识")).toHaveValue("CHECKOUT");
    expect(screen.getByLabelText("本机项目路径")).toHaveValue("/work/checkout");
    expect(screen.queryByLabelText(/remote|分支/i)).not.toBeInTheDocument();
  });

  it("renders integration tabs and fields entirely from plugin manifests", () => {
    render(<ProjectForm initial={configuredProject} manifests={manifests} onSave={async () => undefined} />);
    const tabs = screen.getByRole("tablist", { name: "项目配置" });
    expect(tabs).toHaveAttribute("aria-orientation", "vertical");
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "项目", "工作目录", "Agent", "命令与验收", "Example source",
    ]);
    selectTab("Example source");
    expect(screen.getByRole("checkbox", { name: "启用" })).toHaveAttribute(
      "data-slot",
      "checkbox",
    );
    expect(screen.getByLabelText("Workspace slug")).toHaveValue("acme");
    expect(screen.getByLabelText("Channels 1")).toHaveValue("alerts");
    expect(screen.getByLabelText("Batch size")).toHaveValue(50);
    expect(screen.getByRole("checkbox", { name: "Include archived" })).toBeChecked();
    expect(screen.getByLabelText("API token")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("API token")).toHaveAttribute("placeholder", "已配置；输入新值可替换");
    expect(screen.queryByDisplayValue(/token/i)).not.toBeInTheDocument();
  });

  it("collects generic config and keeps Agent configuration capability-only", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectForm initial={configuredProject} manifests={manifests} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Checkout Web" } });
    selectTab("Agent");
    expect(screen.getByRole("combobox", { name: "Agent 插件" })).toHaveAttribute(
      "data-slot",
      "select-trigger",
    );
    expect(screen.getByRole("combobox", { name: "Agent 插件" })).toHaveTextContent("Codex");
    expect(screen.getByLabelText("项目指令")).toHaveAttribute("data-slot", "textarea");
    expect(screen.getByLabelText("项目指令")).toHaveValue("Follow checkout conventions.");
    expect(screen.queryByLabelText(/model|timeout/i)).not.toBeInTheDocument();
    selectTab("Example source");
    fireEvent.change(screen.getByLabelText("Workspace slug"), { target: { value: "new-workspace" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "保存项目" })); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: "Checkout Web",
      path: "/work/checkout",
      agentPlugin: "codex",
      integrations: expect.objectContaining({
        example: expect.objectContaining({ config: expect.objectContaining({ workspace: "new-workspace" }) }),
      }),
    }));
  });

  it("keeps invalid project fields visible with inline errors", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectForm inspection={inspection} manifests={manifests} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("本机项目路径"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
    const path = await screen.findByLabelText("本机项目路径");
    expect(path).toHaveValue("");
    expect(screen.getByText("请输入本机项目路径")).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows a request error below the save action without clearing the form", async () => {
    render(<ProjectForm inspection={inspection} manifests={manifests} onSave={async () => Promise.reject(new Error("目录不可用"))} />);
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Broken" } });
    const saveButton = screen.getByRole("button", { name: "保存项目" });
    fireEvent.click(saveButton);
    const alert = await screen.findByRole("alert");
    expect(Boolean(saveButton.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(alert).toHaveTextContent("目录不可用");
    expect(screen.getByLabelText("项目名称")).toHaveValue("Broken");
  });

  it("confirms a successful save beside the persistent action", async () => {
    render(<ProjectForm inspection={inspection} manifests={manifests} onSave={async () => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已保存");
  });

  it("saves all changed secrets for one plugin as a single patch", async () => {
    const saved: ProjectDto = {
      ...configuredProject,
      revision: 4,
      integrations: {
        example: {
          ...configuredProject.integrations!.example!,
          secretConfigured: { apiToken: true, signingKey: true },
        },
      },
    };
    const onSaveSecrets = vi.fn(async () => saved);
    render(<ProjectForm initial={configuredProject} manifests={manifests} onSave={async () => undefined} onSaveSecrets={onSaveSecrets} />);
    selectTab("Example source");
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: "secret-token" } });
    fireEvent.change(screen.getByLabelText("Signing key"), { target: { value: "signing-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Example source 凭证" }));
    await waitFor(() => expect(onSaveSecrets).toHaveBeenCalledWith("project-1", "example", {
      apiToken: "secret-token",
      signingKey: "signing-key",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("凭证已保存到系统钥匙串");
    expect(screen.getByLabelText("API token")).toHaveValue("");
  });

  it("shows batch credential failures beneath their save action", async () => {
    const onSaveSecrets = vi.fn(async () => Promise.reject(new Error("系统钥匙串不可用")));
    render(<ProjectForm initial={configuredProject} manifests={manifests} onSave={async () => undefined} onSaveSecrets={onSaveSecrets} />);
    selectTab("Example source");
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: "secret-token" } });
    const saveSecrets = screen.getByRole("button", { name: "保存 Example source 凭证" });
    fireEvent.click(saveSecrets);
    const alert = await screen.findByRole("alert");
    expect(Boolean(saveSecrets.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(alert).toHaveTextContent("系统钥匙串不可用");
    expect(screen.getByLabelText("API token")).toHaveValue("secret-token");
  });
});
