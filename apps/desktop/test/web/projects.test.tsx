// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { IntegrationConnectionTestResult, IntegrationPluginManifest, ProjectDto, ProjectInspection, WorkspaceBranchDiscoveryDto, WorkspaceProviderManifest } from "../../src/web/api/types.js";
import { Toaster } from "../../src/web/components/ui/sonner.js";
import { GitBranchCombobox } from "../../src/web/projects/git-branch-combobox.js";
import { IntegrationConnectionTest } from "../../src/web/projects/integration-connection-test.js";
import { IntegrationFields } from "../../src/web/projects/integration-fields.js";
import { IntegrationHealthStatus } from "../../src/web/projects/integration-health.js";
import { ProjectForm } from "../../src/web/projects/project-form.js";
import { ThemeProvider } from "../../src/web/theme/theme-provider.js";

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

const groupedManifest: IntegrationPluginManifest = {
  id: "dingtalk",
  name: "DingTalk",
  description: "从群聊接收 @ 机器人的消息并创建 Issue。",
  sections: [
    { id: "credentials", label: "应用凭证", description: "凭证仅保存在这台电脑的系统钥匙串中。" },
    { id: "rules", label: "接收规则" },
    { id: "advanced", label: "高级设置", description: "关键词过滤与消息归并", collapsed: true },
  ],
  configFields: [
    { key: "conversationFilterEnabled", type: "boolean", label: "群聊过滤", description: "开启后仅处理指定群聊；关闭时处理任意群聊中 @ 机器人的消息。", required: false, defaultValue: false, section: "rules" },
    { key: "conversationIds", type: "string[]", label: "群聊 ID", required: true, section: "rules", addLabel: "添加群聊", visibleWhen: { key: "conversationFilterEnabled", equals: true } },
    { key: "messageRule", type: "string", label: "消息关键词", required: false, section: "advanced" },
  ],
  secretFields: [
    { key: "clientId", label: "Client ID", required: true, section: "credentials" },
    { key: "clientSecret", label: "Client Secret", required: true, section: "credentials" },
  ],
};

const sentryManifest: IntegrationPluginManifest = {
  id: "sentry",
  name: "Sentry",
  icon: "sentry",
  description: "从指定 Sentry 项目接收 Issue 和事件。",
  sections: [
    { id: "connection", label: "连接配置", description: "用于定位项目并读取事件。" },
    {
      id: "validation",
      label: "连接验证",
      description: "仅使用已保存的配置和凭证。",
      connectionTest: true,
    },
    {
      id: "filters",
      label: "过滤规则",
      description: "限制进入 Oh My Bug 的 Sentry Issue。",
      summary: {
        fields: [
          { key: "environment", emptyValue: "全部环境" },
          { key: "query", emptyValue: "未解决 Issue", valuePrefix: "Query: " },
        ],
        separator: " · ",
      },
      collapsed: true,
    },
  ],
  configFields: [
    { key: "organization", type: "string", label: "Organization", required: true, section: "connection" },
    { key: "project", type: "string", label: "Project", required: true, section: "connection" },
    { key: "environment", type: "string", label: "Environment", required: false, section: "filters" },
    { key: "query", type: "string", label: "Query", required: false, section: "filters" },
  ],
  secretFields: [{ key: "token", label: "Auth token", required: true, section: "connection" }],
};

const workspaceProviders: WorkspaceProviderManifest[] = [
  { id: "local", name: "本机目录", configFields: [] },
  {
    id: "git",
    name: "Git Worktree",
    configFields: [
      { key: "baseBranch", type: "string", label: "基线分支", required: true, defaultValue: "main" },
      { key: "pushToRemote", type: "boolean", label: "完成后推送到远程", required: true, defaultValue: false },
      { key: "mergeToBaseBranch", type: "boolean", label: "完成后合并到基线分支", required: true, defaultValue: false },
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
        publicationRemotes: [],
        fetchUnavailableReason: "当前 Git 仓库未配置远程仓库",
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
  permissionMode: "request-approval",
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

const sentryProject: ProjectDto = {
  ...configuredProject,
  integrations: {
    sentry: {
      enabled: false,
      config: {
        organization: "saved-org",
        project: "saved-project",
        environment: "",
        query: "",
      },
      secretConfigured: { token: true },
    },
  },
};

function selectTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

describe("Project configuration", () => {
  it("defaults new projects to request approval", () => {
    render(<ProjectForm inspection={inspection} manifests={manifests} onSave={async () => undefined} />);

    selectTab("权限");
    expect(screen.getByRole("radio", { name: /请求批准/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /帮我批准/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /完全访问权限/ })).not.toBeChecked();
  });

  it("saves auto review without an extra confirmation", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectForm initial={configuredProject} manifests={manifests} onSave={onSave} />);

    selectTab("权限");
    fireEvent.click(screen.getByRole("radio", { name: /帮我批准/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "auto-review" }),
      {},
    ));
  });

  it("requires explicit confirmation before enabling full access", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectForm initial={configuredProject} manifests={manifests} onSave={onSave} />);

    selectTab("权限");
    fireEvent.click(screen.getByRole("radio", { name: /完全访问权限/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("启用完全访问权限？");
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("radio", { name: /请求批准/ })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /完全访问权限/ }));
    fireEvent.click(await screen.findByRole("button", { name: "启用完全访问" }));
    expect(screen.getByRole("radio", { name: /完全访问权限/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "full-access" }),
      {},
    ));
  });

  it("renders config-derived collapsed summaries", () => {
    render(<IntegrationFields
      config={{ environment: "", query: "" }}
      dirty={false}
      editingSecrets={{}}
      manifest={sentryManifest}
      secretConfigured={{ token: true }}
      secretValues={{}}
      onConfigChange={vi.fn()}
      onEditSecret={vi.fn()}
      onSecretChange={vi.fn()}
      onTestSavedIntegration={vi.fn()}
    />);
    const filters = screen.getByText("过滤规则").closest("details");
    expect(filters).toHaveTextContent("全部环境 · 未解决 Issue");
    expect(filters).not.toHaveAttribute("open");
  });

  it("disables testing before first save", () => {
    render(<ProjectForm
      inspection={inspection}
      manifests={[sentryManifest]}
      onSave={async () => undefined}
      onTestSavedIntegration={vi.fn()}
    />);
    selectTab("Sentry");
    expect(screen.getByRole("button", { name: "测试已保存配置" })).toBeDisabled();
    expect(screen.getByText("保存项目后可测试连接")).toBeVisible();
  });

  it("tests persisted settings while warning about unsaved edits", async () => {
    const testSaved = vi.fn(async () => ({
      title: "连接成功",
      details: [
        { label: "Organization", value: "saved-org" },
        { label: "Project", value: "saved-project" },
      ],
      testedAt: "2026-08-26T02:00:00.000Z",
    }));
    render(<ProjectForm
      initial={sentryProject}
      manifests={[sentryManifest]}
      onSave={async () => undefined}
      onTestSavedIntegration={testSaved}
    />);
    selectTab("Sentry");
    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "unsaved-org" },
    });
    expect(screen.getByText("当前修改不会用于本次测试")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "测试已保存配置" }));
    await screen.findByText("连接成功");
    expect(testSaved).toHaveBeenCalledWith("project-1", "sentry");
    expect(screen.getByText("saved-org")).toBeVisible();
    expect(screen.getByText("基于已保存配置")).toBeVisible();
  });

  it("ignores a connection result after the project changes", async () => {
    let resolve!: (value: IntegrationConnectionTestResult) => void;
    const onTest = vi.fn(() => new Promise<IntegrationConnectionTestResult>((done) => {
      resolve = done;
    }));
    const { rerender } = render(<IntegrationConnectionTest
      dirty={false}
      integrationId="sentry"
      projectId="project-1"
      onTest={onTest}
    />);
    fireEvent.click(screen.getByRole("button", { name: "测试已保存配置" }));
    rerender(<IntegrationConnectionTest
      dirty={false}
      integrationId="sentry"
      projectId="project-2"
      onTest={onTest}
    />);
    await act(async () => resolve({
      title: "连接成功",
      details: [{ label: "Project", value: "old-project" }],
      testedAt: "2026-08-26T02:00:00.000Z",
    }));
    expect(screen.queryByText("old-project")).not.toBeInTheDocument();
  });

  it.each([
    ["SENTRY_CONNECTION_FILTER_INVALID", "已保存的过滤条件无法用于当前 Sentry 项目。"],
    ["SENTRY_CONNECTION_TOKEN_INVALID", "Auth token 无效或已失效。"],
    ["SENTRY_CONNECTION_PERMISSION_DENIED", "Auth token 缺少读取事件的权限，请确认已授予 event:read。"],
    ["SENTRY_CONNECTION_RESOURCE_NOT_FOUND", "Organization 或 Project 不存在，或当前 Token 无权访问。"],
    ["SENTRY_CONNECTION_NETWORK", "无法连接 Sentry，请检查网络后重试。"],
    ["SENTRY_CONFIG_ORGANIZATION_REQUIRED", "请先保存 Organization。"],
    ["SENTRY_CONFIG_PROJECT_REQUIRED", "请先保存 Project。"],
    ["SENTRY_SECRET_TOKEN_REQUIRED", "请先保存 Auth token。"],
    ["INTEGRATION_CONNECTION_TEST_UNSUPPORTED", "该 Integration 不支持连接测试。"],
  ])("maps %s without rendering raw error bytes", async (code, message) => {
    render(<IntegrationConnectionTest
      dirty={false}
      integrationId="sentry"
      projectId="project-1"
      onTest={async () => Promise.reject(Object.assign(new Error(`token-value:${code}`), { code }))}
    />);

    fireEvent.click(screen.getByRole("button", { name: "测试已保存配置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText(/token-value/)).not.toBeInTheDocument();
  });

  it("renders manifest sections, keeps advanced settings collapsed, and replaces configured secrets on demand", () => {
    const onEditSecret = vi.fn();
    const { rerender } = render(<IntegrationFields
      config={{ conversationFilterEnabled: true, conversationIds: ["cid-a"] }}
      editingSecrets={{}}
      manifest={groupedManifest}
      secretConfigured={{ clientId: true, clientSecret: true }}
      secretValues={{}}
      onConfigChange={vi.fn()}
      onEditSecret={onEditSecret}
      onSecretChange={vi.fn()}
    />);

    expect(screen.getByRole("heading", { name: "应用凭证" })).toBeVisible();
    expect(screen.getByText("凭证仅保存在这台电脑的系统钥匙串中。")).toBeVisible();
    expect(screen.getAllByText("已配置")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "群聊过滤" })).toBeChecked();
    expect(screen.getByRole("button", { name: "添加群聊" })).toBeVisible();
    expect(screen.queryByLabelText("Client ID")).not.toBeInTheDocument();
    expect(screen.getByText("高级设置").closest("details")).not.toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: "替换 Client ID" }));
    expect(onEditSecret).toHaveBeenCalledWith("clientId", true);
    rerender(<IntegrationFields
      config={{ conversationFilterEnabled: true, conversationIds: ["cid-a"] }}
      editingSecrets={{ clientId: true }}
      manifest={groupedManifest}
      secretConfigured={{ clientId: true, clientSecret: true }}
      secretValues={{}}
      onConfigChange={vi.fn()}
      onEditSecret={onEditSecret}
      onSecretChange={vi.fn()}
    />);
    expect(screen.getByLabelText("Client ID")).toHaveAttribute("type", "password");
  });

  it("shows the group ID editor only while group filtering is enabled", () => {
    const onConfigChange = vi.fn();
    const props = {
      editingSecrets: {},
      manifest: groupedManifest,
      secretConfigured: {},
      secretValues: {},
      onConfigChange,
      onEditSecret: vi.fn(),
      onSecretChange: vi.fn(),
    };
    const { rerender } = render(<IntegrationFields
      {...props}
      config={{ conversationFilterEnabled: false, conversationIds: ["cid-a"] }}
    />);

    expect(screen.getByRole("switch", { name: "群聊过滤" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "添加群聊" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "群聊过滤" }));
    expect(onConfigChange).toHaveBeenCalledWith("conversationFilterEnabled", true);

    rerender(<IntegrationFields
      {...props}
      config={{ conversationFilterEnabled: true, conversationIds: ["cid-a"] }}
    />);
    expect(screen.getByRole("button", { name: "添加群聊" })).toBeVisible();
  });

  it.each([
    [true, { state: "connected" as const }, "已连接"],
    [true, { state: "connecting" as const }, "正在连接"],
    [true, { state: "backoff" as const, lastError: "凭证无效" }, "连接失败，正在重试：凭证无效"],
    [true, { state: "stopped" as const }, "已停用"],
  ])("shows integration health for enabled=%s as %s", (enabled, health, label) => {
    render(<IntegrationHealthStatus enabled={enabled} health={health} />);
    expect(screen.getByRole("status")).toHaveTextContent(label);
  });

  it("omits redundant health when an integration is disabled", () => {
    render(<IntegrationHealthStatus enabled={false} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("hydrates legacy group IDs as an enabled filter", () => {
    render(<ProjectForm
      initial={{
        ...configuredProject,
        integrations: {
          dingtalk: {
            enabled: true,
            config: { conversationIds: ["legacy-group"] },
            secretConfigured: { clientId: true, clientSecret: true },
          },
        },
      }}
      manifests={[groupedManifest]}
      onSave={vi.fn(async () => undefined)}
    />);

    selectTab("DingTalk");
    expect(screen.getByRole("switch", { name: "群聊过滤" })).toBeChecked();
    expect(screen.getByLabelText("群聊 ID 1")).toHaveValue("legacy-group");
  });

  it("activates the integration tab and focuses the first missing required field", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectForm
      initial={{
        ...configuredProject,
        integrations: {
          dingtalk: {
            enabled: true,
            config: { conversationFilterEnabled: true, conversationIds: [] },
            secretConfigured: { clientId: true, clientSecret: true },
          },
        },
      }}
      manifests={[groupedManifest]}
      onSave={onSave}
    />);

    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    expect(await screen.findByText("请至少添加一个群聊 ID")).toBeVisible();
    expect(screen.getByRole("tab", { name: "DingTalk" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: "添加群聊" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "添加群聊" }));
    await waitFor(() => expect(screen.getByLabelText("群聊 ID 1")).toHaveFocus());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects duplicate list values and prunes legacy or blank fields before saving", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectForm
      initial={{
        ...configuredProject,
        integrations: {
          dingtalk: {
            enabled: true,
            config: {
              conversationIds: [" cid-a ", "cid-a"],
              messageRule: "   ",
              mention: "@legacy-bot",
            },
            secretConfigured: { clientId: true, clientSecret: true },
          },
        },
      }}
      manifests={[groupedManifest]}
      onSave={onSave}
    />);

    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    expect(await screen.findByText("群聊 ID不能重复")).toBeVisible();
    fireEvent.change(screen.getByLabelText("群聊 ID 2"), { target: { value: " cid-b " } });
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      integrations: expect.objectContaining({
        dingtalk: expect.objectContaining({ config: { conversationFilterEnabled: true, conversationIds: ["cid-a", "cid-b"] } }),
      }),
    }), {}));
  });

  it("shows persistence failures in a toast instead of an inline alert", async () => {
    render(<ThemeProvider>
      <ProjectForm
        initial={configuredProject}
        manifests={manifests}
        onSave={async () => { throw new Error("浏览器样式预览为只读模式"); }}
      />
      <Toaster />
    </ThemeProvider>);

    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    expect(await screen.findByText("浏览器样式预览为只读模式")).toBeVisible();
    expect(document.querySelector(".project-save-alert")).not.toBeInTheDocument();
  });

  it("shows local branches first, then appends searchable remote branches", async () => {
    let resolveRefresh!: (value: WorkspaceBranchDiscoveryDto) => void;
    const refresh = vi.fn(() => new Promise<WorkspaceBranchDiscoveryDto>((resolve) => {
      resolveRefresh = resolve;
    }));
    render(<GitBranchCombobox
      discovery={{
        localBranches: ["main", "release"],
        remoteBranches: [],
        fetchRemote: { name: "origin", url: "git@example.com:team/repo.git" },
        publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
      }}
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
        fetchRemote: { name: "origin", url: "git@example.com:team/repo.git" },
        publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
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
        publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
        refreshError: "GIT_COMMAND_FAILED:fetch",
      })
      .mockResolvedValueOnce({
        localBranches: ["main"],
        remoteBranches: ["origin/main"],
        publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
      });
    render(<GitBranchCombobox
      discovery={{
        localBranches: ["main"],
        remoteBranches: [],
        fetchRemote: { name: "origin", url: "git@example.com:team/repo.git" },
        publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
      }}
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

  it("opens local-only branch choices without attempting a remote refresh", async () => {
    const refresh = vi.fn();
    render(<GitBranchCombobox
      discovery={{ localBranches: ["main"], remoteBranches: [], publicationRemotes: [] }}
      onChange={vi.fn()}
      onRefresh={refresh}
      value="main"
    />);

    fireEvent.click(screen.getByRole("button", { name: "打开基线分支" }));
    expect(await screen.findByRole("group", { name: "本地分支" })).toHaveTextContent("main");
    expect(screen.queryByText("正在加载远程分支…")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      commands: expect.objectContaining({ evidenceCapture: expected }),
    }), {}));
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
    expect(screen.getByRole("switch", { name: "完成后合并到基线分支" }))
      .not.toBeChecked();
    expect(screen.getByText("当前 Git 仓库未配置远程仓库")).toBeVisible();
    expect(screen.queryByLabelText("远程仓库")).not.toBeInTheDocument();
  });

  it("saves automatic baseline merge as an explicit opt-in", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectForm
      inspection={inspection}
      manifests={manifests}
      workspaceProviders={workspaceProviders}
      onSave={onSave}
    />);

    const trigger = screen.getByRole("combobox", { name: "工作目录方式" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const local = await screen.findByRole("option", { name: "本机目录" });
    fireEvent.keyDown(local, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("option", { name: "Git Worktree" }), { key: "Enter" });
    const merge = await screen.findByRole("switch", { name: "完成后合并到基线分支" });
    expect(merge).not.toBeChecked();

    fireEvent.click(merge);
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      workspace: {
        provider: "git",
        config: {
          baseBranch: "main",
          pushToRemote: false,
          mergeToBaseBranch: true,
        },
      },
    }), {}));
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
      "项目", "Agent", "权限", "命令与验收", "Example source",
    ]);
    selectTab("Example source");
    const enabled = screen.getByRole("switch", { name: "启用" });
    expect(enabled).toHaveAttribute(
      "data-slot",
      "switch",
    );
    expect(enabled).not.toHaveClass("integration-enabled-toggle");
    expect(screen.getByLabelText("Workspace slug")).toHaveValue("acme");
    expect(screen.getByLabelText("Channels 1")).toHaveValue("alerts");
    expect(screen.getByLabelText("Batch size")).toHaveValue(50);
    expect(screen.getByRole("switch", { name: "Include archived" })).toBeChecked();
    expect(screen.getByText("已配置")).toBeVisible();
    expect(screen.getByRole("button", { name: "替换 API token" })).toBeVisible();
    expect(screen.queryByLabelText("API token")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/token/i)).not.toBeInTheDocument();
  });

  it("renders the Sentry and DingTalk brand marks in integration navigation", () => {
    render(<ProjectForm
      initial={configuredProject}
      manifests={[
        { id: "sentry", name: "Sentry", icon: "sentry", configFields: [], secretFields: [] },
        { id: "dingtalk", name: "DingTalk", icon: "dingtalk", configFields: [], secretFields: [] },
      ]}
      onSave={async () => undefined}
    />);

    expect(screen.getByRole("tab", { name: "Sentry" }).querySelector('[data-brand-icon="sentry"]')).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "DingTalk" }).querySelector('[data-brand-icon="dingtalk"]')).toBeInTheDocument();
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
              fetchRemote: { name: "origin", url: "git@example.com:team/checkout.git" },
              publicationRemotes: [{ name: "origin", url: "git@example.com:team/checkout.git" }],
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
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      workspace: {
        provider: "git",
        config: {
          baseBranch: "main",
          pushToRemote: true,
          mergeToBaseBranch: false,
          remote: "origin",
        },
      },
    }), {}));
  });

  it("keeps a configured publication remote separate from the tracked Fetch remote", async () => {
    const onSave = vi.fn(async () => undefined);
    const gitProject: ProjectDto = {
      ...configuredProject,
      workspace: {
        provider: "git",
        config: {
          baseBranch: "main",
          pushToRemote: true,
          remote: "origin",
        },
      },
    };
    render(<ProjectForm
      initial={gitProject}
      inspection={{
        ...inspection,
        workspaces: {
          ...inspection.workspaces,
          git: {
            available: true,
            configPatch: { remote: "upstream" },
            fields: { pushToRemote: { enabled: true } },
            properties: [],
            branches: {
              localBranches: ["main"],
              remoteBranches: ["upstream/main"],
              fetchRemote: { name: "upstream", url: "git@example.com:team/project.git" },
              publicationRemotes: [
                { name: "origin", url: "git@example.com:me/project.git" },
                { name: "upstream", url: "git@example.com:team/project.git" },
              ],
            },
          },
        },
      }}
      manifests={manifests}
      workspaceProviders={workspaceProviders}
      onSave={onSave}
    />);

    expect(screen.getByText("git@example.com:me/project.git")).toBeVisible();
    expect(screen.queryByText("git@example.com:team/project.git")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      workspace: {
        provider: "git",
        config: { baseBranch: "main", pushToRemote: true, remote: "origin" },
      },
    }), {}));
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
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "保存更改" })); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: "Checkout Web",
      path: "/work/checkout",
      agentPlugin: "codex",
      integrations: expect.objectContaining({
        example: expect.objectContaining({ config: expect.objectContaining({ workspace: "new-workspace" }) }),
      }),
    }), {});
  });

  it("keeps invalid project fields visible with inline errors", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectForm inspection={inspection} manifests={manifests} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("本机项目路径"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    const path = await screen.findByLabelText("本机项目路径");
    expect(path).toHaveValue("");
    expect(screen.getByText("请输入本机项目路径")).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows a request error in a toast without clearing the form", async () => {
    render(<ThemeProvider>
      <ProjectForm inspection={inspection} manifests={manifests} onSave={async () => Promise.reject(new Error("目录不可用"))} />
      <Toaster />
    </ThemeProvider>);
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Broken" } });
    const saveButton = screen.getByRole("button", { name: "保存更改" });
    fireEvent.click(saveButton);
    expect(await screen.findByText("目录不可用")).toBeVisible();
    expect(screen.getByLabelText("项目名称")).toHaveValue("Broken");
  });

  it("confirms a successful save beside the persistent action", async () => {
    render(<ProjectForm inspection={inspection} manifests={manifests} onSave={async () => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已保存");
  });

  it("saves project fields and changed secrets through the single persistent action", async () => {
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
    const onSave = vi.fn(async () => saved);
    render(<ProjectForm initial={configuredProject} manifests={manifests} onSave={onSave} />);
    selectTab("Example source");
    fireEvent.click(screen.getByRole("button", { name: "替换 API token" }));
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: "secret-token" } });
    fireEvent.change(screen.getByLabelText("Signing key"), { target: { value: "signing-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "project-1" }), {
      example: { apiToken: "secret-token", signingKey: "signing-key" },
    }));
    expect(await screen.findByText("所有更改已保存")).toBeVisible();
    expect(screen.queryByLabelText("API token")).not.toBeInTheDocument();
  });

  it("keeps secret drafts when the unified save fails", async () => {
    const onSave = vi.fn(async () => Promise.reject(new Error("系统钥匙串不可用")));
    render(<ThemeProvider>
      <ProjectForm initial={configuredProject} manifests={manifests} onSave={onSave} />
      <Toaster />
    </ThemeProvider>);
    selectTab("Example source");
    fireEvent.click(screen.getByRole("button", { name: "替换 API token" }));
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: "secret-token" } });
    const save = screen.getByRole("button", { name: "保存更改" });
    fireEvent.click(save);
    expect(await screen.findByText("系统钥匙串不可用")).toBeVisible();
    expect(screen.getByLabelText("API token")).toHaveValue("secret-token");
  });
});
