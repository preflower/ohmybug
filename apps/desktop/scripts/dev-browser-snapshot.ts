import type { DesktopRuntimeSnapshot } from "@oh-my-bug/runtime";

interface DevelopmentBrowserSnapshot extends DesktopRuntimeSnapshot {
  evidenceSources?: Record<string, string>;
}

interface DevelopmentSnapshotLoaderOptions {
  dataRoot: string;
  inspect(options: { dataRoot: string }): Promise<DesktopRuntimeSnapshot>;
  now?: () => string;
}

export function createDevelopmentSnapshotLoader(
  options: DevelopmentSnapshotLoaderOptions,
): () => Promise<DevelopmentBrowserSnapshot> {
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
): DevelopmentBrowserSnapshot {
  const projectId = "dev-style-ohmybug";
  const timestampMs = Date.parse(timestamp);
  const evidenceId = `sha256-${"a".repeat(64)}`;
  const evidencePreview = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">
      <rect width="1200" height="675" fill="#f7f7f9"/>
      <rect x="28" y="28" width="1144" height="619" rx="18" fill="#ffffff" stroke="#dedee7"/>
      <rect x="28" y="28" width="220" height="619" rx="18" fill="#f0f0f5"/>
      <rect x="276" y="62" width="420" height="24" rx="8" fill="#20202a"/>
      <rect x="276" y="112" width="850" height="14" rx="7" fill="#d8d8e1"/>
      <rect x="276" y="158" width="850" height="182" rx="14" fill="#f7f7fa" stroke="#dedee7"/>
      <rect x="304" y="188" width="300" height="18" rx="7" fill="#68687a"/>
      <rect x="304" y="226" width="760" height="12" rx="6" fill="#c9c9d4"/>
      <rect x="304" y="254" width="690" height="12" rx="6" fill="#c9c9d4"/>
      <rect x="276" y="370" width="850" height="230" rx="14" fill="#171922"/>
      <rect x="304" y="402" width="430" height="12" rx="6" fill="#a8a8b8"/>
      <rect x="304" y="432" width="680" height="12" rx="6" fill="#77798b"/>
      <rect x="304" y="462" width="590" height="12" rx="6" fill="#77798b"/>
      <circle cx="84" cy="82" r="16" fill="#665cff"/>
      <rect x="116" y="72" width="98" height="20" rx="7" fill="#85859a"/>
    </svg>
  `)}`;
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
          sentry: {
            enabled: true,
            config: { organization: "acme", project: "checkout" },
            secretConfigured: { token: true },
          },
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
      status: "REVIEW_REQUIRED",
      inputs: [input("dev-style-input-1", "窄窗口下错误信息超出详情面板。")],
      assessment,
      review: {
        id: "dev-style-review-assessment",
        kind: "assessment",
        requestedFrom: "ASSESSING",
        payload: { verdict: "BUG" },
        choices: [{
          id: "implement",
          label: "开始实现",
          continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
        }, {
          id: "reassess",
          label: "要求重新分析",
          feedbackRequired: true,
          continuation: { operation: "ASSESS", resumeStatus: "ASSESSING" },
        }],
        requestedAt: timestamp,
      },
      revision: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
    }, {
      id: "dev-style-issue-acceptance",
      projectId,
      identifier: "OHMYBUG-2",
      title: "项目设置页底部出现多余留白",
      titleSource: "user",
      status: "REVIEW_REQUIRED",
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
        deliveryDraft: {
          summary: "项目设置工作区现在会占满剩余视口。",
          repairIteration: 1,
          implementationCompletedAt: timestamp,
          integration: {
            baseBranch: "main",
            baseCommit: "a".repeat(40),
            issueBranch: "ohmybug/ohmybug-2",
            issueCommit: "d34db33f1234567890abcdef1234567890abcdef",
            conflicts: [],
            verification: [],
          },
        },
        delivery: {
          summary: "项目设置工作区现在会占满剩余视口。",
          evidence: [{
            type: "screenshot",
            evidenceId,
            label: "项目设置页桌面视口",
          }],
        },
      },
      review: {
        id: "dev-style-review-delivery",
        kind: "delivery",
        requestedFrom: "EVIDENCE_CHECK",
        payload: { repairIteration: 1, evidenceCount: 1 },
        choices: [{
          id: "accept",
          label: "接受交付",
          continuation: { operation: "FINALIZE", resumeStatus: "FINALIZING", resolution: "FIXED" },
        }, {
          id: "request-changes",
          label: "要求修改",
          feedbackRequired: true,
          continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
        }],
        requestedAt: timestamp,
      },
      revision: 6,
      createdAt: timestamp,
      updatedAt: timestamp,
    }, {
      id: "dev-style-issue-terminal",
      projectId,
      identifier: "OHMYBUG-3",
      title: "Issue 详情底部操作栏没有贴底",
      titleSource: "assessment",
      status: "REPAIRING",
      inputs: [input("dev-style-input-3", "内容较少时，Issue 详情底部操作栏浮在页面中间。")],
      agentSession: { agent: "codex", sessionId: "dev-style-session-terminal" },
      assessment: {
        ...assessment,
        suggestedTitle: "Issue 详情底部操作栏没有贴底",
        reasoning: "详情内容不足一屏时，操作栏没有占据容器底部位置。",
        rootCause: "详情滚动区域没有撑满工作区剩余高度。",
        solution: "让内容区占据剩余空间，并将操作栏保持在详情容器底部。",
      },
      repair: { iteration: 1 },
      revision: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    issueWorkspaces: {
      "dev-style-issue-assessment": { providerId: "git", status: "READY", branch: "ohmybug/ohmybug-1" },
      "dev-style-issue-acceptance": { providerId: "git", status: "READY", branch: "ohmybug/ohmybug-2" },
      "dev-style-issue-terminal": { providerId: "git", status: "READY", branch: "ohmybug/ohmybug-3" },
    },
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
      "dev-style-issue-terminal": [{
        id: "dev-style-issue-terminal:1",
        issueId: "dev-style-issue-terminal",
        sequence: 1,
        type: "AGENT_TURN_STARTED",
        actor: "AGENT",
        occurredAt: timestamp,
        data: { logicalSessionId: "dev-style-session-terminal", message: "Codex 开始实现" },
      }, {
        id: "dev-style-issue-terminal:2",
        issueId: "dev-style-issue-terminal",
        sequence: 2,
        type: "AGENT_FILES_CHANGED",
        actor: "AGENT",
        occurredAt: timestamp,
        data: { logicalSessionId: "dev-style-session-terminal", message: "正在检查详情页布局与现有样式" },
      }, {
        id: "dev-style-issue-terminal:3",
        issueId: "dev-style-issue-terminal",
        sequence: 3,
        type: "AGENT_COMMAND_STARTED",
        actor: "AGENT",
        occurredAt: timestamp,
        data: {
          logicalSessionId: "dev-style-session-terminal",
          correlationId: "dev-style-command-1",
          message: "运行目标测试",
          detail: "$ pnpm --filter @oh-my-bug/desktop test\nTest Files 41 passed\nTests 298 passed",
        },
      }, {
        id: "dev-style-issue-terminal:4",
        issueId: "dev-style-issue-terminal",
        sequence: 4,
        type: "AGENT_FILES_CHANGED",
        actor: "AGENT",
        occurredAt: timestamp,
        data: { logicalSessionId: "dev-style-session-terminal", message: "已更新 Issue 详情布局，正在验证页面" },
      }],
    },
    evidenceSources: { [evidenceId]: evidencePreview },
  };
}
