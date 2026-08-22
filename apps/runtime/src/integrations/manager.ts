import type {
  IntegrationCheckpointStore,
  IntegrationHealth,
  IntegrationInput,
  IntegrationPlugin,
  ManagedIntegrationSource,
  RuntimeProject,
} from "@oh-my-bug/core";

import type { IntegrationRegistry } from "./registry.js";

export interface IntegrationSecretReader {
  get(ref: string): Promise<string | null>;
}

export interface IntegrationManagerOptions {
  registry: IntegrationRegistry;
  secrets: IntegrationSecretReader;
  checkpoints: IntegrationCheckpointStore;
  onInput(projectId: string, input: IntegrationInput): Promise<void>;
  id(): string;
  now(): Date;
}

interface ActiveSource {
  projectId: string;
  plugin?: IntegrationPlugin;
  abort: AbortController;
  source?: ManagedIntegrationSource;
  task?: Promise<void>;
  failure?: IntegrationHealth;
}

export class IntegrationManager {
  private readonly active = new Map<string, ActiveSource>();
  private lifecycle: Promise<void> = Promise.resolve();
  private stopRequested = false;
  private stopping?: Promise<void>;

  constructor(private readonly options: IntegrationManagerOptions) {}

  async start(projects: RuntimeProject[]): Promise<void> {
    if (this.stopRequested) throw new Error("INTEGRATION_MANAGER_STOPPED");
    await this.enqueue(() => Promise.all(projects.map((project) => this.startProject(project)))
      .then(() => undefined));
  }

  async refreshProject(project: RuntimeProject): Promise<void> {
    if (this.stopRequested) throw new Error("INTEGRATION_MANAGER_STOPPED");
    await this.enqueue(async () => {
      await this.stopProject(project.id);
      await this.startProject(project);
    });
  }

  health(): Record<string, IntegrationHealth> {
    return Object.fromEntries([...this.active].map(([key, active]) => [
      key,
      active.failure ?? active.source?.health() ?? { state: "connecting" },
    ]));
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopRequested = true;
    this.stopping = this.enqueue(async () => {
      const projects = new Set([...this.active.values()].map((source) => source.projectId));
      await Promise.all([...projects].map((projectId) => this.stopProject(projectId)));
    });
    await this.stopping;
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.lifecycle.then(work);
    this.lifecycle = result.catch(() => undefined);
    return result;
  }

  private async startProject(project: RuntimeProject): Promise<void> {
    await Promise.all(Object.entries(project.integrations ?? {}).map(async ([pluginId, configuration]) => {
      if (!configuration.enabled) return;
      const key = sourceKey(project.id, pluginId);
      const active: ActiveSource = { projectId: project.id, abort: new AbortController() };
      this.active.set(key, active);
      try {
        const plugin = this.options.registry.require(pluginId);
        active.plugin = plugin;
        plugin.validate(configuration);
        const secrets = await this.loadSecrets(plugin, configuration.secretRefs);
        const source = await plugin.create({
          projectId: project.id,
          configuration,
          secrets,
          checkpoints: this.options.checkpoints,
          onInput: (input) => this.options.onInput(project.id, input),
          id: this.options.id,
          now: this.options.now,
        });
        active.source = source;
        active.task = source.start(active.abort.signal).catch((error: unknown) => {
          if (active.abort.signal.aborted) return;
          active.failure = failureHealth(plugin.publicError(error));
        });
      } catch (error) {
        active.failure = failureHealth(publicError(active.plugin, error));
      }
    }));
  }

  private async loadSecrets(
    plugin: IntegrationPlugin,
    secretRefs: Readonly<Record<string, string>>,
  ): Promise<Readonly<Record<string, string>>> {
    const entries: Array<readonly [string, string]> = [];
    for (const field of plugin.manifest.secretFields) {
      const ref = secretRefs[field.key];
      if (!ref) continue;
      const value = await this.options.secrets.get(ref);
      if (value !== null) entries.push([field.key, value]);
    }
    return Object.freeze(Object.fromEntries(entries));
  }

  private async stopProject(projectId: string): Promise<void> {
    const matches = [...this.active.entries()].filter(([, source]) => source.projectId === projectId);
    for (const [, source] of matches) source.abort.abort();
    await Promise.allSettled(matches.flatMap(([, source]) => source.task ? [source.task] : []));
    for (const [key] of matches) this.active.delete(key);
  }
}

function sourceKey(projectId: string, integration: string): string {
  return `${projectId}:${integration}`;
}

function failureHealth(lastError: string): IntegrationHealth {
  return { state: "backoff", lastError };
}

function publicError(plugin: IntegrationPlugin | undefined, error: unknown): string {
  if (plugin) return plugin.publicError(error);
  const message = error instanceof Error ? error.message : String(error);
  return /^PLUGIN_NOT_INSTALLED:[a-z][a-z0-9-]*$/.test(message)
    ? message
    : "INTEGRATION_START_FAILED";
}
