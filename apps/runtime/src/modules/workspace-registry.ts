import type {
  WorkspaceProvider,
  WorkspaceProviderFactory,
  WorkspaceProviderInspection,
  WorkspaceProviderManifest,
} from "@oh-my-bug/module-api";
import type { ConfigValue } from "@oh-my-bug/core";

export class WorkspaceRegistry {
  private readonly factories = new Map<string, WorkspaceProviderFactory>();

  register(factory: WorkspaceProviderFactory): () => void {
    if (this.factories.has(factory.id)) {
      throw new Error(`WORKSPACE_PROVIDER_ALREADY_REGISTERED:${factory.id}`);
    }
    this.factories.set(factory.id, factory);
    return () => {
      if (this.factories.get(factory.id) === factory) this.factories.delete(factory.id);
    };
  }

  create(id: string, config: Record<string, ConfigValue>): WorkspaceProvider {
    const factory = this.require(id);
    return factory.create(structuredClone(config));
  }

  validate(id: string, config: Record<string, ConfigValue>): void {
    this.require(id).validate(structuredClone(config));
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  manifests(): WorkspaceProviderManifest[] {
    return [...this.factories.values()].map((factory) => structuredClone(factory.manifest));
  }

  async inspectProject(path: string): Promise<Record<string, WorkspaceProviderInspection>> {
    const entries = await Promise.all([...this.factories.values()].map(async (factory) => {
      if (!factory.inspectProject) {
        return [factory.id, { available: true }] as const;
      }
      try {
        return [factory.id, await factory.inspectProject(path)] as const;
      } catch (error) {
        return [factory.id, {
          available: false,
          reason: error instanceof Error ? error.message : "工作目录检查失败",
        }] as const;
      }
    }));
    return Object.fromEntries(entries);
  }

  private require(id: string): WorkspaceProviderFactory {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`WORKSPACE_PROVIDER_NOT_AVAILABLE:${id}`);
    return factory;
  }
}
