import type {
  Issue,
  PendingOperation,
  RuntimeStore,
} from "@oh-my-bug/core";

import type { WorkspaceCoordinator } from "./workspace-coordinator.js";

export interface RecoveryDependencies {
  store: RuntimeStore;
  id(): string;
  now(): string;
}

export async function reconcileWorkspaceIssues(
  dependencies: { workspaces: Pick<WorkspaceCoordinator, "recover"> },
): Promise<void> {
  await dependencies.workspaces.recover();
}

export function reconcileInterruptedIssues(dependencies: RecoveryDependencies): void {
  const pendingIds = new Set(
    dependencies.store.listPendingOperations().map(({ issue }) => issue.id),
  );
  for (const issue of dependencies.store.listIssues()) {
    if (pendingIds.has(issue.id)) continue;
    const operation = interruptedOperation(issue);
    if (!operation) continue;
    dependencies.store.transaction((transaction) => {
      const current = dependencies.store.getIssue(issue.id);
      if (!current || current.revision !== issue.revision) return;
      const resumable = {
        ...current,
        revision: current.revision + 1,
        updatedAt: dependencies.now(),
      };
      transaction.updateIssue(resumable, current.revision, operation);
      transaction.appendEvent({
        id: dependencies.id(),
        issueId: resumable.id,
        type: "RUNTIME_INTERRUPTED",
        actor: "SYSTEM",
        data: {
          from: resumable.status,
          to: resumable.status,
          operation,
          reason: "PROCESS_EXITED",
          revision: resumable.revision,
          ...(resumable.agentSession
            ? { sessionId: resumable.agentSession.sessionId }
            : {}),
          ...(resumable.repair ? { iteration: resumable.repair.iteration } : {}),
        },
        occurredAt: dependencies.now(),
      });
    });
  }
}

export function interruptedOperation(issue: Issue): PendingOperation | undefined {
  if (issue.status === "ASSESSING") return "ASSESS";
  if (issue.status === "REPAIRING") return "REPAIR";
  if (issue.status === "EVIDENCE_CAPTURE" && issue.repair?.deliveryDraft) {
    return "CAPTURE_EVIDENCE";
  }
  if (issue.status === "EVIDENCE_CHECK" && issue.repair?.delivery) return "EVIDENCE";
  return undefined;
}
