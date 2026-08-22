import {
  deliverySchema,
  recordAgentSession,
  recordAssessment,
  recordAssessmentFailure,
  recordDelivery,
  recordEvidenceAcceptance,
  recordEvidenceRejection,
  recordRepairFailure,
  reviewVisualEvidence,
  transitionIssue,
  type EvidenceInspector,
  type EvidenceStore,
  type AgentAdapter,
  type AgentSessionRef,
  type Issue,
  type RepairResult,
  type RuntimeStore,
} from "@oh-my-bug/core";
import type { LifecycleEventMap } from "@oh-my-bug/module-api";

import type { AgentRegistry } from "../agents/registry.js";
import type {
  LifecycleHookFailure,
  RuntimeLifecycleHooks,
} from "../modules/lifecycle-hooks.js";
import type { WorkspaceCoordinator } from "./workspace-coordinator.js";

export interface RuntimeWorkerDependencies {
  store: RuntimeStore;
  agents: AgentRegistry;
  evidence: EvidenceStore & EvidenceInspector;
  workspaces: Pick<WorkspaceCoordinator, "prepare">;
  hooks?: RuntimeLifecycleHooks;
  id: () => string;
  now: () => string;
}

const MAX_AUTOMATIC_EVIDENCE_RETRIES = 2;

export class RuntimeWorker {
  private running?: Promise<void>;

  constructor(private readonly dependencies: RuntimeWorkerDependencies) {}

  kick(): void {
    this.running ??= this.runUntilIdle().finally(() => { this.running = undefined; });
  }

  async drain(): Promise<void> {
    this.kick();
    await this.running;
  }

  async drainOne(): Promise<void> {
    const pending = this.dependencies.store.listPendingOperations()[0];
    if (!pending) return;
    if (pending.operation === "PREPARE") return this.dependencies.workspaces.prepare(pending.issue);
    if (pending.operation === "ASSESS") return this.assess(pending.issue);
    if (pending.operation === "REPAIR") return this.repair(pending.issue);
    throw new Error("UNSUPPORTED_PENDING_OPERATION");
  }

  private async runUntilIdle(): Promise<void> {
    while (this.dependencies.store.listPendingOperations().length > 0) await this.drainOne();
  }

  private event(issueId: string, type: string, actor: "SYSTEM" | "AGENT" = "SYSTEM", data = {}) {
    return { id: this.dependencies.id(), issueId, type, actor, data, occurredAt: this.dependencies.now() };
  }

  private async assess(pending: Issue): Promise<void> {
    requireProjectPath(pending);
    const project = this.dependencies.store.getProject(pending.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    let agent: AgentAdapter;
    try {
      agent = pending.agentSession
        ? this.dependencies.agents.forSession(pending.agentSession)
        : this.dependencies.agents.forProject(project);
    } catch (error) {
      this.failPendingAssessment(pending, error);
      return;
    }
    let session: AgentSessionRef;
    try {
      session = pending.agentSession ?? await agent.createSession({ issue: pending, project });
    } catch (error) {
      this.failPendingAssessment(pending, error);
      return;
    }
    const claimed = this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(pending.id);
      if (!current || (current.status !== "RECEIVED" && current.status !== "ASSESSING")) return undefined;
      let next = current;
      if (!current.agentSession) {
        tx.insertAgentSession({
          agent: session.agent,
          logicalSessionId: session.sessionId,
          issueId: current.id,
          projectId: current.projectId,
          lifecycle: "ACTIVE",
          updatedAt: this.dependencies.now(),
        });
        next = recordAgentSession(current, session, this.dependencies.now());
      }
      if (next.status === "RECEIVED") next = transitionIssue(next, "START_ASSESSMENT", this.dependencies.now());
      tx.updateIssue(next, current.revision, null);
      tx.appendEvent(this.event(next.id, "ASSESSMENT_STARTED"));
      return next;
    });
    if (!claimed) return;
    this.emitLifecycle("assessment.before", { issue: claimed, project });
    try {
      const result = await agent.assess(session, {
        issue: claimed,
        project,
        feedback: claimed.assessmentFeedback,
      });
      const assessed = recordAssessment(claimed, result, this.dependencies.now());
      if (this.complete(claimed, assessed, "ASSESSMENT_READY")) {
        this.emitLifecycle("assessment.after", {
          issue: assessed,
          project,
          assessment: assessed.assessment,
        });
      }
    } catch (error) {
      const failed = recordAssessmentFailure(
        claimed,
        agentFailureCode(error),
        this.dependencies.now(),
      );
      if (this.complete(claimed, failed, "ASSESSMENT_FAILED")) {
        this.emitLifecycle("assessment.after", { issue: failed, project });
      }
    }
  }

  private async repair(pending: Issue): Promise<void> {
    const project = this.dependencies.store.getProject(pending.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (!pending.agentSession || !pending.assessment || !pending.repair) {
      throw new Error("REPAIR_CONTEXT_REQUIRED");
    }
    let agent: AgentAdapter;
    try {
      agent = this.dependencies.agents.forSession(pending.agentSession);
    } catch (error) {
      this.complete(
        pending,
        recordRepairFailure(pending, agentFailureCode(error), this.dependencies.now()),
        "REPAIR_FAILED",
      );
      return;
    }
    const claimed = this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(pending.id);
      if (!current || current.status !== "REPAIRING") throw new Error("REPAIR_NOT_PENDING");
      tx.updateIssue(current, current.revision, null);
      tx.appendEvent(this.event(current.id, "REPAIR_STARTED"));
      return current;
    });
    const projectPath = requireProjectPath(claimed);
    this.emitLifecycle("repair.before", { issue: claimed, project });
    let intake: Awaited<ReturnType<EvidenceStore["prepareIntake"]>>;
    try {
      intake = await this.dependencies.evidence.prepareIntake(
        claimed.id,
        claimed.repair!.iteration,
        projectPath,
      );
    } catch {
      const failed = recordRepairFailure(
        claimed,
        "EVIDENCE_INTAKE_FAILED",
        this.dependencies.now(),
      );
      if (this.complete(claimed, failed, "REPAIR_FAILED")) {
        this.emitLifecycle("repair.after", { issue: failed, project });
      }
      return;
    }
    try {
      let result: RepairResult;
      try {
        result = await agent.repair(claimed.agentSession!, {
          issue: claimed,
          project,
          assessment: claimed.assessment!,
          evidenceDirectory: intake.directory,
          previousDelivery: claimed.repair?.delivery,
          feedback: claimed.repair?.feedback,
        });
      } catch (error) {
        const outputFailure = repairOutputFailure(error);
        if (outputFailure) {
          this.requeueRepair(claimed, outputFailure.feedback, outputFailure.code);
          const retrying = this.dependencies.store.getIssue(claimed.id);
          if (retrying) this.emitLifecycle("repair.after", { issue: retrying, project });
          return;
        }
        const failed = recordRepairFailure(
          claimed,
          agentFailureCode(error),
          this.dependencies.now(),
        );
        if (this.complete(claimed, failed, "REPAIR_FAILED")) {
          this.emitLifecycle("repair.after", { issue: failed, project });
        }
        return;
      }

      try {
        const evidence = [];
        for (const item of result.evidence) {
          evidence.push(await this.dependencies.evidence.import({
            issueId: claimed.id,
            repairIteration: claimed.repair!.iteration,
            workspaceDirectory: projectPath,
            intakeDirectory: intake.directory,
            ...item,
          }));
        }
        const delivery = deliverySchema.parse({ summary: result.summary, evidence });
        const delivered = recordDelivery(claimed, delivery, this.dependencies.now());
        if (!this.complete(claimed, delivered, "DELIVERY_READY")) return;
        this.emitLifecycle("repair.after", { issue: delivered, project });

        const inspections = await Promise.all(delivery.evidence.map((item) =>
          this.dependencies.evidence.inspect(
            delivered.id,
            delivered.repair!.iteration,
            item.evidenceId,
          )));
        const gate = reviewVisualEvidence(delivery, delivered.repair!.iteration, inspections);
        const current = this.dependencies.store.getIssue(delivered.id);
        if (!current || current.revision !== delivered.revision) return;
        if (gate.reviewable) {
          this.complete(current, recordEvidenceAcceptance(current, this.dependencies.now()), "EVIDENCE_ACCEPTED");
        } else {
          this.requeueEvidence(current, gate.reasons.map((reason) => reason.message).join("\n"));
        }
      } catch (error) {
        const current = this.dependencies.store.getIssue(claimed.id);
        if (current?.revision === claimed.revision) {
          this.requeueRepair(current, publicEvidenceFailure(error), "EVIDENCE_IMPORT_FAILED");
        } else if (current?.status === "EVIDENCE_CHECK") {
          this.requeueEvidence(current, publicEvidenceFailure(error));
        }
      }
    } finally {
      await intake.cleanup();
    }
  }

  private requeueRepair(current: Issue, feedback: string, failureCode: string): void {
    const automaticRetries = current.repair?.automaticEvidenceRetries ?? 0;
    if (automaticRetries >= MAX_AUTOMATIC_EVIDENCE_RETRIES) {
      this.complete(
        current,
        recordRepairFailure(current, failureCode, this.dependencies.now()),
        "REPAIR_FAILED",
      );
      return;
    }
    const failed = recordRepairFailure(current, failureCode, this.dependencies.now());
    const retrying = transitionIssue(failed, "RETRY_REPAIR", this.dependencies.now());
    const next = {
      ...retrying,
      repair: {
        ...(retrying.repair ?? { iteration: 1 }),
        automaticEvidenceRetries: automaticRetries + 1,
        feedback,
      },
      lastFailure: undefined,
    };
    this.complete(current, next, "EVIDENCE_REJECTED", "REPAIR");
  }

  private failPendingAssessment(pending: Issue, error: unknown): void {
    this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(pending.id);
      if (
        !current ||
        current.revision !== pending.revision ||
        (current.status !== "RECEIVED" && current.status !== "ASSESSING")
      ) return;
      const assessing = current.status === "RECEIVED"
        ? transitionIssue(current, "START_ASSESSMENT", this.dependencies.now())
        : current;
      const failed = recordAssessmentFailure(
        assessing,
        agentFailureCode(error),
        this.dependencies.now(),
      );
      tx.updateIssue(failed, current.revision, null);
      if (current.status === "RECEIVED") {
        tx.appendEvent(this.event(current.id, "ASSESSMENT_STARTED"));
      }
      tx.appendEvent(this.event(current.id, "ASSESSMENT_FAILED", "AGENT"));
    });
  }

  private requeueEvidence(current: Issue, feedback: string): void {
    const automaticRetries = current.repair?.automaticEvidenceRetries ?? 0;
    if (automaticRetries >= MAX_AUTOMATIC_EVIDENCE_RETRIES) {
      this.complete(
        current,
        recordRepairFailure(current, "EVIDENCE_RETRY_LIMIT_REACHED", this.dependencies.now()),
        "REPAIR_FAILED",
      );
      return;
    }
    const rejected = recordEvidenceRejection(current, feedback, this.dependencies.now());
    this.complete(
      current,
      {
        ...rejected,
        repair: {
          ...(rejected.repair ?? { iteration: 1 }),
          automaticEvidenceRetries: automaticRetries + 1,
        },
      },
      "EVIDENCE_REJECTED",
      "REPAIR",
    );
  }

  private complete(
    previous: Issue,
    next: Issue,
    type: string,
    pending: "REPAIR" | null = null,
  ): boolean {
    return this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(previous.id);
      if (!current || current.revision !== previous.revision) return false;
      tx.updateIssue(next, previous.revision, pending);
      tx.appendEvent(this.event(next.id, type, "AGENT"));
      return true;
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
            message: publicModuleError(failure.error),
          },
          occurredAt: this.dependencies.now(),
        });
      }
    });
  }
}

function requireProjectPath(issue: Issue): string {
  if (!issue.projectPath) throw new Error("ISSUE_PROJECT_PATH_REQUIRED");
  return issue.projectPath;
}

function publicModuleError(error: unknown): string {
  return error instanceof Error ? error.message : "MODULE_HOOK_FAILED";
}

function agentFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return "AGENT_FAILURE";
  if (error.message === "AGENT_SESSION_UNAVAILABLE") return "AGENT_SESSION_UNAVAILABLE";
  if (error.message.startsWith("AGENT_PLUGIN_NOT_INSTALLED:")) {
    return "AGENT_PLUGIN_NOT_INSTALLED";
  }
  return "AGENT_FAILURE";
}

function repairOutputFailure(error: unknown): { code: string; feedback: string } | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = error.message;
  if (code === "EVIDENCE_LABEL_REQUIRED") {
    return {
      code,
      feedback: "Every screenshot or recording requires a concise, non-empty label. Capture valid visual evidence and label what it proves.",
    };
  }
  if (["EVIDENCE_PATH_REQUIRED", "EVIDENCE_PATH_ESCAPE"].includes(code)) {
    return {
      code,
      feedback: "Capture visual evidence inside the provided evidence directory and return its safe, non-empty relative path.",
    };
  }
  if (code === "VISUAL_EVIDENCE_REQUIRED") {
    return {
      code,
      feedback: "At least one real screenshot or recording is required. Capture it in the provided evidence directory and return its label and relative path.",
    };
  }
  if (["EVIDENCE_TYPE_REQUIRED", "EVIDENCE_TYPE_INVALID"].includes(code)) {
    return {
      code,
      feedback: "Every visual evidence item must use type screenshot or recording and include a valid label and relative path.",
    };
  }
  if ([
    "DELIVERY_SUMMARY_REQUIRED",
    "CODEX_OUTPUT_INVALID",
    "CODEX_OUTPUT_UNKNOWN_FIELD",
    "INVALID_CODEX_OUTPUT",
  ].includes(code)) {
    return {
      code,
      feedback: "Return a valid structured Repair result with a non-empty summary and real visual evidence containing type, label, and relativePath.",
    };
  }
  return undefined;
}

function publicEvidenceFailure(error: unknown): string {
  void error;
  return "Evidence could not be imported or verified. Produce new screenshot or recording evidence.";
}
