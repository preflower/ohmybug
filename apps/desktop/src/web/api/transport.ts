import type {
  AgentTerminalAvailability,
  CreateProjectInput,
  IntegrationPluginManifest,
  RuntimeOperationInput,
  UpdateProjectInput,
  WorkspaceProviderManifest,
} from "@oh-my-bug/runtime/protocol";

import type { ProjectFormValue } from "../projects/project-form.js";
import type {
  AgentEventDto,
  ApprovalResultDto,
  ApproveAssessmentInput,
  AssessmentReference,
  IntegrationConnectionTestResult,
  IntegrationHealth,
  IssueDto,
  IssueWorkspaceInfoDto,
  ProjectDto,
  ProjectInspection,
  ReviewSubmissionInput,
  WorkspaceBranchDiscoveryDto,
} from "./types.js";

export interface EvidenceSource { url: string; revoke?: () => void }
export type DirectorySelection = { canceled: true } | { canceled: false; inspection: ProjectInspection };

export interface ProductTransport {
  integrationPlugins(): Promise<IntegrationPluginManifest[]>;
  workspaceProviders(): Promise<WorkspaceProviderManifest[]>;
  projects(): Promise<ProjectDto[]>;
  inspectProject(path: string): Promise<ProjectInspection>;
  projectBranches(
    path: string,
    providerId: string,
    refreshRemote: boolean,
  ): Promise<WorkspaceBranchDiscoveryDto>;
  project(id: string): Promise<ProjectDto>;
  createProject(project: ProjectFormValue): Promise<ProjectDto>;
  updateProject(id: string, project: ProjectFormValue): Promise<ProjectDto>;
  saveProjectSettings(
    project: ProjectFormValue,
    secretPatches: Record<string, Record<string, string | null>>,
  ): Promise<ProjectDto>;
  saveIntegrationSecrets(
    id: string,
    pluginId: string,
    patch: Record<string, string | null>,
  ): Promise<ProjectDto>;
  issues(): Promise<IssueDto[]>;
  issue(id: string): Promise<IssueDto>;
  agentTerminalAvailability(issueId: string): Promise<AgentTerminalAvailability>;
  openAgentTerminal(issueId: string): Promise<{ opened: true }>;
  issueWorkspace(id: string): Promise<IssueWorkspaceInfoDto>;
  submitManual(input: {
    projectId: string;
    commandId: string;
    content: string;
    summary?: string;
  }): Promise<IssueDto>;
  submitReview(id: string, input: ReviewSubmissionInput): Promise<IssueDto>;
  approveAssessment(id: string, input: ApproveAssessmentInput): Promise<IssueDto>;
  confirmNotABug(id: string, reference: AssessmentReference): Promise<IssueDto>;
  confirmDuplicate(id: string, reference: AssessmentReference, duplicateOf: string): Promise<IssueDto>;
  requestReassessment(id: string, feedback: string): Promise<IssueDto>;
  rejectDelivery(id: string, feedback: string): Promise<IssueDto>;
  approveDelivery(id: string): Promise<ApprovalResultDto>;
  pause(id: string): Promise<IssueDto>;
  resume(id: string): Promise<IssueDto>;
  cancel(id: string): Promise<IssueDto>;
  retry(id: string): Promise<IssueDto>;
  rebuildSession(id: string, expectedRevision: number): Promise<IssueDto>;
  grantIssueCapabilities(
    id: string,
    expectedRevision: number,
    requestId: string,
  ): Promise<IssueDto>;
  integrationHealth(): Promise<Record<string, IntegrationHealth>>;
  testSavedIntegration(
    projectId: string,
    integrationId: string,
  ): Promise<IntegrationConnectionTestResult>;
  openProjectDirectory(): Promise<DirectorySelection>;
  subscribeIssueEvents(
    id: string,
    cursor: number,
    listener: (events: AgentEventDto[], cursor: number) => void,
  ): () => void;
  evidenceSource(issueId: string, evidenceId: string): Promise<EvidenceSource>;
}

export function createProjectPayload(project: ProjectFormValue): CreateProjectInput {
  return {
    name: project.name,
    key: project.key,
    path: project.path,
    ...(project.instructions ? { instructions: project.instructions } : {}),
    commands: project.commands,
    agent: { plugin: project.agentPlugin },
    workspace: project.workspace,
    integrations: Object.fromEntries(
      Object.entries(project.integrations).map(([pluginId, integration]) => [
        pluginId,
        { enabled: integration.enabled, config: integration.config },
      ]),
    ),
  };
}

export function updateProjectPayload(project: ProjectFormValue): UpdateProjectInput {
  if (!project.revision) throw new Error("PROJECT_REVISION_REQUIRED");
  return { ...createProjectPayload(project), expectedRevision: project.revision };
}

export function saveProjectSettingsPayload(
  project: ProjectFormValue,
  secretPatches: Record<string, Record<string, string | null>>,
): RuntimeOperationInput<"saveProjectSettings"> {
  const payload = { project: createProjectPayload(project), secretPatches };
  if (!project.id) return { mode: "create", ...payload };
  if (!project.revision) throw new Error("PROJECT_REVISION_REQUIRED");
  return {
    mode: "update",
    id: project.id,
    expectedRevision: project.revision,
    ...payload,
  };
}
