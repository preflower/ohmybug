import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CodexAppServerRuntimeHost,
  type AgentTerminalAvailability,
  type AgentTerminalLaunchTarget,
  type TerminalSessionContext,
} from "@oh-my-bug/agent-codex";
import type {
  AgentAdapter,
  AgentPlugin,
  IntegrationHealth,
  IntegrationPluginManifest,
  Issue,
  IssueEvent,
  RuntimeProject,
} from "@oh-my-bug/core";
import { dingTalkPlugin, type DingTalkPluginOptions } from "@oh-my-bug/integration-dingtalk";
import { ManualIntegrationAdapter } from "@oh-my-bug/integration-manual";
import { sentryPlugin, type SentryPluginOptions } from "@oh-my-bug/integration-sentry";
import { gitWorkspaceFactory } from "@oh-my-bug/workspace-git";
import { localWorkspaceFactory } from "@oh-my-bug/workspace-local";
import {
  LocalEvidenceStore,
  LocalSecretStore,
  MemorySecretStore,
  openRuntimeDatabase,
  openRuntimeDatabaseReadOnly,
  SqliteAgentSessionStore,
  SqliteIntegrationCheckpointStore,
  SqliteRuntimeStore,
  SqliteWorkspaceStore,
  type SecretStore,
} from "@oh-my-bug/storage";

import { AgentRegistry } from "./agents/registry.js";
import type { EvidenceCaptureProvider } from "./evidence/capture-provider.js";
import { PlaywrightEvidenceCaptureProvider } from "./evidence/playwright-capture-provider.js";
import { IntegrationManager } from "./integrations/manager.js";
import { IntegrationRegistry } from "./integrations/registry.js";
import { RuntimeLifecycleHooks } from "./modules/lifecycle-hooks.js";
import { ModuleHost } from "./modules/module-host.js";
import { WorkspaceRegistry } from "./modules/workspace-registry.js";
import { workspaceModule } from "./modules/workspace-module.js";
import { RuntimeCommands } from "./orchestration/commands.js";
import { IssueOperationCoordinator } from "./orchestration/issue-operation-coordinator.js";
import { WorkspaceCoordinator } from "./orchestration/workspace-coordinator.js";
import { OhMyBugRuntime } from "./runtime.js";
import { RuntimeService } from "./service.js";
import type {
  IssueWorkspaceInfo,
  ProductProject,
  ProjectInspection,
  WorkspaceProviderManifest,
} from "./protocol/types.js";
import { demoAgent } from "./testing/demo-agent.js";
import { readIssueWorkspaceInfo } from "./workspaces/issue-workspace-info.js";

export interface CreateRuntimeOptions {
  databasePath: string;
  evidenceRoot?: string;
  agent?: AgentAdapter;
  evidenceCapture?: EvidenceCaptureProvider;
  id?: () => string;
  now?: () => string;
}

export interface DesktopRuntimeOverrides {
  agentPlugin?: AgentPlugin;
  secrets?: SecretStore;
  sentry?: SentryPluginOptions;
  dingTalk?: DingTalkPluginOptions;
  evidenceCapture?: EvidenceCaptureProvider;
  id?: () => string;
  now?: () => string;
}

export interface CreateDesktopRuntimeOptions {
  dataRoot: string;
  overrides?: DesktopRuntimeOverrides;
}

export interface InspectDesktopRuntimeOptions {
  dataRoot: string;
}

export interface DesktopRuntimeSummary {
  projects: number;
  integrations: number;
}

export interface DesktopRuntimeSnapshot {
  integrationPlugins: IntegrationPluginManifest[];
  workspaceProviders: WorkspaceProviderManifest[];
  projectInspections: Record<string, ProjectInspection>;
  projects: ProductProject[];
  issues: Issue[];
  issueWorkspaces: Record<string, IssueWorkspaceInfo>;
  issueEvents: Record<string, IssueEvent[]>;
  integrationHealth: Record<string, IntegrationHealth>;
}

export interface RuntimeComposition {
  runtime: OhMyBugRuntime;
  store: SqliteRuntimeStore;
  agents: AgentRegistry;
  integrations: IntegrationManager;
  integrationRegistry: IntegrationRegistry;
  evidence: LocalEvidenceStore;
  secrets: SecretStore;
  workspacePersistence: SqliteWorkspaceStore;
  workspaceRegistry: WorkspaceRegistry;
  agentSessions: SqliteAgentSessionStore;
  agentTerminal?: {
    availability(context: TerminalSessionContext): AgentTerminalAvailability;
    resolveLaunchTarget(context: TerminalSessionContext): AgentTerminalLaunchTarget;
  };
}

export interface RuntimeApplication {
  runtime: OhMyBugRuntime;
  service: RuntimeService;
}

export function createRuntime(options: CreateRuntimeOptions): OhMyBugRuntime {
  const plugin: AgentPlugin | undefined = options.agent
    ? { id: "fake", create: () => options.agent! }
    : undefined;
  const agentHost = plugin ? undefined : new CodexAppServerRuntimeHost({
    dataRoot: dirname(options.databasePath),
  });
  return createRuntimeComposition({
    databasePath: options.databasePath,
    evidenceRoot: options.evidenceRoot ?? join(dirname(options.databasePath), "evidence"),
    agentPlugins: [plugin ?? agentHost!.plugin],
    agentRuntime: agentHost,
    agentTerminal: agentHost,
    integrationRegistry: new IntegrationRegistry([]),
    secrets: new MemorySecretStore(),
    id: options.id,
    now: options.now,
    evidenceCapture: options.evidenceCapture,
  }).runtime;
}

export async function inspectDesktopRuntime(
  options: InspectDesktopRuntimeOptions,
): Promise<DesktopRuntimeSummary> {
  if (!options.dataRoot.trim()) throw new Error("DATA_ROOT_REQUIRED");
  const databasePath = join(options.dataRoot, "runtime.sqlite");
  try {
    await access(databasePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { projects: 0, integrations: 0 };
    }
    throw error;
  }
  const store = new SqliteRuntimeStore(openRuntimeDatabaseReadOnly(databasePath));
  try {
    const projects = store.listProjects();
    return {
      projects: projects.length,
      integrations: projects.reduce((count, project) => count + enabledIntegrationCount(project), 0),
    };
  } finally {
    store.close();
  }
}

export async function inspectDesktopRuntimeSnapshot(
  options: InspectDesktopRuntimeOptions,
): Promise<DesktopRuntimeSnapshot> {
  if (!options.dataRoot.trim()) throw new Error("DATA_ROOT_REQUIRED");
  const integrationRegistry = new IntegrationRegistry([sentryPlugin(), dingTalkPlugin()]);
  const workspaceRegistry = new WorkspaceRegistry();
  workspaceRegistry.register(localWorkspaceFactory);
  const gitManifest = gitWorkspaceFactory({
    state: { get: () => undefined, set: () => undefined, delete: () => undefined },
    worktreeRoot: join(options.dataRoot, "worktrees"),
  }).manifest;
  const empty = (): DesktopRuntimeSnapshot => ({
    integrationPlugins: integrationRegistry.manifests(),
    workspaceProviders: [localWorkspaceFactory.manifest, gitManifest],
    projectInspections: {},
    projects: [],
    issues: [],
    issueWorkspaces: {},
    issueEvents: {},
    integrationHealth: {},
  });
  const databasePath = join(options.dataRoot, "runtime.sqlite");
  try {
    await access(databasePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return empty();
    }
    throw error;
  }
  const database = openRuntimeDatabaseReadOnly(databasePath);
  const store = new SqliteRuntimeStore(database);
  const workspacePersistence = new SqliteWorkspaceStore(database);
  workspaceRegistry.register(gitWorkspaceFactory({
    state: workspacePersistence,
    worktreeRoot: join(options.dataRoot, "worktrees"),
  }));
  try {
    const issues = store.listIssues();
    const projects = store.listProjects().map((project) => snapshotProject(
      project,
      integrationRegistry,
      workspacePersistence,
      workspaceRegistry,
    ));
    const projectInspections = Object.fromEntries(await Promise.all(projects.map(async (project) => [
      project.id,
      {
        path: project.path,
        name: project.name ?? project.key,
        key: project.key,
        workspaces: await workspaceRegistry.inspectProject(project.path),
      },
    ])));
    const issueWorkspaceEntries = await Promise.all(issues.map(async (issue) => {
      const info = await readIssueWorkspaceInfo({
        issue,
        persistence: workspacePersistence,
        registry: workspaceRegistry,
      });
      return info ? [issue.id, info] as const : undefined;
    }));
    const issueWorkspaces = Object.fromEntries(issueWorkspaceEntries.filter(
      (entry): entry is readonly [string, IssueWorkspaceInfo] => Boolean(entry),
    ));
    return {
      integrationPlugins: integrationRegistry.manifests(),
      workspaceProviders: workspaceRegistry.manifests(),
      projectInspections,
      projects,
      issues,
      issueWorkspaces,
      issueEvents: Object.fromEntries(issues.map((issue) => [issue.id, store.readEvents(issue.id)])),
      integrationHealth: {},
    };
  } finally {
    store.close();
  }
}

export function createDesktopRuntimeComposition(
  options: CreateDesktopRuntimeOptions,
  useDemoAgent = false,
  demoDelayMs = 0,
  demoUnavailableOnce = false,
): RuntimeComposition {
  if (!options.dataRoot.trim()) throw new Error("DATA_ROOT_REQUIRED");
  const overrides = options.overrides ?? {};
  const integrationRegistry = new IntegrationRegistry([
    sentryPlugin(overrides.sentry),
    dingTalkPlugin(overrides.dingTalk),
  ]);
  const agentHost = !overrides.agentPlugin && !useDemoAgent
    ? new CodexAppServerRuntimeHost({ dataRoot: options.dataRoot })
    : undefined;
  return createRuntimeComposition({
    databasePath: join(options.dataRoot, "runtime.sqlite"),
    evidenceRoot: join(options.dataRoot, "evidence"),
    agentPlugins: [overrides.agentPlugin ?? (useDemoAgent
      ? demoAgent({
          agentId: "codex",
          delayMs: demoDelayMs,
          unavailableOnce: demoUnavailableOnce,
          now: () => new Date(overrides.now?.() ?? Date.now()),
        })
      : agentHost!.plugin)],
    agentRuntime: agentHost,
    agentTerminal: agentHost,
    integrationRegistry,
    secrets: overrides.secrets ?? new LocalSecretStore(),
    id: overrides.id,
    now: overrides.now,
    evidenceCapture: overrides.evidenceCapture,
  });
}

export function createRuntimeApplication(
  options: CreateDesktopRuntimeOptions,
  useDemoAgent = false,
  demoDelayMs = 0,
  demoUnavailableOnce = false,
): RuntimeApplication {
  const composition = createDesktopRuntimeComposition(
    options,
    useDemoAgent,
    demoDelayMs,
    demoUnavailableOnce,
  );
  return {
    runtime: composition.runtime,
    service: new RuntimeService({
      runtime: composition.runtime,
      store: composition.store,
      secrets: composition.secrets,
      evidence: composition.evidence,
      integrations: composition.integrations,
      integrationRegistry: composition.integrationRegistry,
      workspacePersistence: composition.workspacePersistence,
      workspaceRegistry: composition.workspaceRegistry,
      agentSessions: composition.agentSessions,
      agentTerminal: composition.agentTerminal,
      id: options.overrides?.id ?? randomUUID,
      now: options.overrides?.now ?? (() => new Date().toISOString()),
    }),
  };
}

interface InternalCompositionOptions {
  databasePath: string;
  evidenceRoot: string;
  agentPlugins: AgentPlugin[];
  agentRuntime?: { start(): Promise<void>; stop(): Promise<void> };
  agentTerminal?: RuntimeComposition["agentTerminal"];
  integrationRegistry: IntegrationRegistry;
  secrets: SecretStore;
  id?: () => string;
  now?: () => string;
  evidenceCapture?: EvidenceCaptureProvider;
}

function createRuntimeComposition(options: InternalCompositionOptions): RuntimeComposition {
  const id = options.id ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  const database = openRuntimeDatabase(options.databasePath);
  const store = new SqliteRuntimeStore(database, { id, now });
  const sessions = new SqliteAgentSessionStore(database);
  const checkpoints = new SqliteIntegrationCheckpointStore(database);
  const workspacePersistence = new SqliteWorkspaceStore(database);
  const workspaceRegistry = new WorkspaceRegistry();
  const hooks = new RuntimeLifecycleHooks();
  const modules = new ModuleHost();
  modules.mount(workspaceModule, {
    factory: localWorkspaceFactory,
    registry: workspaceRegistry,
  });
  modules.mount(workspaceModule, {
    factory: gitWorkspaceFactory({
      state: workspacePersistence,
      worktreeRoot: join(dirname(options.databasePath), "worktrees"),
    }),
    registry: workspaceRegistry,
  });
  const workspaceCoordinator = new WorkspaceCoordinator({
    store,
    persistence: workspacePersistence,
    registry: workspaceRegistry,
    hooks,
    id,
    now,
  });
  const evidence = new LocalEvidenceStore(options.evidenceRoot);
  const agents = new AgentRegistry(options.agentPlugins, {
    sessions,
    reportActivity: async (activity) => {
      const session = await sessions.get(activity.sessionId);
      if (!session) return;
      store.transaction((tx) => tx.appendEvent({
        id: id(),
        issueId: session.issueId,
        type: activity.type,
        actor: "AGENT",
        occurredAt: now(),
        data: {
          logicalSessionId: activity.sessionId,
          message: activity.message,
          stage: activity.stage,
          level: activity.level,
          ...(activity.detail ? { detail: activity.detail } : {}),
          ...(activity.correlationId ? { correlationId: activity.correlationId } : {}),
        },
      }));
    },
  });
  const manual = new ManualIntegrationAdapter({ id, now: () => new Date(now()) });
  const operations = new IssueOperationCoordinator();
  let wake: () => void = () => undefined;
  const commands = new RuntimeCommands({
    store,
    manual,
    agents,
    hooks,
    id,
    now,
    wake: () => wake(),
    operations,
  });
  const integrations = new IntegrationManager({
    registry: options.integrationRegistry,
    secrets: options.secrets,
    checkpoints,
    onInput: async (projectId, input) => {
      commands.acceptIntegrationInput(projectId, input);
    },
    id,
    now: () => new Date(now()),
  });
  const runtime = new OhMyBugRuntime({
    commands,
    store,
    agents,
    evidence,
    capture: options.evidenceCapture ?? new PlaywrightEvidenceCaptureProvider(),
    workspaces: workspaceCoordinator,
    hooks,
    integrations,
    modules,
    id,
    now,
    operations,
    agentRuntime: options.agentRuntime,
  });
  wake = () => runtime.kick();
  return {
    runtime,
    store,
    agents,
    integrations,
    integrationRegistry: options.integrationRegistry,
    evidence,
    secrets: options.secrets,
    workspacePersistence,
    workspaceRegistry,
    agentSessions: sessions,
    agentTerminal: options.agentTerminal,
  };
}

function enabledIntegrationCount(project: RuntimeProject): number {
  return Object.values(project.integrations ?? {})
    .filter((configuration) => configuration.enabled).length;
}

function snapshotProject(
  project: RuntimeProject,
  integrationRegistry: IntegrationRegistry,
  workspacePersistence: SqliteWorkspaceStore,
  workspaceRegistry: WorkspaceRegistry,
): ProductProject {
  const integrations = project.integrations
    ? Object.fromEntries(Object.entries(project.integrations).map(([id, configuration]) => {
        const plugin = integrationRegistry.get(id);
        const secretKeys = plugin
          ? plugin.manifest.secretFields.map((field) => field.key)
          : Object.keys(configuration.secretRefs);
        return [id, {
          enabled: configuration.enabled,
          config: structuredClone(configuration.config),
          secretConfigured: Object.fromEntries(
            secretKeys.map((key) => [key, Boolean(configuration.secretRefs[key])]),
          ),
          ...(!plugin ? { unavailable: `PLUGIN_NOT_INSTALLED:${id}` } : {}),
        }];
      }))
    : undefined;
  const workspace = workspacePersistence.getProjectConfiguration(project.id)
    ?? { provider: "local", config: {} };
  return {
    id: project.id,
    key: project.key,
    path: project.path,
    revision: project.revision ?? 1,
    createdAt: project.createdAt ?? new Date(0).toISOString(),
    updatedAt: project.updatedAt ?? new Date(0).toISOString(),
    ...(project.name ? { name: project.name } : {}),
    ...(project.instructions !== undefined ? { instructions: project.instructions } : {}),
    permissionMode: project.permissionMode ?? "request-approval",
    ...(project.commands ? { commands: project.commands } : {}),
    ...(project.agent ? { agent: project.agent } : {}),
    ...(integrations ? { integrations } : {}),
    workspace: {
      provider: workspace.provider,
      config: structuredClone(workspace.config),
      ...(!workspaceRegistry.has(workspace.provider)
        ? { unavailable: `WORKSPACE_PROVIDER_NOT_AVAILABLE:${workspace.provider}` }
        : {}),
    },
  };
}
