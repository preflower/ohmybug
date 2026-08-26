import type { IntegrationPlugin, IntegrationPluginManifest } from "@oh-my-bug/core";

export class IntegrationRegistry {
  private readonly plugins: ReadonlyMap<string, IntegrationPlugin>;

  constructor(installed: IntegrationPlugin[]) {
    const entries: Array<readonly [string, IntegrationPlugin]> = [];
    const ids = new Set<string>();
    for (const plugin of installed) {
      const id = plugin.manifest.id;
      if (ids.has(id)) throw new Error(`DUPLICATE_INTEGRATION_PLUGIN:${id}`);
      const connectionTestSections = plugin.manifest.sections
        ?.filter((section) => section.connectionTest).length ?? 0;
      if (connectionTestSections > 0 && !plugin.testConnection) {
        throw new Error(`INTEGRATION_CONNECTION_TEST_IMPLEMENTATION_REQUIRED:${id}`);
      }
      if (connectionTestSections === 0 && plugin.testConnection) {
        throw new Error(`INTEGRATION_CONNECTION_TEST_SECTION_REQUIRED:${id}`);
      }
      ids.add(id);
      entries.push([id, plugin]);
    }
    this.plugins = new Map(entries);
  }

  manifests(): IntegrationPluginManifest[] {
    return [...this.plugins.values()]
      .map((plugin) => structuredClone(plugin.manifest))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  get(id: string): IntegrationPlugin | undefined {
    return this.plugins.get(id);
  }

  require(id: string): IntegrationPlugin {
    const plugin = this.get(id);
    if (!plugin) throw new Error(`PLUGIN_NOT_INSTALLED:${id}`);
    return plugin;
  }
}
