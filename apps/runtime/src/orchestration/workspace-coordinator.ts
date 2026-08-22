import type { Issue, RuntimeStore } from "@oh-my-bug/core";
import type {
  WorkspaceBinding,
  WorkspacePersistence,
} from "@oh-my-bug/module-api";

import type { WorkspaceRegistry } from "../modules/workspace-registry.js";

export interface WorkspaceCoordinatorDependencies {
  store: RuntimeStore;
  persistence: WorkspacePersistence;
  registry: WorkspaceRegistry;
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
}

function workspaceFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "WORKSPACE_PREPARATION_FAILED";
}
