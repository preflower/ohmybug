import type {
  ConfigValue,
  IntegrationHealth,
  IntegrationPluginManifest,
  Issue,
  IssueEvent,
  ReviewSubmission,
  ProjectAgentConfiguration,
  ProjectCommands,
} from "@oh-my-bug/core";
import type {
  BranchInfo,
  WorkspaceBranchDiscovery,
  WorkspaceBinding,
  WorkspaceProjectConfiguration,
  WorkspaceProviderInspection,
  WorkspaceProviderManifest,
} from "@oh-my-bug/module-api";

export type { ConfigValue, IntegrationHealth, IntegrationPluginManifest } from "@oh-my-bug/core";
export type { BranchInfo, WorkspaceProjectConfiguration, WorkspaceProviderManifest } from "@oh-my-bug/module-api";
export type { WorkspaceProviderInspection } from "@oh-my-bug/module-api";

export type RuntimeHealth = {
  state: "starting" | "ready" | "stopping" | "stopped";
};

export interface ProjectInspection {
  path: string;
  name: string;
  key: string;
  workspaces: Record<string, WorkspaceProviderInspection>;
}

export interface ProjectIntegrationInput {
  enabled: boolean;
  config: Record<string, ConfigValue>;
}

export interface ProductIntegrationConfiguration extends ProjectIntegrationInput {
  secretConfigured: Record<string, boolean>;
  unavailable?: string;
}

export interface ProductWorkspaceConfiguration extends WorkspaceProjectConfiguration {
  unavailable?: string;
}

export interface ProductProject {
  id: string;
  key: string;
  name?: string;
  path: string;
  instructions?: string;
  commands?: ProjectCommands;
  agent?: ProjectAgentConfiguration;
  integrations?: Record<string, ProductIntegrationConfiguration>;
  workspace: ProductWorkspaceConfiguration;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  path: string;
  key: string;
  name?: string;
  instructions?: string;
  commands?: ProjectCommands;
  agent?: ProjectAgentConfiguration;
  integrations?: Record<string, ProjectIntegrationInput>;
  workspace?: WorkspaceProjectConfiguration;
}

export interface UpdateProjectInput extends Partial<CreateProjectInput> {
  expectedRevision: number;
}

export type IntegrationSecretPatches = Record<string, Record<string, string | null>>;

export type SaveProjectSettingsInput =
  | {
      mode: "create";
      project: CreateProjectInput;
      secretPatches: IntegrationSecretPatches;
    }
  | {
      mode: "update";
      id: string;
      expectedRevision: number;
      project: CreateProjectInput;
      secretPatches: IntegrationSecretPatches;
    };

export interface ManualIssueCommand {
  projectId: string;
  commandId: string;
  content: string;
  summary?: string;
  context?: Record<string, unknown>;
}

export interface AssessmentReference {
  assessmentRevision: number;
  assessmentContentHash: string;
}

export interface ApproveAssessmentInput extends AssessmentReference {
  title: string;
}

export interface IssueEventPage {
  items: IssueEvent[];
  nextCursor: number;
}

export interface EvidencePayload {
  bytes: Uint8Array;
  mimeType: string;
  label: string;
}

export interface ApprovalResult {
  issue: Issue;
  branch?: BranchInfo;
}

export interface IssueWorkspaceInfo {
  providerId: string;
  status: WorkspaceBinding["status"];
  branch?: string;
}

export interface RuntimeApi {
  health(input: Record<string, never>): Promise<RuntimeHealth>;
  listIntegrationPlugins(input: Record<string, never>): Promise<IntegrationPluginManifest[]>;
  listWorkspaceProviders(input: Record<string, never>): Promise<WorkspaceProviderManifest[]>;
  listProjects(input: Record<string, never>): Promise<ProductProject[]>;
  inspectProject(input: { path: string }): Promise<ProjectInspection>;
  inspectProjectBranches(input: {
    path: string;
    providerId: string;
    refreshRemote: boolean;
  }): Promise<WorkspaceBranchDiscovery>;
  getProject(input: { id: string }): Promise<ProductProject>;
  saveProjectSettings(input: SaveProjectSettingsInput): Promise<ProductProject>;
  createProject(input: CreateProjectInput): Promise<ProductProject>;
  updateProject(input: { id: string; input: UpdateProjectInput }): Promise<ProductProject>;
  setIntegrationSecrets(input: {
    id: string;
    pluginId: string;
    patch: Record<string, string | null>;
  }): Promise<ProductProject>;
  integrationHealth(input: Record<string, never>): Promise<Record<string, IntegrationHealth>>;
  listIssues(input: { id?: string }): Promise<Issue[]>;
  getIssue(input: { id: string }): Promise<Issue>;
  getIssueWorkspace(input: { id: string }): Promise<IssueWorkspaceInfo | null>;
  submitManual(input: ManualIssueCommand): Promise<Issue>;
  submitReview(input: { id: string; input: ReviewSubmission }): Promise<Issue>;
  approveAssessment(input: { id: string; input: ApproveAssessmentInput }): Promise<Issue>;
  /** @deprecated Use approveAssessment. */
  approveBugAssessment(input: { id: string; input: ApproveAssessmentInput }): Promise<Issue>;
  confirmNotABug(input: { id: string; reference: AssessmentReference }): Promise<Issue>;
  confirmDuplicate(input: {
    id: string;
    reference: AssessmentReference;
    duplicateOf: string;
  }): Promise<Issue>;
  requestReassessment(input: { id: string; feedback: string }): Promise<Issue>;
  rejectDelivery(input: { id: string; feedback: string }): Promise<Issue>;
  approveDelivery(input: { id: string }): Promise<ApprovalResult>;
  retryIssue(input: { id: string }): Promise<Issue>;
  rebuildAgentSession(input: { id: string; expectedRevision: number }): Promise<Issue>;
  grantIssueCapabilities(input: {
    id: string;
    expectedRevision: number;
    requestId: string;
  }): Promise<Issue>;
  pauseIssue(input: { id: string }): Promise<Issue>;
  resumeIssue(input: { id: string }): Promise<Issue>;
  cancelIssue(input: { id: string }): Promise<Issue>;
  issueEvents(input: { id: string; cursor: number }): Promise<IssueEventPage>;
  readEvidence(input: { issueId: string; evidenceId: string }): Promise<EvidencePayload>;
  shutdown(input: Record<string, never>): Promise<null>;
}

export type RuntimeOperation = keyof RuntimeApi;
export type RuntimeOperationInput<Name extends RuntimeOperation> = Parameters<RuntimeApi[Name]>[0];
export type RuntimeOperationOutput<Name extends RuntimeOperation> = Awaited<ReturnType<RuntimeApi[Name]>>;
