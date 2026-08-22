import {
  recordAssessmentFailure,
  recordEvidenceRejection,
  recordRepairFailure,
  type Issue,
  type RuntimeStore,
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
    const next = interruptedFailure(issue, dependencies.now());
    if (!next) continue;
    dependencies.store.transaction((transaction) => {
      const current = dependencies.store.getIssue(issue.id);
      if (!current || current.revision !== issue.revision) return;
      transaction.updateIssue(next, issue.revision, null);
      transaction.appendEvent({
        id: dependencies.id(),
        issueId: issue.id,
        type: "RUNTIME_INTERRUPTED",
        actor: "SYSTEM",
        data: { from: issue.status, to: next.status },
        occurredAt: dependencies.now(),
      });
    });
  }
}

export function interruptedFailure(issue: Issue, now: string): Issue | undefined {
  if (issue.status === "ASSESSING") {
    return recordAssessmentFailure(issue, "RUNTIME_INTERRUPTED", now);
  }
  if (issue.status === "REPAIRING") {
    return recordRepairFailure(issue, "RUNTIME_INTERRUPTED", now);
  }
  if (issue.status === "EVIDENCE_CHECK") {
    return recordRepairFailure(
      recordEvidenceRejection(
        issue,
        "Runtime interrupted during evidence inspection.",
        now,
      ),
      "RUNTIME_INTERRUPTED",
      now,
    );
  }
  return undefined;
}
