import type {
  WorkspaceProvider,
  WorkspaceProviderFactory,
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

  private require(id: string): WorkspaceProviderFactory {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`WORKSPACE_PROVIDER_NOT_AVAILABLE:${id}`);
    return factory;
  }
}
