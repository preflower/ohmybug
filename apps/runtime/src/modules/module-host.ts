import {
  Context,
  ScopeStatus,
  type ForkScope,
  type Plugin,
} from "@cordisjs/core";

export class ModuleHost {
  private readonly context = new Context();
  private readonly scopes: ForkScope[] = [];

  mount<T>(plugin: Plugin<Context, T>, config: T): ForkScope {
    const scope = this.context.plugin(plugin as Plugin.Function<Context, T>, config);
    this.scopes.push(scope);
    return scope;
  }

  async start(): Promise<void> {
    const failed = this.scopes.find((scope) => scope.status === ScopeStatus.FAILED);
    if (failed) throw failed.error;
  }

  async stop(): Promise<void> {
    for (const scope of [...this.scopes].reverse()) scope.dispose();
    this.scopes.length = 0;
  }
}
