import { transitionIssue, type Issue, type RuntimeStore } from "@oh-my-bug/core";
import type {
  LifecycleEventMap,
  WorkspaceBinding,
  WorkspacePersistence,
} from "@oh-my-bug/module-api";

import type {
  LifecycleHookFailure,
  RuntimeLifecycleHooks,
} from "../modules/lifecycle-hooks.js";
import type { WorkspaceRegistry } from "../modules/workspace-registry.js";

export interface WorkspaceCoordinatorDependencies {
  store: RuntimeStore;
  persistence: WorkspacePersistence;
  registry: WorkspaceRegistry;
  hooks?: RuntimeLifecycleHooks;
  id: () => string;
  now: () => string;
}

export class WorkspaceCoordinator {
  constructor(private readonly dependencies: WorkspaceCoordinatorDependencies) {}

  async prepare(pending: Issue): Promise<void> {
    const issue = this.dependencies.store.getIssue(pending.id);
    if (!issue || issue.revision !== pending.revision) return;
    const project = this.dependencies.store.getProject(issue.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");

    const existing = this.dependencies.persistence.getBinding(issue.id);
    const configuration = existing
      ? { provider: existing.providerId, config: {} }
      : this.dependencies.persistence.getProjectConfiguration(project.id)
        ?? { provider: "local", config: {} };
    const resourceId = `${configuration.provider}:${issue.id}`;
    const startedAt = this.dependencies.now();
    const preparing: WorkspaceBinding = {
      issueId: issue.id,
      providerId: configuration.provider,
      resourceId,
      status: "PREPARING",
      createdAt: existing?.createdAt ?? startedAt,
      updatedAt: startedAt,
    };

    try {
      if (existing && existing.resourceId !== resourceId) {
        throw new Error("WORKSPACE_RESOURCE_ID_MISMATCH");
      }
      this.dependencies.persistence.beginAcquire(preparing);
      const provider = this.dependencies.registry.create(
        configuration.provider,
        configuration.config,
      );
      const acquired = await provider.acquire({ issue, project });
      if (acquired.resourceId !== resourceId) {
        throw new Error("WORKSPACE_RESOURCE_ID_MISMATCH");
      }
      const completedAt = this.dependencies.now();
      this.dependencies.persistence.completeAcquire({
        binding: {
          ...preparing,
          status: "READY",
          updatedAt: completedAt,
        },
        issue: {
          ...issue,
          projectPath: acquired.projectPath,
          revision: issue.revision + 1,
          updatedAt: completedAt,
        },
        expectedRevision: issue.revision,
        event: this.event(issue.id, "WORKSPACE_READY", {
          providerId: provider.id,
          resourceId,
        }),
      });
    } catch (error) {
      const latest = this.dependencies.store.getIssue(issue.id);
      if (!latest || latest.revision !== issue.revision) return;
      const failedAt = this.dependencies.now();
      const message = workspaceFailureMessage(error);
      this.dependencies.persistence.transaction(() => {
        this.dependencies.store.transaction((transaction) => {
          transaction.updateIssue(latest, latest.revision, null);
        });
        this.dependencies.persistence.failAcquire(
          {
            ...preparing,
            status: "FAILED",
            lastError: message,
            updatedAt: failedAt,
          },
          this.event(issue.id, "WORKSPACE_PREPARATION_FAILED", {
            providerId: configuration.provider,
            error: message,
          }),
        );
      });
    }
  }

  async finalize(pending: Issue): Promise<void> {
    const issue = this.dependencies.store.getIssue(pending.id);
    if (
      !issue ||
      issue.revision !== pending.revision ||
      issue.status !== "APPROVED"
    ) return;
    const project = this.dependencies.store.getProject(issue.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const binding = this.dependencies.persistence.getBinding(issue.id);

    try {
      if (!binding || binding.status !== "READY") {
        throw new Error("WORKSPACE_BINDING_NOT_READY");
      }
      const provider = this.dependencies.registry.create(binding.providerId, {});
      const branch = await provider.publish({
        issue,
        resourceId: binding.resourceId,
      });
      await provider.release({ issue, resourceId: binding.resourceId });

      const completedAt = this.dependencies.now();
      const completed = transitionIssue(issue, "COMPLETE_DELIVERY", completedAt);
      this.dependencies.persistence.completeRelease({
        binding: {
          ...binding,
          status: "RELEASED",
          updatedAt: completedAt,
        },
        issue: completed,
        expectedRevision: issue.revision,
        event: this.event(issue.id, "ISSUE_COMPLETED", {
          providerId: binding.providerId,
          resourceId: binding.resourceId,
          ...(branch ? { branch } : {}),
        }),
      });
      this.emitLifecycle("issue.completed", { issue: completed, project, branch });
    } catch (error) {
      const latest = this.dependencies.store.getIssue(issue.id);
      if (
        !latest ||
        latest.revision !== issue.revision ||
        latest.status !== "APPROVED"
      ) return;
      const message = workspaceFailureMessage(error, "WORKSPACE_PUBLISH_FAILED");
      this.dependencies.persistence.transaction(() => {
        this.dependencies.store.transaction((transaction) => {
          transaction.updateIssue(latest, latest.revision, null);
          transaction.appendEvent(this.event(issue.id, "WORKSPACE_PUBLISH_FAILED", {
            providerId: binding?.providerId,
            error: message,
          }));
        });
      });
    }
  }

  private event(issueId: string, type: string, data: Record<string, unknown>) {
    return {
      id: this.dependencies.id(),
      issueId,
      type,
      actor: "SYSTEM" as const,
      data,
      occurredAt: this.dependencies.now(),
    };
  }

  private emitLifecycle<K extends keyof LifecycleEventMap>(
    name: K,
    payload: LifecycleEventMap[K],
  ): void {
    if (!this.dependencies.hooks) return;
    this.dependencies.hooks.emit(name, payload);
    this.reportHookFailures(payload.issue.id, this.dependencies.hooks.takeFailures());
  }

  private reportHookFailures(issueId: string, failures: LifecycleHookFailure[]): void {
    if (failures.length === 0) return;
    this.dependencies.store.transaction((transaction) => {
      for (const failure of failures) {
        transaction.appendEvent({
          id: this.dependencies.id(),
          issueId,
          type: "MODULE_HOOK_FAILED",
          actor: "SYSTEM",
          data: {
            owner: failure.owner,
            hook: failure.hook,
            message: workspaceFailureMessage(failure.error, "MODULE_HOOK_FAILED"),
          },
          occurredAt: this.dependencies.now(),
        });
      }
    });
  }
}

function workspaceFailureMessage(error: unknown, fallback = "WORKSPACE_PREPARATION_FAILED"): string {
  return error instanceof Error ? error.message : fallback;
}
