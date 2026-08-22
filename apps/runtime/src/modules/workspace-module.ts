import type { Context } from "@cordisjs/core";
import type { WorkspaceProviderFactory } from "@oh-my-bug/module-api";

import type { WorkspaceRegistry } from "./workspace-registry.js";

export interface WorkspaceModuleConfiguration {
  factory: WorkspaceProviderFactory;
  registry: WorkspaceRegistry;
}

export function workspaceModule(
  context: Context,
  config: WorkspaceModuleConfiguration,
): void {
  context.effect(() => config.registry.register(config.factory));
}

workspaceModule.reusable = true;
