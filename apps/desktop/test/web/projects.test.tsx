// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { IntegrationPluginManifest, ProjectDto, ProjectInspection, WorkspaceBranchDiscoveryDto, WorkspaceProviderManifest } from "../../src/web/api/types.js";
import { GitBranchCombobox } from "../../src/web/projects/git-branch-combobox.js";
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

const workspaceProviders: WorkspaceProviderManifest[] = [
  { id: "local", name: "本机目录", configFields: [] },
  {
    id: "git",
    name: "Git Worktree",
    configFields: [
      { key: "baseBranch", type: "string", label: "基线分支", required: true, defaultValue: "main" },
      { key: "pushToRemote", type: "boolean", label: "完成后推送到远程", required: true, defaultValue: false },
    ],
  },
];
const inspection: ProjectInspection = {
  path: "/work/checkout",
  name: "checkout",
  key: "CHECKOUT",
  workspaces: {
    local: { available: true },
    git: {
      available: true,
      fields: {
        pushToRemote: { enabled: false, reason: "当前 Git 仓库未配置远程仓库" },
      },
      properties: [],
      branches: {
        localBranches: ["main"],
        remoteBranches: [],
        remoteUnavailableReason: "当前 Git 仓库未配置远程仓库",
      },
    },
  },
};

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
  it("shows local branches first, then appends searchable remote branches", async () => {
    let resolveRefresh!: (value: WorkspaceBranchDiscoveryDto) => void;
    const refresh = vi.fn(() => new Promise<WorkspaceBranchDiscoveryDto>((resolve) => {
      resolveRefresh = resolve;
    }));
    render(<GitBranchCombobox
      discovery={{ localBranches: ["main", "release"], remoteBranches: [] }}
      onChange={vi.fn()}
      onRefresh={refresh}
      value="main"
    />);

    fireEvent.click(screen.getByRole("button", { name: "打开基线分支" }));
    await waitFor(() => {
      expect(screen.getByRole("group", { name: "本地分支" })).toHaveTextContent("main");
      expect(screen.getByText("正在加载远程分支…")).toBeVisible();
    });
    await act(async () => {
      resolveRefresh({
        localBranches: ["main", "release"],
        remoteBranches: ["origin/main", "origin/release"],
        remote: { name: "origin", url: "git@example.com:team/repo.git" },
      });
    });
    expect(await screen.findByRole("group", { name: "远程分支" }))
      .toHaveTextContent("origin/release");
    fireEvent.change(screen.getByRole("combobox", { name: "基线分支" }), {
      target: { value: "release" },
    });
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.getByText("release")).toBeVisible();
    expect(screen.getByText("origin/release")).toBeVisible();
  });

  it("keeps local branches available and retries a failed remote refresh", async () => {
    const refresh = vi.fn()
      .mockResolvedValueOnce({
        localBranches: ["main"],
        remoteBranches: [],
        refreshError: "GIT_COMMAND_FAILED:fetch",
      })
      .mockResolvedValueOnce({
        localBranches: ["main"],
        remoteBranches: ["origin/main"],
      });
    render(<GitBranchCombobox
      discovery={{ localBranches: ["main"], remoteBranches: [] }}
      onChange={vi.fn()}
      onRefresh={refresh}
      value="main"
    />);

    fireEvent.click(screen.getByRole("button", { name: "打开基线分支" }));
    expect(await screen.findByText("GIT_COMMAND_FAILED:fetch")).toBeVisible();
    expect(screen.getByRole("group", { name: "本地分支" })).toHaveTextContent("main");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("group", { name: "远程分支" }))
      .toHaveTextContent("origin/main");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["浏览器", { mode: "browser", label: "支付页", timeoutMs: 15_000 }],
    ["Electron", { mode: "electron", label: "桌面支付页", electronEntry: "dist/main.js", timeoutMs: 15_000 }],
    ["命令", { mode: "command", label: "API 响应", command: "pnpm capture:evidence", timeoutMs: 15_000 }],
  ] as const)("saves %s evidence capture configuration", async (option, expected) => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectForm initial={configuredProject} manifests={manifests} onSave={onSave} />);
    selectTab("命令与验收");
    const trigger = screen.getByRole("combobox", { name: "证据采集方式" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const selected = await screen.findByRole("option", { name: option });
    fireEvent.keyDown(selected, { key: "Enter" });
    fireEvent.change(screen.getByLabelText("证据标签"), {
      target: { value: expected.label },
    });
    if (expected.mode === "electron") {
      fireEvent.change(screen.getByLabelText("Electron 入口"), {
        target: { value: expected.electronEntry },
      });
    }
    if (expected.mode === "command") {
      fireEvent.change(screen.getByLabelText("证据命令"), {
        target: { value: expected.command },
      });
    }
    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      commands: expect.objectContaining({ evidenceCapture: expected }),
    })));
  });

  it("keeps Local as default and renders Git fields from its manifest", async () => {
    render(<ProjectForm
      inspection={inspection}
      manifests={manifests}
      workspaceProviders={workspaceProviders}
      onSave={async () => undefined}
    />);

    expect(screen.queryByRole("tab", { name: "工作目录" })).not.toBeInTheDocument();
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
    expect(await screen.findByRole("combobox", { name: "基线分支" })).toHaveValue("main");
    expect(screen.getByRole("switch", { name: "完成后推送到远程" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("当前 Git 仓库未配置远程仓库")).toBeVisible();
    expect(screen.queryByLabelText("远程仓库")).not.toBeInTheDocument();
  });

  it("prefills a new project from directory inspection without assuming Git", () => {
    render(<ProjectForm
      inspection={inspection}
      manifests={manifests}
      onSelectDirectory={async () => ({ canceled: true })}
      onSave={async () => undefined}
    />);
    expect(screen.getByLabelText("项目名称")).toHaveAttribute("data-slot", "input");
    expect(screen.getByLabelText("项目名称")).toHaveValue("checkout");
    expect(screen.getByLabelText("项目标识")).toHaveValue("CHECKOUT");
    expect(screen.getByLabelText("本机项目路径")).toHaveValue("/work/checkout");
    expect(screen.getByLabelText("本机项目路径")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "重新选择目录" })).toBeEnabled();
    expect(screen.getByText("项目路径和配置仅保存在这台电脑上。")).toBeVisible();
    expect(screen.queryByText("本机项目已注册")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/remote|分支/i)).not.toBeInTheDocument();
  });

  it("renders integration tabs and fields entirely from plugin manifests", () => {
    render(<ProjectForm initial={configuredProject} manifests={manifests} onSave={async () => undefined} />);
    const tabs = screen.getByRole("tablist", { name: "项目配置" });
    expect(tabs).toHaveAttribute("aria-orientation", "vertical");
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "项目", "Agent", "命令与验收", "Example source",
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

  it("shows the inspected remote path read-only and stores its internal name", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectForm
      inspection={{
        ...inspection,
        workspaces: {
          ...inspection.workspaces,
          git: {
            available: true,
            configPatch: { remote: "origin" },
            fields: { pushToRemote: { enabled: true } },
            properties: [{
              key: "remoteUrl",
              label: "远程仓库",
              value: "git@example.com:team/checkout.git",
              description: "Git remote: origin",
            }],
            branches: {
              localBranches: ["main"],
              remoteBranches: ["origin/main"],
              remote: { name: "origin", url: "git@example.com:team/checkout.git" },
            },
          },
        },
      }}
      manifests={manifests}
      workspaceProviders={workspaceProviders}
      onSave={onSave}
    />);

    const trigger = screen.getByRole("combobox", { name: "工作目录方式" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const local = await screen.findByRole("option", { name: "本机目录" });
    fireEvent.keyDown(local, { key: "ArrowDown" });
    const git = screen.getByRole("option", { name: "Git Worktree" });
    fireEvent.keyDown(git, { key: "Enter" });
    expect(await screen.findByText("git@example.com:team/checkout.git")).toBeVisible();
    expect(screen.queryByDisplayValue("origin")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "基线分支" })).toHaveValue("main");
    fireEvent.click(screen.getByRole("switch", { name: "完成后推送到远程" }));
    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      workspace: {
        provider: "git",
        config: { baseBranch: "main", pushToRemote: true, remote: "origin" },
      },
    })));
  });

  it("reselects a directory without saving and ignores picker cancellation", async () => {
    const selectDirectory = vi.fn()
      .mockResolvedValueOnce({ canceled: true })
      .mockResolvedValueOnce({
        canceled: false,
        inspection: {
          ...inspection,
          path: "/work/other",
          name: "other",
          key: "OTHER",
        },
      });
    render(<ProjectForm
      inspection={inspection}
      manifests={manifests}
      workspaceProviders={workspaceProviders}
      onSelectDirectory={selectDirectory}
      onSave={async () => undefined}
    />);

    fireEvent.click(screen.getByRole("button", { name: "重新选择目录" }));
    await waitFor(() => expect(selectDirectory).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("本机项目路径")).toHaveValue("/work/checkout");
    fireEvent.click(screen.getByRole("button", { name: "重新选择目录" }));
    await waitFor(() => expect(screen.getByLabelText("本机项目路径")).toHaveValue("/work/other"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

  it("shows a request error above the save footer without clearing the form", async () => {
    render(<ProjectForm inspection={inspection} manifests={manifests} onSave={async () => Promise.reject(new Error("目录不可用"))} />);
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Broken" } });
    const saveButton = screen.getByRole("button", { name: "保存项目" });
    fireEvent.click(saveButton);
    const alert = await screen.findByRole("alert");
    expect(Boolean(alert.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
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
