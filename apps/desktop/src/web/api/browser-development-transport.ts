import type { IntegrationPluginManifest, WorkspaceProviderManifest } from "@oh-my-bug/runtime/protocol";

import type {
  AgentEventDto,
  IntegrationHealth,
  IssueDto,
  IssueWorkspaceInfoDto,
  ProjectDto,
  ProjectInspection,
} from "./types.js";
import type { ProductTransport } from "./transport.js";

export interface DevelopmentSnapshot {
  integrationPlugins: IntegrationPluginManifest[];
  workspaceProviders?: WorkspaceProviderManifest[];
  projectInspections?: Record<string, ProjectInspection>;
  projects: ProjectDto[];
  issues: IssueDto[];
  issueWorkspaces?: Record<string, Exclude<IssueWorkspaceInfoDto, null>>;
  issueEvents: Record<string, AgentEventDto[]>;
  integrationHealth: Record<string, IntegrationHealth>;
}

export type DevelopmentSnapshotFetch = (
  input: RequestInfo | URL,
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function createBrowserDevelopmentTransport(
  fetchSnapshot: DevelopmentSnapshotFetch,
): ProductTransport {
  let snapshotTask: Promise<DevelopmentSnapshot> | undefined;
  const snapshot = () => {
    snapshotTask ??= fetchSnapshot("/api/dev/snapshot").then(async (response) => {
      if (!response.ok) throw new Error("DEV_SNAPSHOT_UNAVAILABLE");
      return await response.json() as DevelopmentSnapshot;
    });
    return snapshotTask;
  };
  const readOnly = (): Promise<never> => {
    const error = Object.assign(new Error("浏览器样式预览为只读模式"), {
      code: "DEV_BROWSER_READ_ONLY",
    });
    return Promise.reject(error);
  };
  return {
    integrationPlugins: async () => (await snapshot()).integrationPlugins,
    workspaceProviders: async () => (await snapshot()).workspaceProviders ?? [{
      id: "local",
      name: "本机目录",
      configFields: [],
    }],
    projects: async () => (await snapshot()).projects,
    inspectProject: async (path) => {
      const project = (await snapshot()).projects.find((candidate) => candidate.path === path);
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      const inspected = (await snapshot()).projectInspections?.[project.id];
      if (inspected) return inspected;
      return {
        path: project.path,
        name: project.name ?? project.key,
        key: project.key,
        workspaces: {},
      };
    },
    projectBranches: async (path, providerId) => {
      const value = await snapshot();
      const project = value.projects.find((candidate) => candidate.path === path);
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      const discovery = value.projectInspections?.[project.id]
        ?.workspaces[providerId]?.branches;
      if (!discovery) {
        throw new Error(`WORKSPACE_BRANCH_DISCOVERY_NOT_AVAILABLE:${providerId}`);
      }
      return discovery;
    },
    project: async (id) => {
      const project = (await snapshot()).projects.find((candidate) => candidate.id === id);
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      return project;
    },
    createProject: readOnly,
    updateProject: readOnly,
    saveProjectSettings: readOnly,
    saveIntegrationSecrets: readOnly,
    issues: async () => (await snapshot()).issues,
    issue: async (id) => {
      const issue = (await snapshot()).issues.find((candidate) => candidate.id === id);
      if (!issue) throw new Error("ISSUE_NOT_FOUND");
      return issue;
    },
    issueWorkspace: async (id) => (await snapshot()).issueWorkspaces?.[id] ?? null,
    submitManual: readOnly,
    approveAssessment: readOnly,
    confirmNotABug: readOnly,
    confirmDuplicate: readOnly,
    requestReassessment: readOnly,
    rejectDelivery: readOnly,
    approveDelivery: readOnly,
    cancel: readOnly,
    retry: readOnly,
    rebuildSession: readOnly,
    grantIssueCapabilities: readOnly,
    integrationHealth: async () => (await snapshot()).integrationHealth,
    openProjectDirectory: async () => ({ canceled: true }),
    subscribeIssueEvents: (id, cursor, listener) => {
      let active = true;
      void snapshot().then((value) => {
        if (!active) return;
        const events = (value.issueEvents?.[id] ?? []).filter((event) => event.sequence > cursor);
        if (events.length > 0) listener(events, events.at(-1)!.sequence);
      }).catch(() => undefined);
      return () => { active = false; };
    },
    evidenceSource: readOnly,
  };
}
