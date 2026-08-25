import type { IntegrationInput, RuntimeProject, RuntimeStore } from "@oh-my-bug/core";

import type { AgentRegistry } from "./agents/registry.js";
import type { IntegrationManager } from "./integrations/manager.js";
import type { ModuleHost } from "./modules/module-host.js";
import { RuntimeCommands } from "./orchestration/commands.js";
import {
  reconcileInterruptedIssues,
  reconcileWorkspaceIssues,
} from "./orchestration/recovery.js";
import { RuntimeWorker, type RuntimeWorkerDependencies } from "./orchestration/worker.js";

export interface OhMyBugRuntimeDependencies extends RuntimeWorkerDependencies {
  commands: RuntimeCommands;
  agents: AgentRegistry;
  store: RuntimeStore;
  integrations?: Pick<IntegrationManager, "start" | "stop">;
  modules?: Pick<ModuleHost, "start" | "stop">;
}

export class OhMyBugRuntime {
  private readonly worker: RuntimeWorker;
  private started = false;
  private stopped = false;
  private stopping?: Promise<void>;
  private state: "starting" | "ready" | "stopping" | "stopped" = "starting";

  constructor(private readonly dependencies: OhMyBugRuntimeDependencies) {
    this.worker = new RuntimeWorker(dependencies);
  }

  async start(): Promise<void> {
    if (this.stopped) throw new Error("RUNTIME_STOPPED");
    if (this.started) return;
    this.started = true;
    await this.dependencies.modules?.start();
    await reconcileWorkspaceIssues(this.dependencies);
    reconcileInterruptedIssues(this.dependencies);
    await this.dependencies.integrations?.start(this.dependencies.store.listProjects());
    this.state = "ready";
    this.worker.kick();
  }

  health() { return { state: this.state } as const; }

  async drain(): Promise<void> { await this.worker.drain(); }

  kick(): void {
    if (this.started && !this.stopped) this.worker.kick();
  }

  async stop(): Promise<void> {
    this.stopping ??= (async () => {
      this.state = "stopping";
      this.stopped = true;
      this.dependencies.commands.stopAccepting();
      this.worker.beginShutdown();
      await this.dependencies.integrations?.stop();
      await Promise.allSettled(
        this.dependencies.store.listIssues().flatMap((issue) => issue.agentSession
          ? [this.dependencies.agents.forSession(issue.agentSession).cancel(
              issue.agentSession,
              "RUNTIME_STOPPING",
            )]
          : []),
      );
      await this.worker.drain();
      await this.dependencies.modules?.stop();
      this.dependencies.store.close();
      this.state = "stopped";
    })();
    await this.stopping;
  }

  registerProject(...args: Parameters<RuntimeCommands["registerProject"]>) {
    return this.dependencies.commands.registerProject(...args);
  }
  submitManual(...args: Parameters<RuntimeCommands["submitManual"]>) {
    return this.dependencies.commands.submitManual(...args);
  }
  acceptIntegrationInput(projectId: string, input: IntegrationInput) {
    return this.dependencies.commands.acceptIntegrationInput(projectId, input);
  }
  getIssue(...args: Parameters<RuntimeCommands["getIssue"]>) {
    return this.dependencies.commands.getIssue(...args);
  }
  listIssues(...args: Parameters<RuntimeCommands["listIssues"]>) {
    return this.dependencies.commands.listIssues(...args);
  }
  readIssueEvents(...args: Parameters<RuntimeCommands["readIssueEvents"]>) {
    return this.dependencies.commands.readIssueEvents(...args);
  }
  submitReview(...args: Parameters<RuntimeCommands["submitReview"]>) {
    return this.dependencies.commands.submitReview(...args);
  }
  approveAssessment(...args: Parameters<RuntimeCommands["approveAssessment"]>) {
    return this.dependencies.commands.approveAssessment(...args);
  }
  /** @deprecated Use approveAssessment. */
  approveBugAssessment(...args: Parameters<RuntimeCommands["approveBugAssessment"]>) {
    return this.dependencies.commands.approveBugAssessment(...args);
  }
  confirmNotABug(...args: Parameters<RuntimeCommands["confirmNotABug"]>) {
    return this.dependencies.commands.confirmNotABug(...args);
  }
  confirmDuplicate(...args: Parameters<RuntimeCommands["confirmDuplicate"]>) {
    return this.dependencies.commands.confirmDuplicate(...args);
  }
  requestReassessment(...args: Parameters<RuntimeCommands["requestReassessment"]>) {
    return this.dependencies.commands.requestReassessment(...args);
  }
  rejectDelivery(...args: Parameters<RuntimeCommands["rejectDelivery"]>) {
    return this.dependencies.commands.rejectDelivery(...args);
  }
  async approveDelivery(
    ...args: Parameters<RuntimeCommands["approveDelivery"]>
  ): Promise<{ issue: ReturnType<RuntimeCommands["getIssue"]> }> {
    return { issue: this.dependencies.commands.approveDelivery(...args) };
  }
  retryIssue(...args: Parameters<RuntimeCommands["retryIssue"]>) {
    return this.dependencies.commands.retryIssue(...args);
  }
  rebuildAgentSession(...args: Parameters<RuntimeCommands["rebuildAgentSession"]>) {
    return this.dependencies.commands.rebuildAgentSession(...args);
  }
  grantIssueCapabilities(...args: Parameters<RuntimeCommands["grantIssueCapabilities"]>) {
    return this.dependencies.commands.grantIssueCapabilities(...args);
  }
  pauseIssue(...args: Parameters<RuntimeCommands["pauseIssue"]>) {
    return this.dependencies.commands.pauseIssue(...args);
  }
  resumeIssue(...args: Parameters<RuntimeCommands["resumeIssue"]>) {
    return this.dependencies.commands.resumeIssue(...args);
  }
  cancelIssue(...args: Parameters<RuntimeCommands["cancelIssue"]>) {
    return this.dependencies.commands.cancelIssue(...args);
  }
}

export type RuntimeIntegrationLifecycle = {
  start(projects: RuntimeProject[]): Promise<void>;
  stop(): Promise<void>;
};
