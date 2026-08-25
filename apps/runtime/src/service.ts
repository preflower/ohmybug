import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";

import type {
  EvidenceStore,
  IntegrationHealth,
  Issue,
  RuntimeProject,
  RuntimeStore,
  ReviewSubmission,
} from "@oh-my-bug/core";
import type {
  WorkspacePersistence,
  WorkspaceBranchDiscovery,
  WorkspaceProjectConfiguration,
  WorkspaceProviderManifest,
} from "@oh-my-bug/module-api";

import type { IntegrationManager } from "./integrations/manager.js";
import type { IntegrationRegistry } from "./integrations/registry.js";
import type { WorkspaceRegistry } from "./modules/workspace-registry.js";
import type { ManualSubmission } from "./orchestration/commands.js";
import type {
  ApproveAssessmentInput,
  AssessmentReference,
  ApprovalResult,
  CreateProjectInput,
  EvidencePayload,
  IntegrationSecretPatches,
  IssueWorkspaceInfo,
  ProductProject,
  ProjectInspection,
  RuntimeApi,
  RuntimeHealth,
  SaveProjectSettingsInput,
  UpdateProjectInput,
} from "./protocol/types.js";
import { readIssueWorkspaceInfo } from "./workspaces/issue-workspace-info.js";

interface RuntimeFacade {
  health(): RuntimeHealth;
  registerProject(project: RuntimeProject): void;
  submitManual(projectId: string, input: ManualSubmission): Promise<
    | { kind: "IGNORED_DUPLICATE"; issueId: string }
    | { kind: "APPENDED" | "CREATED"; issue: Issue }
  >;
  getIssue(id: string): Issue;
  listIssues(projectId?: string): Issue[];
  readIssueEvents(id: string, cursor?: number): ReturnType<RuntimeStore["readEvents"]>;
  submitReview(id: string, input: ReviewSubmission): Issue;
  approveAssessment(id: string, input: ApproveAssessmentInput): Issue;
  approveBugAssessment(id: string, input: ApproveAssessmentInput): Issue;
  confirmNotABug(id: string, reference: AssessmentReference): Issue;
  confirmDuplicate(id: string, reference: AssessmentReference, duplicateOf: string): Issue;
  requestReassessment(id: string, feedback: string): Issue;
  rejectDelivery(id: string, feedback: string): Issue;
  approveDelivery(id: string): Promise<ApprovalResult>;
  retryIssue(id: string): Issue;
  rebuildAgentSession(id: string, expectedRevision: number): Promise<Issue>;
  grantIssueCapabilities(id: string, expectedRevision: number, requestId: string): Issue;
  pauseIssue(id: string): Promise<Issue>;
  resumeIssue(id: string): Issue;
  cancelIssue(id: string): Promise<Issue>;
  stop(): Promise<void>;
}

interface SecretStore {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

interface SecretChange {
  ref: string;
  value: string | null;
  previous: string | null;
}

export interface RuntimeServiceDependencies {
  runtime: RuntimeFacade;
  store: RuntimeStore;
  secrets: SecretStore;
  evidence: EvidenceStore;
  integrations: Pick<IntegrationManager, "refreshProject" | "health">;
  integrationRegistry: IntegrationRegistry;
  workspacePersistence: WorkspacePersistence;
  workspaceRegistry: WorkspaceRegistry;
  id(): string;
  now(): string;
}

export class RuntimeService implements RuntimeApi {
  private accepting = true;
  private stopping?: Promise<void>;
  private projectMutations: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: RuntimeServiceDependencies) {}

  async health(_input: Record<string, never> = {}): Promise<RuntimeHealth> {
    void _input;
    return this.dependencies.runtime.health();
  }

  async listIntegrationPlugins(_input: Record<string, never> = {}) {
    void _input;
    this.assertAccepting();
    return this.dependencies.integrationRegistry.manifests();
  }

  async listWorkspaceProviders(
    _input: Record<string, never> = {},
  ): Promise<WorkspaceProviderManifest[]> {
    void _input;
    this.assertAccepting();
    return this.dependencies.workspaceRegistry.manifests();
  }

  async listProjects(_input: Record<string, never> = {}): Promise<ProductProject[]> {
    void _input;
    this.assertAccepting();
    return Promise.all(this.dependencies.store.listProjects().map((project) => this.toProductProject(project)));
  }

  async inspectProject(input: { path: string }): Promise<ProjectInspection> {
    this.assertAccepting();
    const path = await canonicalDirectory(input.path);
    const name = basename(path);
    const workspaces = await this.dependencies.workspaceRegistry.inspectProject(path);
    return { path, name, key: projectKey(name), workspaces };
  }

  async inspectProjectBranches(input: {
    path: string;
    providerId: string;
    refreshRemote: boolean;
  }): Promise<WorkspaceBranchDiscovery> {
    this.assertAccepting();
    const path = await canonicalDirectory(input.path);
    return this.dependencies.workspaceRegistry.inspectProjectBranches(
      input.providerId,
      path,
      { refreshRemote: input.refreshRemote },
    );
  }

  async getProject(input: { id: string }): Promise<ProductProject> {
    this.assertAccepting();
    return this.toProductProject(this.requireProject(input.id));
  }

  async saveProjectSettings(input: SaveProjectSettingsInput): Promise<ProductProject> {
    return this.mutateProject(async () => {
      const current = input.mode === "update" ? this.requireProject(input.id) : undefined;
      const projectId = current?.id ?? this.dependencies.id();
      const path = await canonicalDirectory(input.project.path);
      const timestamp = this.dependencies.now();
      const existingWorkspace = current
        ? this.dependencies.workspacePersistence.getProjectConfiguration(current.id)
        : undefined;
      const selectedWorkspace = cloneWorkspaceConfiguration(
        input.project.workspace ?? existingWorkspace ?? defaultWorkspaceConfiguration(),
      );
      const { workspace: _workspace, ...projectFields } = input.project;
      void _workspace;
      const baseIntegrations = toRuntimeIntegrations(
        input.project.integrations,
        current?.integrations,
      ) ?? {};
      const prepared = await this.prepareSecretChanges(
        projectId,
        baseIntegrations,
        input.secretPatches,
      );
      const integrations = Object.keys(prepared.integrations).length > 0
        ? prepared.integrations
        : undefined;
      const nextProject: RuntimeProject = current
        ? {
            ...current,
            ...projectFields,
            path,
            integrations,
          }
        : {
            id: projectId,
            ...projectFields,
            path,
            agent: input.project.agent ?? { plugin: "codex" },
            integrations,
            revision: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          };

      this.validateIntegrations(nextProject);
      await this.dependencies.workspaceRegistry.validateProject(
        selectedWorkspace.provider,
        path,
        selectedWorkspace.config,
      );

      const applied: SecretChange[] = [];
      let persisted: RuntimeProject;
      try {
        for (const change of prepared.changes) {
          applied.push(change);
          await this.writeSecret(change, change.value);
        }
        persisted = this.dependencies.workspacePersistence.transaction(() => {
          if (input.mode === "create") {
            this.dependencies.runtime.registerProject(nextProject);
            this.dependencies.workspacePersistence.setProjectConfiguration(
              projectId,
              selectedWorkspace,
            );
            return this.requireProject(projectId);
          }
          const saved = this.dependencies.store.updateProject(
            nextProject,
            input.expectedRevision,
          );
          this.dependencies.workspacePersistence.setProjectConfiguration(
            projectId,
            selectedWorkspace,
          );
          return saved;
        });
      } catch (error) {
        try {
          await this.rollbackSecrets(applied);
        } catch (rollbackError) {
          throw new Error("PROJECT_SETTINGS_ROLLBACK_FAILED", { cause: rollbackError });
        }
        throw error;
      }

      await this.dependencies.integrations.refreshProject(persisted);
      return this.toProductProject(persisted);
    });
  }

  async createProject(input: CreateProjectInput): Promise<ProductProject> {
    return this.mutateProject(async () => {
      const path = await canonicalDirectory(input.path);
      const timestamp = this.dependencies.now();
      const selectedWorkspace = cloneWorkspaceConfiguration(
        input.workspace ?? defaultWorkspaceConfiguration(),
      );
      const { workspace: _workspace, ...projectInput } = input;
      void _workspace;
      const project: RuntimeProject = {
        id: this.dependencies.id(),
        ...projectInput,
        path,
        agent: input.agent ?? { plugin: "codex" },
        integrations: toRuntimeIntegrations(input.integrations),
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.validateIntegrations(project);
      await this.dependencies.workspaceRegistry.validateProject(
        selectedWorkspace.provider,
        path,
        selectedWorkspace.config,
      );
      const saved = this.dependencies.workspacePersistence.transaction(() => {
        this.dependencies.runtime.registerProject(project);
        this.dependencies.workspacePersistence.setProjectConfiguration(project.id, selectedWorkspace);
        return this.requireProject(project.id);
      });
      await this.dependencies.integrations.refreshProject(saved);
      return this.toProductProject(saved);
    });
  }

  async updateProject(input: { id: string; input: UpdateProjectInput }): Promise<ProductProject> {
    return this.mutateProject(async () => {
      const current = this.requireProject(input.id);
      const { workspace, ...fields } = withoutExpectedRevision(input.input);
      const path = fields.path === undefined ? current.path : await canonicalDirectory(fields.path);
      const next: RuntimeProject = {
        ...current,
        ...fields,
        path,
        integrations: fields.integrations === undefined
          ? current.integrations
          : toRuntimeIntegrations(fields.integrations, current.integrations),
      };
      this.validateIntegrations(next);
      const existingWorkspace = this.dependencies.workspacePersistence
        .getProjectConfiguration(current.id);
      const selectedWorkspace = cloneWorkspaceConfiguration(
        workspace ?? existingWorkspace ?? defaultWorkspaceConfiguration(),
      );
      await this.dependencies.workspaceRegistry.validateProject(
        selectedWorkspace.provider,
        path,
        selectedWorkspace.config,
      );
      const updated = this.dependencies.workspacePersistence.transaction(() => {
        const saved = this.dependencies.store.updateProject(next, input.input.expectedRevision);
        if (workspace || !existingWorkspace) {
          this.dependencies.workspacePersistence.setProjectConfiguration(
            current.id,
            selectedWorkspace,
          );
        }
        return saved;
      });
      await this.dependencies.integrations.refreshProject(updated);
      return this.toProductProject(updated);
    });
  }

  async setIntegrationSecrets(input: {
    id: string;
    pluginId: string;
    patch: Record<string, string | null>;
  }): Promise<ProductProject> {
    return this.mutateProject(async () => {
      const plugin = this.dependencies.integrationRegistry.require(input.pluginId);
      const declared = new Set(plugin.manifest.secretFields.map((field) => field.key));
      for (const key of Object.keys(input.patch)) {
        if (!declared.has(key)) throw new Error(`SECRET_FIELD_NOT_DECLARED:${key}`);
      }
      const current = this.requireProject(input.id);
      const configuration = current.integrations?.[input.pluginId];
      if (!configuration) throw new Error("PROJECT_INTEGRATION_NOT_FOUND");
      const changes = await Promise.all(Object.entries(input.patch).map(async ([key, value]) => {
        const ref = configuration.secretRefs[key] ?? secretReference(input.id, input.pluginId, key);
        return { key, value, ref, previous: await this.dependencies.secrets.get(ref) };
      }));
      const applied: typeof changes = [];
      try {
        for (const change of changes) {
          applied.push(change);
          if (change.value === null) await this.dependencies.secrets.delete(change.ref);
          else await this.dependencies.secrets.set(change.ref, change.value);
        }
        const nextRefs = { ...configuration.secretRefs };
        for (const change of changes) {
          if (change.value === null) delete nextRefs[change.key];
          else nextRefs[change.key] = change.ref;
        }
        const updated = this.dependencies.store.updateProject({
          ...current,
          integrations: {
            ...current.integrations,
            [input.pluginId]: { ...configuration, secretRefs: nextRefs },
          },
        }, current.revision!);
        await this.dependencies.integrations.refreshProject(updated);
        return this.toProductProject(updated);
      } catch (error) {
        try {
          for (const change of applied.reverse()) {
            if (change.previous === null) await this.dependencies.secrets.delete(change.ref);
            else await this.dependencies.secrets.set(change.ref, change.previous);
          }
        } catch (rollbackError) {
          throw new Error("SECRET_PATCH_ROLLBACK_FAILED", { cause: rollbackError });
        }
        throw new Error("SECRET_PATCH_FAILED", { cause: error });
      }
    });
  }

  async integrationHealth(
    _input: Record<string, never> = {},
  ): Promise<Record<string, IntegrationHealth>> {
    void _input;
    this.assertAccepting();
    return this.dependencies.integrations.health();
  }

  async listIssues(input: { id?: string }): Promise<Issue[]> {
    this.assertAccepting();
    return this.dependencies.runtime.listIssues(input.id);
  }

  async getIssue(input: { id: string }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.getIssue(input.id);
  }

  async getIssueWorkspace(input: { id: string }): Promise<IssueWorkspaceInfo | null> {
    this.assertAccepting();
    const issue = this.dependencies.runtime.getIssue(input.id);
    return readIssueWorkspaceInfo({
      issue,
      persistence: this.dependencies.workspacePersistence,
      registry: this.dependencies.workspaceRegistry,
    });
  }

  async submitManual(input: {
    projectId: string;
    commandId: string;
    content: string;
    summary?: string;
    context?: Record<string, unknown>;
  }): Promise<Issue> {
    this.assertAccepting();
    const result = await this.dependencies.runtime.submitManual(input.projectId, {
      commandId: input.commandId,
      content: input.content,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.context ? { context: input.context } : {}),
    });
    return result.kind === "IGNORED_DUPLICATE"
      ? this.dependencies.runtime.getIssue(result.issueId)
      : result.issue;
  }

  async approveAssessment(input: { id: string; input: ApproveAssessmentInput }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.approveAssessment(input.id, input.input);
  }

  async submitReview(input: { id: string; input: ReviewSubmission }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.submitReview(input.id, input.input);
  }

  /** @deprecated Use approveAssessment. */
  async approveBugAssessment(input: { id: string; input: ApproveAssessmentInput }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.approveAssessment(input.id, input.input);
  }

  async confirmNotABug(input: { id: string; reference: AssessmentReference }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.confirmNotABug(input.id, input.reference);
  }

  async confirmDuplicate(input: {
    id: string;
    reference: AssessmentReference;
    duplicateOf: string;
  }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.confirmDuplicate(input.id, input.reference, input.duplicateOf);
  }

  async requestReassessment(input: { id: string; feedback: string }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.requestReassessment(input.id, input.feedback);
  }

  async rejectDelivery(input: { id: string; feedback: string }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.rejectDelivery(input.id, input.feedback);
  }

  async approveDelivery(input: { id: string }): Promise<ApprovalResult> {
    this.assertAccepting();
    return this.dependencies.runtime.approveDelivery(input.id);
  }

  async retryIssue(input: { id: string }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.retryIssue(input.id);
  }

  async rebuildAgentSession(input: { id: string; expectedRevision: number }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.rebuildAgentSession(input.id, input.expectedRevision);
  }

  async grantIssueCapabilities(input: {
    id: string;
    expectedRevision: number;
    requestId: string;
  }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.grantIssueCapabilities(
      input.id,
      input.expectedRevision,
      input.requestId,
    );
  }

  async cancelIssue(input: { id: string }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.cancelIssue(input.id);
  }

  async pauseIssue(input: { id: string }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.pauseIssue(input.id);
  }

  async resumeIssue(input: { id: string }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.resumeIssue(input.id);
  }

  async issueEvents(input: { id: string; cursor: number }) {
    this.assertAccepting();
    const items = this.dependencies.runtime.readIssueEvents(input.id, input.cursor);
    return { items, nextCursor: items.at(-1)?.sequence ?? input.cursor };
  }

  async readEvidence(input: { issueId: string; evidenceId: string }): Promise<EvidencePayload> {
    this.assertAccepting();
    this.dependencies.runtime.getIssue(input.issueId);
    return this.dependencies.evidence.read(input.issueId, input.evidenceId);
  }

  async shutdown(_input: Record<string, never> = {}): Promise<null> {
    void _input;
    this.accepting = false;
    this.stopping ??= this.projectMutations.then(() => this.dependencies.runtime.stop());
    await this.stopping;
    return null;
  }

  private validateIntegrations(project: RuntimeProject): void {
    for (const [id, configuration] of Object.entries(project.integrations ?? {})) {
      this.dependencies.integrationRegistry.get(id)?.validate(configuration);
    }
  }

  private async prepareSecretChanges(
    projectId: string,
    integrations: NonNullable<RuntimeProject["integrations"]>,
    patches: IntegrationSecretPatches,
  ): Promise<{
      integrations: NonNullable<RuntimeProject["integrations"]>;
      changes: SecretChange[];
    }> {
    const next = structuredClone(integrations);
    const changes: SecretChange[] = [];
    for (const [pluginId, patch] of Object.entries(patches)) {
      const plugin = this.dependencies.integrationRegistry.require(pluginId);
      const configuration = next[pluginId];
      if (!configuration) throw new Error(`PROJECT_INTEGRATION_NOT_FOUND:${pluginId}`);
      const declared = new Set(plugin.manifest.secretFields.map(({ key }) => key));
      for (const [key, value] of Object.entries(patch)) {
        if (!declared.has(key)) throw new Error(`SECRET_FIELD_NOT_DECLARED:${key}`);
        const ref = configuration.secretRefs[key] ?? secretReference(projectId, pluginId, key);
        changes.push({ ref, value, previous: await this.dependencies.secrets.get(ref) });
        if (value === null) delete configuration.secretRefs[key];
        else configuration.secretRefs[key] = ref;
      }
    }
    return { integrations: next, changes };
  }

  private async writeSecret(change: SecretChange, value: string | null): Promise<void> {
    if (value === null) await this.dependencies.secrets.delete(change.ref);
    else await this.dependencies.secrets.set(change.ref, value);
  }

  private async rollbackSecrets(applied: SecretChange[]): Promise<void> {
    for (const change of [...applied].reverse()) {
      await this.writeSecret(change, change.previous);
    }
  }

  private requireProject(id: string): RuntimeProject {
    const project = this.dependencies.store.getProject(id);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    return project;
  }

  private async toProductProject(project: RuntimeProject): Promise<ProductProject> {
    const integrations = project.integrations
      ? Object.fromEntries(await Promise.all(Object.entries(project.integrations).map(
          async ([id, configuration]) => {
            const plugin = this.dependencies.integrationRegistry.get(id);
            const secretKeys = plugin
              ? plugin.manifest.secretFields.map((field) => field.key)
              : Object.keys(configuration.secretRefs);
            const secretConfigured = Object.fromEntries(await Promise.all(secretKeys.map(async (key) => {
              const ref = configuration.secretRefs[key];
              return [key, Boolean(ref && await this.dependencies.secrets.get(ref))];
            })));
            return [id, {
              enabled: configuration.enabled,
              config: structuredClone(configuration.config),
              secretConfigured,
              ...(!plugin ? { unavailable: `PLUGIN_NOT_INSTALLED:${id}` } : {}),
            }];
          },
        )))
      : undefined;
    const workspace = cloneWorkspaceConfiguration(
      this.dependencies.workspacePersistence.getProjectConfiguration(project.id)
        ?? defaultWorkspaceConfiguration(),
    );
    return {
      id: project.id,
      key: project.key,
      path: project.path,
      revision: project.revision ?? 1,
      createdAt: project.createdAt ?? this.dependencies.now(),
      updatedAt: project.updatedAt ?? this.dependencies.now(),
      ...(project.name ? { name: project.name } : {}),
      ...(project.instructions !== undefined ? { instructions: project.instructions } : {}),
      ...(project.commands ? { commands: project.commands } : {}),
      ...(project.agent ? { agent: project.agent } : {}),
      ...(integrations ? { integrations } : {}),
      workspace: {
        ...workspace,
        ...(!this.dependencies.workspaceRegistry.has(workspace.provider)
          ? { unavailable: `WORKSPACE_PROVIDER_NOT_AVAILABLE:${workspace.provider}` }
          : {}),
      },
    };
  }

  private assertAccepting(): void {
    if (!this.accepting) throw new Error("RUNTIME_STOPPED");
  }

  private mutateProject<T>(work: () => Promise<T>): Promise<T> {
    this.assertAccepting();
    const result = this.projectMutations.then(work);
    this.projectMutations = result.then(() => undefined, () => undefined);
    return result;
  }
}

function toRuntimeIntegrations(
  integrations: CreateProjectInput["integrations"],
  current: RuntimeProject["integrations"] = {},
): RuntimeProject["integrations"] {
  if (!integrations) return undefined;
  return Object.fromEntries(Object.entries(integrations).map(([id, configuration]) => [id, {
    enabled: configuration.enabled,
    config: structuredClone(configuration.config),
    secretRefs: current?.[id]?.secretRefs ?? {},
  }]));
}

function withoutExpectedRevision(input: UpdateProjectInput): Omit<UpdateProjectInput, "expectedRevision"> {
  const { expectedRevision, ...fields } = input;
  void expectedRevision;
  return fields;
}

function defaultWorkspaceConfiguration(): WorkspaceProjectConfiguration {
  return { provider: "local", config: {} };
}

function cloneWorkspaceConfiguration(
  configuration: WorkspaceProjectConfiguration,
): WorkspaceProjectConfiguration {
  return {
    provider: configuration.provider,
    config: structuredClone(configuration.config),
  };
}

function secretReference(projectId: string, pluginId: string, key: string): string {
  return `integration-secret:${projectId}:${pluginId}:${key}`;
}

async function canonicalDirectory(input: string): Promise<string> {
  let path: string;
  try {
    path = await realpath(input);
    if (!(await stat(path)).isDirectory()) throw new Error("PROJECT_PATH_NOT_DIRECTORY");
  } catch (error) {
    if (error instanceof Error && error.message === "PROJECT_PATH_NOT_DIRECTORY") throw error;
    throw new Error("PROJECT_PATH_INVALID", { cause: error });
  }
  return path;
}

function projectKey(name: string): string {
  const collapsed = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!collapsed) return "PROJECT";
  return /^[A-Z]/.test(collapsed) ? collapsed : `PROJECT-${collapsed}`;
}
