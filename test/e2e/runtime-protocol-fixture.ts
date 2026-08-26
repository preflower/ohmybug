import { test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.addInitScript(installRuntimeProtocolFixture);
    await provide(page);
  },
});

export { expect } from "@playwright/test";

function installRuntimeProtocolFixture() {
  const storageKey = "oh-my-bug:e2e-runtime-state";
  type ConfigValue = string | number | boolean | string[];
  interface FixtureIntegration {
    enabled: boolean;
    config: Record<string, ConfigValue>;
    secretConfigured: Record<string, boolean>;
  }
  interface ProjectMutation {
    expectedRevision?: number;
    name?: string;
    key: string;
    path: string;
    instructions?: string;
    commands?: Record<string, string>;
    agent?: { plugin: string };
    integrations?: Record<string, { enabled: boolean; config: Record<string, ConfigValue> }>;
  }
  type SecretPatches = Record<string, Record<string, string | null>>;
  type SaveProjectSettingsInput =
    | { mode: "create"; project: ProjectMutation; secretPatches: SecretPatches }
    | {
      mode: "update";
      id: string;
      expectedRevision: number;
      project: ProjectMutation;
      secretPatches: SecretPatches;
    };
  interface FixtureProject extends Omit<ProjectMutation, "expectedRevision" | "integrations"> {
    id: string;
    integrations: Record<string, FixtureIntegration>;
    revision: number;
    createdAt: string;
    updatedAt: string;
  }
  interface FixtureIssue {
    id: string;
    projectId: string;
    identifier: string;
    title: string;
    titleSource: string;
    status: string;
    inputs: unknown[];
    assessment?: unknown;
    repair?: unknown;
    review?: {
      id: string;
      kind: string;
      choices: Array<{ id: string; label: string } & Record<string, unknown>>;
    } & Record<string, unknown>;
    resolution?: string;
    duplicateOf?: string;
    pauseContext?: {
      operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE" | "RECOVER_FINALIZATION";
      resumeStatus: "ASSESSING" | "REPAIRING" | "EVIDENCE_CAPTURE" | "FINALIZATION_RECOVERY";
      pausedAt: string;
      ready: boolean;
    };
    lastFailure?: { stage: "ASSESSMENT" | "REPAIR"; code: string };
    revision: number;
    createdAt: string;
    updatedAt: string;
  }
  interface ManualInput { projectId: string; commandId: string; content: string; summary?: string }
  type State = { projects: FixtureProject[]; issues: FixtureIssue[] };
  const read = (): State => JSON.parse(localStorage.getItem(storageKey) ?? '{"projects":[],"issues":[]}') as State;
  const write = (state: State) => localStorage.setItem(storageKey, JSON.stringify(state));
  const clone = <T>(value: T): T => structuredClone(value);
  const now = () => new Date().toISOString();
  const manifests = [
    {
      id: "sentry", name: "Sentry", icon: "sentry",
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
        {
          key: "organization", type: "string", label: "Organization",
          description: "Sentry Organization ID 或 slug。", placeholder: "acme",
          required: true, section: "connection",
        },
        {
          key: "project", type: "string", label: "Project",
          description: "Sentry Project ID 或 slug。", placeholder: "checkout",
          required: true, section: "connection",
        },
        {
          key: "environment", type: "string", label: "Environment",
          placeholder: "production", required: false, section: "filters",
        },
        {
          key: "query", type: "string", label: "Query",
          description: "留空时使用 Sentry 默认查询 is:unresolved。",
          placeholder: "is:unresolved level:error", required: false, section: "filters",
        },
      ],
      secretFields: [
        {
          key: "token", label: "Auth token",
          description: "需要 event:read 权限；请勿填写 DSN。", placeholder: "sntrys_…",
          required: true, section: "connection",
        },
      ],
    },
    {
      id: "dingtalk", name: "DingTalk", icon: "dingtalk", description: "从群聊接收 @ 机器人的消息并创建 Issue。",
      sections: [
        { id: "credentials", label: "应用凭证", description: "凭证仅保存在这台电脑的系统钥匙串中。" },
        { id: "rules", label: "接收规则" },
        { id: "advanced", label: "高级设置", description: "关键词过滤与消息归并", collapsed: true },
      ],
      configFields: [
        {
          key: "conversationFilterEnabled",
          type: "boolean",
          label: "群聊过滤",
          description: "开启后仅处理指定群聊；关闭时处理任意群聊中 @ 机器人的消息。",
          required: false,
          defaultValue: false,
          section: "rules",
        },
        {
          key: "conversationIds",
          type: "string[]",
          label: "群聊 ID",
          description: "仅处理来自这些群聊且 @ 机器人的消息。",
          required: true,
          section: "rules",
          addLabel: "添加群聊",
          visibleWhen: { key: "conversationFilterEnabled", equals: true },
        },
        { key: "messageRule", type: "string", label: "消息关键词", required: false, section: "advanced" },
        { key: "threadKeyField", type: "string", label: "消息归并字段", required: false, section: "advanced" },
      ],
      secretFields: [
        { key: "clientId", label: "Client ID", required: true, section: "credentials" },
        { key: "clientSecret", label: "Client Secret", required: true, section: "credentials" },
      ],
    },
  ];
  const projectDto = (input: ProjectMutation, current?: FixtureProject): FixtureProject => ({
    ...current,
    ...input,
    id: current?.id ?? crypto.randomUUID(),
    revision: (current?.revision ?? 0) + 1,
    agent: input.agent ?? current?.agent ?? { plugin: "codex" },
    integrations: Object.fromEntries(Object.entries(input.integrations ?? current?.integrations ?? {}).map(([name, integration]) => [name, {
      enabled: integration.enabled,
      config: clone(integration.config),
      secretConfigured: current?.integrations[name]?.secretConfigured ?? {},
    }])),
    createdAt: current?.createdAt ?? now(),
    updatedAt: now(),
  });
  const saveIssue = (issue: FixtureIssue) => {
    const state = read();
    const index = state.issues.findIndex((candidate) => candidate.id === issue.id);
    if (index === -1) state.issues.unshift(issue);
    else state.issues[index] = issue;
    write(state);
    return clone(issue);
  };
  const requireIssue = (id: string) => {
    const value = read().issues.find((candidate) => candidate.id === id);
    if (!value) throw new Error("ISSUE_NOT_FOUND");
    return value;
  };
  const bridge = {
    listIntegrationPlugins: async () => clone(manifests),
    listWorkspaceProviders: async () => [{ id: "local", name: "本机目录", configFields: [] }],
    listProjects: async () => clone(read().projects),
    inspectProject: async (path: string) => ({
      path,
      name: path.split("/").filter(Boolean).at(-1) ?? "project",
      key: "PROJECT",
      workspaces: { local: { available: true } },
    }),
    getProject: async (id: string) => clone(read().projects.find((project) => project.id === id)),
    saveProjectSettings: async (input: SaveProjectSettingsInput) => {
      const state = read();
      const current = input.mode === "update"
        ? state.projects.find((project) => project.id === input.id)
        : undefined;
      if (input.mode === "update" && !current) throw new Error("PROJECT_NOT_FOUND");
      if (input.mode === "update" && current?.revision !== input.expectedRevision) {
        throw new Error("STALE_PROJECT_REVISION");
      }
      const project = projectDto(input.project, current);
      for (const [pluginId, patch] of Object.entries(input.secretPatches)) {
        const integration = project.integrations[pluginId];
        if (!integration) throw new Error("PROJECT_INTEGRATION_NOT_FOUND");
        for (const [key, value] of Object.entries(patch)) {
          integration.secretConfigured[key] = value !== null;
        }
      }
      if (input.mode === "create") state.projects.push(project);
      else state.projects[state.projects.findIndex((candidate) => candidate.id === input.id)] = project;
      write(state);
      return clone(project);
    },
    createProject: async (input: ProjectMutation) => {
      const state = read();
      const project = projectDto(input);
      state.projects.push(project);
      write(state);
      return clone(project);
    },
    updateProject: async (id: string, input: ProjectMutation) => {
      const state = read();
      const index = state.projects.findIndex((project) => project.id === id);
      if (index < 0) throw new Error("PROJECT_NOT_FOUND");
      const fields = { ...input };
      delete fields.expectedRevision;
      const project = projectDto(fields, state.projects[index]);
      state.projects[index] = project;
      write(state);
      return clone(project);
    },
    setIntegrationSecrets: async (id: string, pluginId: string, patch: Record<string, string | null>) => {
      const state = read();
      const project = state.projects.find((candidate) => candidate.id === id);
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      const integration = project.integrations[pluginId];
      if (!integration) throw new Error("PROJECT_INTEGRATION_NOT_FOUND");
      for (const [key, value] of Object.entries(patch)) integration.secretConfigured[key] = value !== null;
      project.revision += 1;
      project.updatedAt = now();
      write(state);
      return clone(project);
    },
    integrationHealth: async () => Object.fromEntries(read().projects.flatMap((project) =>
      Object.entries(project.integrations).flatMap(([pluginId, integration]) => integration.enabled
        ? [[`${project.id}:${pluginId}`, { state: "connected" }]]
        : []),
    )),
    testSavedIntegration: async (projectId: string, integrationId: string) => {
      const project = read().projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      const integration = project.integrations[integrationId];
      if (!integration) throw new Error("PROJECT_INTEGRATION_NOT_FOUND");
      return {
        title: "连接成功",
        details: [
          { label: "Organization", value: String(integration.config.organization) },
          { label: "Project", value: String(integration.config.project) },
        ],
        testedAt: now(),
      };
    },
    listIssues: async (projectId?: string) => clone(read().issues.filter((candidate) => !projectId || candidate.projectId === projectId)),
    getIssue: async (id: string) => clone(requireIssue(id)),
    getIssueWorkspace: async () => null,
    submitManual: async (input: ManualInput) => {
      const state = read();
      const project = state.projects.find((candidate) => candidate.id === input.projectId);
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      const sequence = state.issues.filter((candidate) => candidate.projectId === project.id).length + 1;
      const timestamp = now();
      const created: FixtureIssue = {
        id: crypto.randomUUID(), projectId: project.id, identifier: `${project.key}-${sequence}`,
        title: input.summary ?? input.content, titleSource: "integration", status: "REVIEW_REQUIRED",
        inputs: [{ id: crypto.randomUUID(), integration: "manual", inputKey: input.commandId, rawData: { content: input.content, summary: input.summary }, data: { content: input.content, ...(input.summary ? { summary: input.summary } : {}) }, receivedAt: timestamp }],
        assessment: { revision: 1, contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", verdict: "BUG", suggestedTitle: input.summary ?? "Checkout returns 500", reasoning: "The fixture reproduced the checkout failure.", rootCause: "Expired sessions are not handled.", solution: "Return a recoverable response." },
        review: {
          id: `assessment:${input.commandId}`,
          kind: "assessment",
          requestedFrom: "ASSESSING",
          payload: { verdict: "BUG" },
          choices: [{ id: "implement", label: "开始实现", continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" } }],
          requestedAt: timestamp,
        },
        revision: 3, createdAt: timestamp, updatedAt: timestamp,
      };
      state.issues.unshift(created);
      write(state);
      return clone(created);
    },
    submitReview: async (id: string, input: { expectedRevision: number; requestId: string; choiceId: string; data?: { title?: string } }) => {
      const current = requireIssue(id);
      if (current.revision !== input.expectedRevision) throw new Error("REVIEW_SUBMISSION_STALE");
      if (!current.review || current.review.id !== input.requestId) throw new Error("REVIEW_REQUEST_STALE");
      if (!current.review.choices.some((choice) => choice.id === input.choiceId)) throw new Error("REVIEW_CHOICE_NOT_FOUND");
      if (current.review.kind === "assessment" && input.choiceId === "implement") {
        const timestamp = now();
        return saveIssue({
          ...current,
          title: input.data?.title ?? current.title,
          titleSource: "user",
          status: "REVIEW_REQUIRED",
          repair: { iteration: 1, delivery: { summary: "Checkout now returns a recoverable response.", evidence: [{ type: "screenshot", evidenceId: `sha256-${"a".repeat(64)}`, label: "Checkout acceptance" }, { type: "recording", evidenceId: `sha256-${"b".repeat(64)}`, label: "Checkout recording" }] } },
          review: {
            id: `delivery:${current.id}:1`,
            kind: "delivery",
            requestedFrom: "EVIDENCE_CHECK",
            payload: { repairIteration: 1, evidenceCount: 2 },
            choices: [{ id: "accept", label: "接受交付", continuation: { operation: "FINALIZE", resumeStatus: "FINALIZING", resolution: "FIXED" } }, { id: "request-changes", label: "要求修改", continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" } }],
            requestedAt: timestamp,
          },
          revision: current.revision + 3,
          updatedAt: timestamp,
        });
      }
      if (current.review.kind === "delivery" && input.choiceId === "accept") {
        return saveIssue({ ...current, status: "COMPLETED", resolution: "FIXED", review: undefined, revision: current.revision + 1, updatedAt: now() });
      }
      throw new Error("REVIEW_CHOICE_UNSUPPORTED");
    },
    approveAssessment: async (id: string, input: { title: string }) => {
      const current = requireIssue(id);
      return saveIssue({ ...current, title: input.title, titleSource: "user", status: "REVIEW_REQUIRED", repair: { iteration: 1, delivery: { summary: "Checkout now returns a recoverable response.", evidence: [{ type: "screenshot", evidenceId: `sha256-${"a".repeat(64)}`, label: "Checkout acceptance" }, { type: "recording", evidenceId: `sha256-${"b".repeat(64)}`, label: "Checkout recording" }] } }, revision: current.revision + 3, updatedAt: now() });
    },
    approveBugAssessment: async (id: string, input: { title: string }) => {
      const current = requireIssue(id);
      return saveIssue({ ...current, title: input.title, titleSource: "user", status: "REVIEW_REQUIRED", repair: { iteration: 1, delivery: { summary: "Checkout now returns a recoverable response.", evidence: [{ type: "screenshot", evidenceId: `sha256-${"a".repeat(64)}`, label: "Checkout acceptance" }, { type: "recording", evidenceId: `sha256-${"b".repeat(64)}`, label: "Checkout recording" }] } }, revision: current.revision + 3, updatedAt: now() });
    },
    confirmNotABug: async (id: string) => saveIssue({ ...requireIssue(id), status: "CLOSED", resolution: "NOT_A_BUG", updatedAt: now() }),
    confirmDuplicate: async (id: string, _reference: unknown, duplicateOf: string) => saveIssue({ ...requireIssue(id), status: "CLOSED", resolution: "DUPLICATE", duplicateOf, updatedAt: now() }),
    requestReassessment: async (id: string) => saveIssue({ ...requireIssue(id), status: "REVIEW_REQUIRED", updatedAt: now() }),
    rejectDelivery: async (id: string) => saveIssue({ ...requireIssue(id), status: "REVIEW_REQUIRED", updatedAt: now() }),
    approveDelivery: async (id: string) => {
      const current = requireIssue(id);
      return { issue: saveIssue({ ...current, status: "COMPLETED", resolution: "FIXED", revision: current.revision + 1, updatedAt: now() }) };
    },
    retryIssue: async (id: string) => clone(requireIssue(id)),
    rebuildAgentSession: async (id: string) => {
      const current = requireIssue(id);
      const stage = current.lastFailure?.stage ?? "ASSESSMENT";
      const next = { ...current, status: stage === "ASSESSMENT" ? "ASSESSING" : "REPAIRING", lastFailure: undefined, revision: current.revision + 1, updatedAt: now() };
      return saveIssue(next);
    },
    pauseIssue: async (id: string) => {
      const current = requireIssue(id);
      const byStatus = {
        ASSESSING: { operation: "ASSESS", resumeStatus: "ASSESSING" },
        REPAIRING: { operation: "REPAIR", resumeStatus: "REPAIRING" },
        EVIDENCE_CAPTURE: { operation: "CAPTURE_EVIDENCE", resumeStatus: "EVIDENCE_CAPTURE" },
        FINALIZATION_RECOVERY: { operation: "RECOVER_FINALIZATION", resumeStatus: "FINALIZATION_RECOVERY" },
      } as const;
      const pauseContext = byStatus[current.status as keyof typeof byStatus];
      if (!pauseContext) throw new Error("PAUSE_NOT_AVAILABLE");
      return saveIssue({
        ...current,
        status: "PAUSED",
        pauseContext: { ...pauseContext, pausedAt: now(), ready: true },
        revision: current.revision + 1,
        updatedAt: now(),
      });
    },
    resumeIssue: async (id: string) => {
      const current = requireIssue(id);
      if (current.status !== "PAUSED" || !current.pauseContext) {
        throw new Error("PAUSE_CONTEXT_REQUIRED");
      }
      const { pauseContext: _pauseContext, ...rest } = current;
      return saveIssue({
        ...rest,
        status: current.pauseContext.resumeStatus,
        revision: current.revision + 1,
        updatedAt: now(),
      });
    },
    cancelIssue: async (id: string) => saveIssue({ ...requireIssue(id), status: "CANCELED", resolution: "CANCELED", updatedAt: now() }),
    readEvidence: async (_issueId: string, requestedEvidenceId: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("CANVAS_CONTEXT_UNAVAILABLE");
      const recording = requestedEvidenceId === `sha256-${"b".repeat(64)}`;
      context.fillStyle = recording ? "#111115" : "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = recording ? "#f2f2f5" : "#1d1d22";
      context.font = "600 40px sans-serif";
      context.fillText("Checkout recovered", 112, 282);
      if (recording) {
        const stream = canvas.captureStream(20);
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm";
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks: Blob[] = [];
        const stopped = new Promise<void>((resolve) => {
          recorder.addEventListener("dataavailable", (event) => { if (event.data.size > 0) chunks.push(event.data); });
          recorder.addEventListener("stop", () => resolve(), { once: true });
        });
        recorder.start(100);
        for (let frame = 0; frame < 20; frame += 1) {
          context.fillStyle = frame % 2 === 0 ? "#4ab98b" : "#716bff";
          context.fillRect(64 + frame * 4, 220, 24, 64);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        recorder.stop();
        await stopped;
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType });
        return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: recorder.mimeType, label: "Checkout recording" };
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG_ENCODING_FAILED")), "image/png"));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: "image/png", label: "Checkout acceptance" };
    },
    openProjectDirectory: async () => ({ canceled: true }),
    subscribeIssueEvents: () => () => undefined,
    onRuntimeState: () => () => undefined,
  };
  Object.defineProperty(window, "ohMyBug", { configurable: false, enumerable: true, value: Object.freeze(bridge) });
}
