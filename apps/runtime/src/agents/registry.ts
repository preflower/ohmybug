import type {
  AgentAdapter,
  AgentPlugin,
  AgentPluginContext,
  AgentSessionRef,
  RuntimeProject,
} from "@oh-my-bug/core";

export class AgentRegistry {
  private readonly agents: ReadonlyMap<string, AgentAdapter>;

  constructor(plugins: AgentPlugin[], context: AgentPluginContext) {
    const entries: Array<readonly [string, AgentAdapter]> = [];
    const ids = new Set<string>();
    for (const plugin of plugins) {
      if (ids.has(plugin.id)) throw new Error(`DUPLICATE_AGENT_PLUGIN:${plugin.id}`);
      ids.add(plugin.id);
      entries.push([plugin.id, plugin.create(context)]);
    }
    this.agents = new Map(entries);
  }

  forProject(project: RuntimeProject): AgentAdapter {
    return this.require(project.agent?.plugin ?? "codex");
  }

  forSession(session: AgentSessionRef): AgentAdapter {
    return this.require(session.agent);
  }

  private require(id: string): AgentAdapter {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`AGENT_PLUGIN_NOT_INSTALLED:${id}`);
    return agent;
  }
}
