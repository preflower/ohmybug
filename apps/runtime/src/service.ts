import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";

import type {
  ApproveAssessmentInput,
  EvidenceStore,
  IntegrationHealth,
  Issue,
  RuntimeProject,
  RuntimeStore,
} from "@oh-my-bug/core";

import type { IntegrationManager } from "./integrations/manager.js";
import type { IntegrationRegistry } from "./integrations/registry.js";
import type { ManualSubmission } from "./orchestration/commands.js";
import type {
  AssessmentReference,
  CreateProjectInput,
  EvidencePayload,
  ProductProject,
  ProjectInspection,
  RuntimeApi,
  RuntimeHealth,
  UpdateProjectInput,
} from "./protocol/types.js";

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
  approveAssessment(id: string, input: ApproveAssessmentInput): Issue;
  approveBugAssessment(id: string, input: ApproveAssessmentInput): Issue;
  confirmNotABug(id: string, reference: AssessmentReference): Issue;
  confirmDuplicate(id: string, reference: AssessmentReference, duplicateOf: string): Issue;
  requestReassessment(id: string, feedback: string): Issue;
  rejectDelivery(id: string, feedback: string): Issue;
  approveDelivery(id: string): Issue;
  retryIssue(id: string): Issue;
  rebuildAgentSession(id: string, expectedRevision: number): Promise<Issue>;
  cancelIssue(id: string): Promise<Issue>;
  stop(): Promise<void>;
}

interface SecretStore {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

export interface RuntimeServiceDependencies {
  runtime: RuntimeFacade;
  store: RuntimeStore;
  secrets: SecretStore;
  evidence: EvidenceStore;
  integrations: Pick<IntegrationManager, "refreshProject" | "health">;
  integrationRegistry: IntegrationRegistry;
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

  async listProjects(_input: Record<string, never> = {}): Promise<ProductProject[]> {
    void _input;
    this.assertAccepting();
    return Promise.all(this.dependencies.store.listProjects().map((project) => this.toProductProject(project)));
  }

  async inspectProject(input: { path: string }): Promise<ProjectInspection> {
    this.assertAccepting();
    const path = await canonicalDirectory(input.path);
    const name = basename(path);
    return { path, name, key: projectKey(name) };
  }

  async getProject(input: { id: string }): Promise<ProductProject> {
    this.assertAccepting();
    return this.toProductProject(this.requireProject(input.id));
  }

  async createProject(input: CreateProjectInput): Promise<ProductProject> {
    return this.mutateProject(async () => {
      const path = await canonicalDirectory(input.path);
      const timestamp = this.dependencies.now();
      const project: RuntimeProject = {
        id: this.dependencies.id(),
        ...input,
        path,
        agent: input.agent ?? { plugin: "codex" },
        integrations: toRuntimeIntegrations(input.integrations),
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.validateIntegrations(project);
      this.dependencies.runtime.registerProject(project);
      const saved = this.requireProject(project.id);
      await this.dependencies.integrations.refreshProject(saved);
      return this.toProductProject(saved);
    });
  }

  async updateProject(input: { id: string; input: UpdateProjectInput }): Promise<ProductProject> {
    return this.mutateProject(async () => {
      const current = this.requireProject(input.id);
      const fields = withoutExpectedRevision(input.input);
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
      const updated = this.dependencies.store.updateProject(next, input.input.expectedRevision);
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

  async approveDelivery(input: { id: string }): Promise<Issue> {
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

  async cancelIssue(input: { id: string }): Promise<Issue> {
    this.assertAccepting();
    return this.dependencies.runtime.cancelIssue(input.id);
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
