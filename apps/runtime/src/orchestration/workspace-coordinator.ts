import {
  beginFinalizationRecovery,
  recordFinalizationRecoveryResult,
  transitionIssue,
  workspaceFinalizationDiagnosticSchema,
  type Issue,
  type PendingOperation,
  type RuntimeProject,
  type RuntimeStore,
  type WorkspaceFinalizationDiagnostic,
  type FinalizationRecoveryResult,
} from "@oh-my-bug/core";
import type {
  LifecycleEventMap,
  WorkspaceBinding,
  WorkspaceFinalizationRecoveryValidation,
  WorkspacePersistence,
  WorkspaceProvider,
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
    const projectConfiguration = this.dependencies.persistence
      .getProjectConfiguration(project.id);
    const configuration = existing
      ? {
          provider: existing.providerId,
          config: projectConfiguration?.provider === existing.providerId
            ? projectConfiguration.config
            : {},
        }
      : projectConfiguration ?? { provider: "local", config: {} };
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

  async recover(): Promise<void> {
    const pendingByIssue = new Map(
      this.dependencies.store.listPendingOperations()
        .map(({ issue, operation }) => [issue.id, operation] as const),
    );
    for (const snapshot of this.dependencies.store.listIssues()) {
      if (isTerminal(snapshot)) continue;
      const issue = this.dependencies.store.getIssue(snapshot.id);
      if (!issue || issue.revision !== snapshot.revision) continue;
      const project = this.dependencies.store.getProject(issue.projectId);
      if (!project) continue;
      const pending = pendingByIssue.get(issue.id);
      const binding = this.dependencies.persistence.getBinding(issue.id);

      if (!binding) {
        if (issue.status === "RECEIVED" && !issue.projectPath && pending !== "ASSESS") {
          if (pending !== "PREPARE") this.queueRecovery(issue, "PREPARE");
          continue;
        }
        await this.recoverLegacyLocal(issue, project, pending);
        continue;
      }
      if (!this.dependencies.registry.has(binding.providerId)) {
        this.failRecovery(
          issue,
          binding.providerId,
          new Error(`WORKSPACE_PROVIDER_NOT_AVAILABLE:${binding.providerId}`),
        );
        continue;
      }
      if (!issue.projectPath || binding.status !== "READY") {
        await this.restoreBinding(issue, project, binding, pending);
        continue;
      }
      const operation = recoveryOperation(issue, pending);
      if (operation !== pending) this.queueRecovery(issue, operation);
    }
  }

  async finalize(pending: Issue): Promise<void> {
    const issue = this.dependencies.store.getIssue(pending.id);
    if (
      !issue ||
      issue.revision !== pending.revision ||
      issue.status !== "FINALIZING"
    ) return;
    const project = this.dependencies.store.getProject(issue.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const binding = this.dependencies.persistence.getBinding(issue.id);
    let provider: WorkspaceProvider | undefined;

    try {
      if (!binding || binding.status !== "READY") {
        throw new Error("WORKSPACE_BINDING_NOT_READY");
      }
      provider = this.dependencies.registry.create(binding.providerId, {});
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
        latest.status !== "FINALIZING"
      ) return;
      const diagnostic = finalizationDiagnostic(
        error,
        binding?.providerId ?? provider?.id ?? "unknown",
      );
      if (
        binding?.status === "READY"
        && latest.finalizationRecovery?.automaticAttempts !== 1
        && provider?.prepareFinalizationRecovery
      ) {
        const attemptId = this.dependencies.id();
        try {
          const context = await provider.prepareFinalizationRecovery({
            issue: latest,
            resourceId: binding.resourceId,
            diagnostic,
            attemptId,
          });
          const recovering = beginFinalizationRecovery(latest, {
            attemptId,
            diagnostic,
            fingerprintRef: context.fingerprintRef,
          }, this.dependencies.now());
          this.dependencies.persistence.transaction(() => {
            this.dependencies.store.transaction((transaction) => {
              transaction.updateIssue(
                recovering,
                latest.revision,
                "RECOVER_FINALIZATION",
              );
              transaction.appendEvent(this.event(issue.id, "WORKSPACE_PUBLISH_FAILED", {
                providerId: binding.providerId,
                error: diagnostic.code,
                diagnostic,
                automaticRecoveryAvailable: true,
              }));
              transaction.appendEvent(this.event(
                issue.id,
                "DELIVERY_FINALIZATION_RECOVERY_STARTED",
                {
                  attemptId,
                  fingerprintRef: context.fingerprintRef,
                  fingerprintSummary: context.fingerprintSummary,
                  workspaceStatus: context.workspaceStatus,
                },
              ));
            });
          });
          return;
        } catch (preparationError) {
          this.persistFinalizationFailure(
            latest,
            binding,
            diagnostic,
            "FINALIZATION_RECOVERY_PREPARATION_FAILED",
            preparationError,
          );
          return;
        }
      }
      this.persistFinalizationFailure(
        latest,
        binding,
        diagnostic,
        latest.finalizationRecovery?.automaticAttempts === 1
          ? "FINALIZATION_RECOVERY_BUDGET_SPENT"
          : "FINALIZATION_RECOVERY_UNSUPPORTED",
      );
    }
  }

  async validateFinalizationRecovery(
    pending: Issue,
    rawResult: FinalizationRecoveryResult,
  ): Promise<void> {
    const issue = this.dependencies.store.getIssue(pending.id);
    if (
      !issue
      || issue.revision !== pending.revision
      || issue.status !== "FINALIZATION_RECOVERY"
    ) return;
    const result = safeRecoveryResult(rawResult);
    const binding = this.dependencies.persistence.getBinding(issue.id);
    let validation: WorkspaceFinalizationRecoveryValidation;
    try {
      if (!binding || binding.status !== "READY") {
        throw new Error("WORKSPACE_BINDING_NOT_READY");
      }
      const provider = this.dependencies.registry.create(binding.providerId, {});
      if (!provider.validateFinalizationRecovery) {
        throw new Error("FINALIZATION_RECOVERY_UNSUPPORTED");
      }
      const fingerprintRef = issue.finalizationRecovery?.fingerprintRef;
      if (!fingerprintRef) throw new Error("FINALIZATION_RECOVERY_FINGERPRINT_REQUIRED");
      validation = await provider.validateFinalizationRecovery({
        issue,
        resourceId: binding.resourceId,
        fingerprintRef,
        result,
      });
      if (validation.kind === "UNCHANGED" && result.disposition === "UNSAFE") {
        validation = {
          kind: "UNSAFE",
          changedPaths: result.affectedPaths,
          reason: "FINALIZATION_RECOVERY_AGENT_UNSAFE",
        };
      }
    } catch (error) {
      validation = {
        kind: "UNSAFE",
        changedPaths: [],
        reason: safeRecoveryText(
          workspaceFailureMessage(error, "FINALIZATION_RECOVERY_VALIDATION_FAILED"),
          400,
        ),
      };
    }

    const next = recordFinalizationRecoveryResult(
      issue,
      result,
      validation.kind,
      this.dependencies.now(),
    );
    const operation: PendingOperation | null = validation.kind === "UNCHANGED"
      ? "FINALIZE"
      : validation.kind === "CHANGED"
        ? "CAPTURE_EVIDENCE"
        : null;
    const eventData = {
      attemptId: issue.finalizationRecovery?.attemptId,
      summary: result.summary,
      diagnosis: result.diagnosis,
      disposition: result.disposition,
      validation: validation.kind,
      changedPaths: safeRecoveryPaths(validation.changedPaths),
      ...(validation.kind === "UNSAFE"
        ? { reason: safeRecoveryText(validation.reason, 400) }
        : {}),
    };
    this.dependencies.persistence.transaction(() => {
      this.dependencies.store.transaction((transaction) => {
        transaction.updateIssue(next, issue.revision, operation);
        if (validation.kind === "UNSAFE") {
          transaction.appendEvent(this.event(
            issue.id,
            "DELIVERY_FINALIZATION_RECOVERY_FAILED",
            eventData,
          ));
          return;
        }
        transaction.appendEvent(this.event(
          issue.id,
          "DELIVERY_FINALIZATION_RECOVERY_COMPLETED",
          eventData,
        ));
        transaction.appendEvent(this.event(
          issue.id,
          validation.kind === "UNCHANGED"
            ? "DELIVERY_FINALIZATION_AUTO_RETRIED"
            : "DELIVERY_FINALIZATION_REVALIDATION_REQUIRED",
          eventData,
        ));
      });
    });
  }

  private persistFinalizationFailure(
    issue: Issue,
    binding: WorkspaceBinding | undefined,
    diagnostic: WorkspaceFinalizationDiagnostic,
    reason: string,
    cause?: unknown,
  ): void {
    const failed = {
      ...transitionIssue(
        issue,
        "FINALIZATION_ERRORED",
        this.dependencies.now(),
      ),
      finalizationRecovery: {
        ...(issue.finalizationRecovery ?? { automaticAttempts: 0 as const }),
        diagnostic,
      },
    };
    this.dependencies.persistence.transaction(() => {
      this.dependencies.store.transaction((transaction) => {
        transaction.updateIssue(failed, issue.revision, null);
        transaction.appendEvent(this.event(issue.id, "WORKSPACE_PUBLISH_FAILED", {
          providerId: binding?.providerId,
          error: diagnostic.code,
          diagnostic,
          automaticRecoveryAvailable: false,
        }));
        transaction.appendEvent(this.event(
          issue.id,
          "DELIVERY_FINALIZATION_RECOVERY_FAILED",
          {
            attemptId: issue.finalizationRecovery?.attemptId,
            reason,
            ...(cause ? {
              error: workspaceFailureMessage(
                cause,
                "FINALIZATION_RECOVERY_PREPARATION_FAILED",
              ),
            } : {}),
          },
        ));
      });
    });
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

  private async recoverLegacyLocal(
    issue: Issue,
    project: RuntimeProject,
    pending?: PendingOperation,
  ): Promise<void> {
    if (!this.dependencies.registry.has("local")) {
      this.failRecovery(issue, "local", new Error("WORKSPACE_PROVIDER_NOT_AVAILABLE:local"));
      return;
    }
    const recoveredAt = this.dependencies.now();
    const next = issue.projectPath === project.path
      ? issue
      : {
          ...issue,
          projectPath: project.path,
          revision: issue.revision + 1,
          updatedAt: recoveredAt,
        };
    this.persistRecovery(
      issue,
      next,
      {
        issueId: issue.id,
        providerId: "local",
        resourceId: `local:${issue.id}`,
        status: "READY",
        createdAt: recoveredAt,
        updatedAt: recoveredAt,
      },
      recoveryOperation(next, pending),
    );
  }

  private async restoreBinding(
    issue: Issue,
    project: RuntimeProject,
    binding: WorkspaceBinding,
    pending?: PendingOperation,
  ): Promise<void> {
    try {
      const projectConfiguration = this.dependencies.persistence
        .getProjectConfiguration(project.id);
      const provider = this.dependencies.registry.create(
        binding.providerId,
        projectConfiguration?.provider === binding.providerId
          ? projectConfiguration.config
          : {},
      );
      const acquired = await provider.acquire({ issue, project });
      if (acquired.resourceId !== binding.resourceId) {
        throw new Error("WORKSPACE_RESOURCE_ID_MISMATCH");
      }
      const recoveredAt = this.dependencies.now();
      const next = issue.projectPath === acquired.projectPath
        ? issue
        : {
            ...issue,
            projectPath: acquired.projectPath,
            revision: issue.revision + 1,
            updatedAt: recoveredAt,
          };
      this.persistRecovery(
        issue,
        next,
        { ...binding, status: "READY", updatedAt: recoveredAt },
        recoveryOperation(next, pending),
      );
    } catch (error) {
      this.failRecovery(issue, binding.providerId, error);
    }
  }

  private persistRecovery(
    previous: Issue,
    next: Issue,
    binding: WorkspaceBinding,
    pending: PendingOperation | null,
  ): void {
    this.dependencies.persistence.transaction(() => {
      this.dependencies.persistence.recoverBinding(binding);
      this.dependencies.store.transaction((transaction) => {
        transaction.updateIssue(next, previous.revision, pending);
        transaction.appendEvent(this.event(previous.id, "WORKSPACE_RECOVERED", {
          providerId: binding.providerId,
          resourceId: binding.resourceId,
        }));
      });
    });
  }

  private queueRecovery(issue: Issue, operation: PendingOperation | null): void {
    this.dependencies.store.transaction((transaction) => {
      transaction.updateIssue(issue, issue.revision, operation);
      transaction.appendEvent(this.event(issue.id, "WORKSPACE_RECOVERY_QUEUED", {
        operation,
      }));
    });
  }

  private failRecovery(issue: Issue, providerId: string, error: unknown): void {
    const message = workspaceFailureMessage(error, "WORKSPACE_RECOVERY_FAILED");
    this.dependencies.store.transaction((transaction) => {
      const current = this.dependencies.store.getIssue(issue.id);
      if (!current || current.revision !== issue.revision) return;
      transaction.updateIssue(current, current.revision, null);
      transaction.appendEvent(this.event(issue.id, "WORKSPACE_RECOVERY_FAILED", {
        providerId,
        error: message,
      }));
    });
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

function recoveryOperation(
  issue: Issue,
  pending?: PendingOperation,
): PendingOperation | null {
  if (issue.status === "FINALIZATION_RECOVERY") return "RECOVER_FINALIZATION";
  if (issue.status === "FINALIZING") return "FINALIZE";
  if (pending === "ASSESS" || pending === "REPAIR") return pending;
  if (issue.status === "RECEIVED") return "ASSESS";
  return null;
}

function isTerminal(issue: Issue): boolean {
  return ["COMPLETED", "CLOSED", "CANCELED"].includes(issue.status);
}

function workspaceFailureMessage(error: unknown, fallback = "WORKSPACE_PREPARATION_FAILED"): string {
  return error instanceof Error ? error.message : fallback;
}

function finalizationDiagnostic(
  error: unknown,
  providerId: string,
): WorkspaceFinalizationDiagnostic {
  const candidate = error && typeof error === "object" && "diagnostic" in error
    ? error.diagnostic
    : undefined;
  const parsed = workspaceFinalizationDiagnosticSchema.safeParse(candidate);
  if (parsed.success) return { ...parsed.data, providerId };
  const code = safeDiagnosticText(
    workspaceFailureMessage(error, "WORKSPACE_PUBLISH_FAILED"),
    200,
  ) || "WORKSPACE_PUBLISH_FAILED";
  return {
    providerId,
    step: "unknown",
    code,
    message: code,
    relatedPaths: [],
  };
}

function safeDiagnosticText(value: string, maxLength: number): string {
  return stripControlCharacters(value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1")
  )
    .slice(0, maxLength)
    .trim();
}

function stripControlCharacters(value: string): string {
  return [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
}

const recoverySecretAssignment = /((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)\s*[=:]\s*)([^\s"']+)/gi;
const recoveryBearerToken = /(bearer\s+)([^\s"']+)/gi;

function safeRecoveryText(value: string, maxLength: number): string {
  return safeDiagnosticText(value, maxLength)
    .replace(recoverySecretAssignment, "$1[REDACTED]")
    .replace(recoveryBearerToken, "$1[REDACTED]");
}

function safeRecoveryPaths(paths: string[]): string[] {
  return paths.slice(0, 50).map((path) => safeRecoveryText(path, 1_000));
}

function safeRecoveryResult(result: FinalizationRecoveryResult): FinalizationRecoveryResult {
  return {
    summary: safeRecoveryText(result.summary, 4_000) || "Automatic finalization recovery finished",
    diagnosis: safeRecoveryText(result.diagnosis, 4_000) || "No diagnosis was provided",
    disposition: result.disposition,
    affectedPaths: safeRecoveryPaths(result.affectedPaths),
  };
}
