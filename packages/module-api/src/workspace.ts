import type {
  ConfigField,
  ConfigValue,
  Issue,
  NewIssueEvent,
  RuntimeProject,
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

export interface WorkspaceBinding {
  issueId: string;
  providerId: string;
  resourceId: string;
  status: "PREPARING" | "READY" | "FAILED" | "RELEASED";
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceProvider {
  readonly id: string;
  acquire(input: { issue: Issue; project: RuntimeProject }): Promise<{
    projectPath: string;
    resourceId: string;
  }>;
  publish(input: {
    issue: Issue;
    resourceId: string;
  }): Promise<BranchInfo | undefined>;
  release(input: { issue: Issue; resourceId: string }): Promise<void>;
}

export interface WorkspaceProviderFactory {
  readonly id: string;
  readonly manifest: WorkspaceProviderManifest;
  validate(config: Record<string, ConfigValue>): void;
  create(config: Record<string, ConfigValue>): WorkspaceProvider;
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
