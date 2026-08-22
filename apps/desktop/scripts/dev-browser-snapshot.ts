import type { DesktopRuntimeSnapshot } from "@oh-my-bug/runtime";

interface DevelopmentSnapshotLoaderOptions {
  dataRoot: string;
  inspect(options: { dataRoot: string }): Promise<DesktopRuntimeSnapshot>;
  now?: () => string;
}

export function createDevelopmentSnapshotLoader(
  options: DevelopmentSnapshotLoaderOptions,
): () => Promise<DesktopRuntimeSnapshot> {
  return async () => {
    const snapshot = await options.inspect({ dataRoot: options.dataRoot });
    return snapshot.projects.length > 0
      ? snapshot
      : fallbackSnapshot(snapshot, options.dataRoot, options.now?.() ?? new Date().toISOString());
  };
}

function fallbackSnapshot(
  snapshot: DesktopRuntimeSnapshot,
  _dataRoot: string,
  timestamp: string,
): DesktopRuntimeSnapshot {
  const projectId = "dev-style-ohmybug";
  const timestampMs = Date.parse(timestamp);
  const eighteenMinutesAgo = new Date(timestampMs - 18 * 60_000).toISOString();
  const yesterday = new Date(timestampMs - 24 * 60 * 60_000).toISOString();
  const assessment = {
    revision: 1,
    contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    verdict: "BUG" as const,
    suggestedTitle: "结算页内容在窄窗口中溢出",
    reasoning: "较长的错误信息没有正确换行。",
    rootCause: "详情容器缺少最小宽度约束。",
    solution: "允许内容收缩并在单词边界换行。",
  };
  const input = (id: string, content: string) => ({
    id,
    integration: "manual",
    inputKey: id,
    rawData: { content },
    data: { content },
    receivedAt: timestamp,
  });
  const projects: DesktopRuntimeSnapshot["projects"] = [
      {
        id: projectId,
        key: "OHMYBUG",
        name: "ohmybug",
        path: "~/Documents/Workspace/ohmybug",
        commands: { test: "pnpm test", start: "pnpm dev:web" },
        agent: { plugin: "codex" },
        integrations: {
          sentry: { enabled: true, config: {}, secretConfigured: {} },
          dingtalk: { enabled: true, config: {}, secretConfigured: {} },
        },
        workspace: { provider: "local", config: {} },
        revision: 8,
        createdAt: yesterday,
        updatedAt: timestamp,
      },
      {
        id: "dev-style-logistics",
        key: "LOGISTICS",
        name: "logistics-core",
        path: "~/Documents/Workspace/logistics-core",
        commands: { test: "pnpm test" },
        agent: { plugin: "codex" },
        integrations: {
          dingtalk: { enabled: true, config: {}, secretConfigured: {} },
        },
        workspace: { provider: "local", config: {} },
        revision: 5,
        createdAt: yesterday,
        updatedAt: eighteenMinutesAgo,
      },
      {
        id: "dev-style-storefront",
        key: "STOREFRONT",
        name: "storefront",
        path: "~/Documents/Workspace/storefront",
        commands: { test: "pnpm test" },
        agent: { plugin: "codex" },
        integrations: {},
        workspace: { provider: "local", config: {} },
        revision: 3,
        createdAt: yesterday,
        updatedAt: yesterday,
      },
    ];
  return {
    ...snapshot,
    projects,
    projectInspections: Object.fromEntries(projects.map((project) => [project.id, {
      path: project.path,
      name: project.name ?? project.key,
      key: project.key,
      workspaces: {
        local: { available: true },
        git: { available: false, reason: "示例项目未连接本机 Git 仓库" },
      },
    }])),
    issues: [{
      id: "dev-style-issue-assessment",
      projectId,
      identifier: "OHMYBUG-1",
      title: "结算页内容在窄窗口中溢出",
      titleSource: "assessment",
      status: "ASSESSMENT_REVIEW",
      inputs: [input("dev-style-input-1", "窄窗口下错误信息超出详情面板。")],
      assessment,
      revision: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
    }, {
      id: "dev-style-issue-acceptance",
      projectId,
      identifier: "OHMYBUG-2",
      title: "项目设置页底部出现多余留白",
      titleSource: "user",
      status: "ACCEPTANCE_REVIEW",
      inputs: [input("dev-style-input-2", "项目设置页没有填满可用高度。")],
      assessment: {
        ...assessment,
        suggestedTitle: "项目设置页底部出现多余留白",
        reasoning: "工作区高度没有跟随窗口尺寸。",
        rootCause: "页面容器仍使用内容高度。",
        solution: "让工作区占满剩余视口。",
      },
      repair: {
        iteration: 1,
        delivery: {
          summary: "项目设置工作区现在会占满剩余视口。",
          evidence: [{
            type: "screenshot",
            evidenceId: `sha256-${"a".repeat(64)}`,
            label: "项目设置页桌面视口",
          }],
        },
      },
      revision: 6,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    issueEvents: {
      "dev-style-issue-assessment": [{
        id: "dev-style-issue-assessment:1",
        issueId: "dev-style-issue-assessment",
        sequence: 1,
        type: "ISSUE_CREATED",
        actor: "SYSTEM",
        occurredAt: timestamp,
        data: { message: "Issue 已创建。" },
      }],
      "dev-style-issue-acceptance": [{
        id: "dev-style-issue-acceptance:1",
        issueId: "dev-style-issue-acceptance",
        sequence: 1,
        type: "DELIVERY_READY",
        actor: "AGENT",
        occurredAt: timestamp,
        data: { message: "Delivery 已准备验收。" },
      }],
    },
  };
}
