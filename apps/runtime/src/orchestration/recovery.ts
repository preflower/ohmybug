import type {
  Issue,
  PendingOperation,
  RuntimeStore,
} from "@oh-my-bug/core";

import type { WorkspaceCoordinator } from "./workspace-coordinator.js";
import { EVIDENCE_CAPTURE_FAILURE_CODES } from "../evidence/capture-provider.js";

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
  for (const issue of dependencies.store.listIssues()) {
    migrateLegacyFailure(dependencies, issue);
  }
  const pendingIds = new Set(
    dependencies.store.listPendingOperations().map(({ issue }) => issue.id),
  );
  for (const issue of dependencies.store.listIssues()) {
    if (pendingIds.has(issue.id)) continue;
    const submittedReview = submittedReviewOperation(dependencies.store, issue);
    if (submittedReview) {
      dependencies.store.transaction((transaction) => {
        const current = dependencies.store.getIssue(issue.id);
        if (!current || current.revision !== issue.revision) return;
        transaction.updateIssue(current, current.revision, submittedReview);
      });
      continue;
    }
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

function submittedReviewOperation(
  store: RuntimeStore,
  issue: Issue,
): PendingOperation | undefined {
  if (issue.status !== "REPAIRING") return undefined;
  const submitted = store.readEvents(issue.id).findLast((event) =>
    event.type === "REVIEW_SUBMITTED" &&
    event.data.operation === "REPAIR" &&
    event.data.revision === issue.revision);
  return submitted ? "REPAIR" : undefined;
}

const LEGACY_EVIDENCE_FAILURE_CODES = new Set<string>([
  ...EVIDENCE_CAPTURE_FAILURE_CODES,
  "EVIDENCE_INTAKE_FAILED",
  "EVIDENCE_IMPORT_FAILED",
  "EVIDENCE_RETRY_LIMIT_REACHED",
]);

function migrateLegacyFailure(
  dependencies: RecoveryDependencies,
  issue: Issue,
): void {
  if (
    issue.status !== "REPAIR_FAILED" ||
    issue.lastFailure?.stage !== "REPAIR"
  ) return;
  if (issue.lastFailure.code === "RUNTIME_INTERRUPTED") {
    dependencies.store.transaction((transaction) => {
      const current = dependencies.store.getIssue(issue.id);
      if (
        !current ||
        current.revision !== issue.revision ||
        current.status !== "REPAIR_FAILED" ||
        current.lastFailure?.code !== "RUNTIME_INTERRUPTED"
      ) return;
      const resumable = {
        ...current,
        status: "REPAIRING" as const,
        lastFailure: undefined,
        revision: current.revision + 1,
        updatedAt: dependencies.now(),
      };
      transaction.updateIssue(resumable, current.revision, "REPAIR");
      transaction.appendEvent({
        id: dependencies.id(),
        issueId: resumable.id,
        type: "ISSUE_REPAIR_STATE_RECOVERED",
        actor: "SYSTEM",
        data: { from: "REPAIR_FAILED", to: "REPAIRING", operation: "REPAIR" },
        occurredAt: dependencies.now(),
      });
    });
    return;
  }
  if (
    !LEGACY_EVIDENCE_FAILURE_CODES.has(issue.lastFailure.code) ||
    !issue.repair?.delivery
  ) return;
  dependencies.store.transaction((transaction) => {
    const current = dependencies.store.getIssue(issue.id);
    if (
      !current ||
      current.revision !== issue.revision ||
      current.status !== "REPAIR_FAILED" ||
      !current.repair?.delivery ||
      current.lastFailure?.stage !== "REPAIR" ||
      !LEGACY_EVIDENCE_FAILURE_CODES.has(current.lastFailure.code)
    ) return;
    const migrated = {
      ...current,
      status: "EVIDENCE_FAILED" as const,
      repair: {
        ...current.repair,
        evidenceRetries: current.repair.evidenceRetries
          ?? current.repair.automaticEvidenceRetries
          ?? 0,
        deliveryDraft: current.repair.deliveryDraft ?? {
          summary: current.repair.delivery.summary,
          repairIteration: current.repair.iteration,
          implementationCompletedAt: current.updatedAt,
        },
      },
      lastFailure: {
        stage: "EVIDENCE" as const,
        code: current.lastFailure.code,
      },
      revision: current.revision + 1,
      updatedAt: dependencies.now(),
    };
    transaction.updateIssue(migrated, current.revision, null);
    transaction.appendEvent({
      id: dependencies.id(),
      issueId: migrated.id,
      type: "ISSUE_EVIDENCE_STATE_MIGRATED",
      actor: "SYSTEM",
      data: { from: "REPAIR_FAILED", to: "EVIDENCE_FAILED" },
      occurredAt: dependencies.now(),
    });
  });
}

export function interruptedOperation(issue: Issue): PendingOperation | undefined {
  if (
    issue.status === "FINALIZATION_RECOVERY"
    && issue.finalizationRecovery?.automaticAttempts === 1
    && issue.finalizationRecovery.attemptId
    && issue.finalizationRecovery.fingerprintRef
  ) return "RECOVER_FINALIZATION";
  if (issue.status === "ASSESSING") return "ASSESS";
  if (issue.status === "REPAIRING") return "REPAIR";
  if (issue.status === "EVIDENCE_CAPTURE" && issue.repair?.deliveryDraft) {
    return "CAPTURE_EVIDENCE";
  }
  if (issue.status === "EVIDENCE_CHECK" && issue.repair?.delivery) return "EVIDENCE";
  return undefined;
}
