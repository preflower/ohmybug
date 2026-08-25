import type {
  ConfigField,
  ConfigValue,
  FinalizationRecoveryResult,
  Issue,
  NewIssueEvent,
  RuntimeProject,
  WorkspaceFinalizationDiagnostic,
} from "@oh-my-bug/core";

export interface BranchInfo {
  name: string;
  commit: string;
  remote?: string;
}

export interface WorkspaceProjectConfiguration {
  provider: string;
  config: Record<string, ConfigValue>;
}

export interface WorkspaceProviderManifest {
  id: string;
  name: string;
  configFields: ConfigField[];
}

export interface WorkspaceInspectionFieldState {
  enabled: boolean;
  reason?: string;
}

export interface WorkspaceInspectionProperty {
  key: string;
  label: string;
  value: string;
  description?: string;
}

export interface WorkspaceRemoteDescription {
  name: string;
  url: string;
}

export interface WorkspaceBranchDiscovery {
  localBranches: string[];
  remoteBranches: string[];
  /** Remote used to refresh remote-tracking base branches. */
  fetchRemote?: WorkspaceRemoteDescription;
  /** Remotes that may be used to publish completed Issue branches. */
  publicationRemotes: WorkspaceRemoteDescription[];
  fetchUnavailableReason?: string;
  refreshError?: string;
}

export interface WorkspaceProviderInspection {
  available: boolean;
  reason?: string;
  configPatch?: Record<string, ConfigValue>;
  fields?: Record<string, WorkspaceInspectionFieldState>;
  properties?: WorkspaceInspectionProperty[];
  branches?: WorkspaceBranchDiscovery;
}

export interface WorkspaceBinding {
  issueId: string;
  providerId: string;
  resourceId: string;
  status: "PREPARING" | "READY" | "FAILED" | "RELEASED";
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDescription {
  branch?: string;
}

export interface WorkspaceFinalizationRecoveryContext {
  fingerprintRef: string;
  workspaceStatus: string;
  fingerprintSummary: string;
}

export type WorkspaceFinalizationRecoveryValidation =
  | { kind: "UNCHANGED"; changedPaths: string[] }
  | { kind: "CHANGED"; changedPaths: string[] }
  | { kind: "UNSAFE"; changedPaths: string[]; reason: string };

export interface WorkspaceProvider {
  readonly id: string;
  acquire(input: { issue: Issue; project: RuntimeProject }): Promise<{
    projectPath: string;
    resourceId: string;
  }>;
  describe?(input: {
    issue: Issue;
    resourceId: string;
  }): Promise<WorkspaceDescription>;
  publish(input: {
    issue: Issue;
    resourceId: string;
  }): Promise<BranchInfo | undefined>;
  prepareFinalizationRecovery?(input: {
    issue: Issue;
    resourceId: string;
    diagnostic: WorkspaceFinalizationDiagnostic;
    attemptId: string;
  }): Promise<WorkspaceFinalizationRecoveryContext>;
  validateFinalizationRecovery?(input: {
    issue: Issue;
    resourceId: string;
    fingerprintRef: string;
    result: FinalizationRecoveryResult;
  }): Promise<WorkspaceFinalizationRecoveryValidation>;
  release(input: { issue: Issue; resourceId: string }): Promise<void>;
}

export interface WorkspaceProviderFactory {
  readonly id: string;
  readonly manifest: WorkspaceProviderManifest;
  validate(config: Record<string, ConfigValue>): void;
  validateProjectConfiguration?(
    projectPath: string,
    config: Record<string, ConfigValue>,
  ): Promise<void>;
  inspectProjectBranches?(
    projectPath: string,
    input: { refreshRemote: boolean },
  ): Promise<WorkspaceBranchDiscovery>;
  create(config: Record<string, ConfigValue>): WorkspaceProvider;
  inspectProject?(projectPath: string): Promise<WorkspaceProviderInspection>;
}

export interface ModuleStateStore {
  get<T>(moduleId: string, resourceId: string): T | undefined;
  set<T>(moduleId: string, resourceId: string, value: T): void;
  delete(moduleId: string, resourceId: string): void;
}

export interface WorkspacePersistence {
  transaction<T>(work: () => T): T;
  getProjectConfiguration(projectId: string): WorkspaceProjectConfiguration | undefined;
  setProjectConfiguration(
    projectId: string,
    value: WorkspaceProjectConfiguration,
  ): void;
  getBinding(issueId: string): WorkspaceBinding | undefined;
  recoverBinding(binding: WorkspaceBinding): void;
  beginAcquire(binding: WorkspaceBinding): void;
  completeAcquire(input: {
    binding: WorkspaceBinding;
    issue: Issue;
    expectedRevision: number;
    event: NewIssueEvent;
  }): Issue;
  failAcquire(binding: WorkspaceBinding, event: NewIssueEvent): void;
  completeRelease(input: {
    binding: WorkspaceBinding;
    issue: Issue;
    expectedRevision: number;
    event: NewIssueEvent;
  }): Issue;
}
