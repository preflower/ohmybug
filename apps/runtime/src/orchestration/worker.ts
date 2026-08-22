import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

import {
  deliverySchema,
  isAgentTurnInterruptedError,
  recordAgentSession,
  recordAssessment,
  recordAssessmentFailure,
  recordDelivery,
  recordEvidenceAcceptance,
  recordEvidenceFailure,
  recordEvidenceRejection,
  recordImplementationDraft,
  recordRepairFailure,
  reviewVisualEvidence,
  transitionIssue,
  type EvidenceInspector,
  type EvidenceStore,
  type AgentAdapter,
  type AgentContinuation,
  type AgentSessionRef,
  type Issue,
  type PendingOperation,
  type RepairResult,
  type RepairEvidencePath,
  type RuntimeStore,
} from "@oh-my-bug/core";
import type { LifecycleEventMap } from "@oh-my-bug/module-api";

import type { AgentRegistry } from "../agents/registry.js";
import {
  EvidenceCaptureError,
  type EvidenceCaptureProvider,
} from "../evidence/capture-provider.js";
import type {
  LifecycleHookFailure,
  RuntimeLifecycleHooks,
} from "../modules/lifecycle-hooks.js";
import type { WorkspaceCoordinator } from "./workspace-coordinator.js";

export interface RuntimeWorkerDependencies {
  store: RuntimeStore;
  agents: AgentRegistry;
  evidence: EvidenceStore & EvidenceInspector;
  capture?: EvidenceCaptureProvider;
  workspaces: Pick<WorkspaceCoordinator, "prepare" | "finalize" | "recover">;
  hooks?: RuntimeLifecycleHooks;
  id: () => string;
  now: () => string;
}

const MAX_AUTOMATIC_EVIDENCE_RETRIES = 2;

export class RuntimeWorker {
  private running?: Promise<void>;
  private accepting = true;

  constructor(private readonly dependencies: RuntimeWorkerDependencies) {}

  kick(): void {
    if (!this.accepting) return;
    this.running ??= this.runUntilIdle().finally(() => { this.running = undefined; });
  }

  beginShutdown(): void {
    this.accepting = false;
  }

  async drain(): Promise<void> {
    if (this.accepting) this.kick();
    await this.running;
  }

  async drainOne(): Promise<void> {
    const pending = this.dependencies.store.listPendingOperations()[0];
    if (!pending) return;
    if (pending.operation === "PREPARE") return this.dependencies.workspaces.prepare(pending.issue);
    if (pending.operation === "ASSESS") return this.assess(pending.issue);
    if (pending.operation === "REPAIR") return this.repair(pending.issue);
    if (pending.operation === "CAPTURE_EVIDENCE") return this.captureEvidence(pending.issue);
    if (pending.operation === "EVIDENCE") return this.inspectEvidence(pending.issue);
    if (pending.operation === "FINALIZE") return this.dependencies.workspaces.finalize(pending.issue);
    throw new Error("UNSUPPORTED_PENDING_OPERATION");
  }

  private async runUntilIdle(): Promise<void> {
    while (
      this.accepting &&
      this.dependencies.store.listPendingOperations().length > 0
    ) await this.drainOne();
  }

  private event(issueId: string, type: string, actor: "SYSTEM" | "AGENT" = "SYSTEM", data = {}) {
    return { id: this.dependencies.id(), issueId, type, actor, data, occurredAt: this.dependencies.now() };
  }

  private async assess(pending: Issue): Promise<void> {
    requireProjectPath(pending);
    const project = this.dependencies.store.getProject(pending.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const continuation = this.continuation(pending, "ASSESS");
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
    const attemptId = this.dependencies.id();
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
      tx.appendEvent(this.event(next.id, "ASSESSMENT_STARTED", "SYSTEM", { attemptId }));
      return next;
    });
    if (!claimed) return;
    this.emitLifecycle("assessment.before", { issue: claimed, project });
    try {
      const result = await agent.assess(session, {
        issue: claimed,
        project,
        feedback: claimed.assessmentFeedback,
        continuation,
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
      if (this.requeueInterrupted(claimed, error, "ASSESS", attemptId)) return;
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
    const continuation = this.continuation(pending, "REPAIR");
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
    const attemptId = this.dependencies.id();
    const claimed = this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(pending.id);
      if (!current || current.status !== "REPAIRING") throw new Error("REPAIR_NOT_PENDING");
      tx.updateIssue(current, current.revision, null);
      tx.appendEvent(this.event(current.id, "REPAIR_STARTED", "SYSTEM", { attemptId }));
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
          continuation,
        });
      } catch (error) {
        if (this.requeueInterrupted(claimed, error, "REPAIR", attemptId)) return;
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

      const drafted = recordImplementationDraft(claimed, result.summary, this.dependencies.now());
      if (result.evidence.length === 0) {
        if (this.complete(claimed, drafted, "IMPLEMENTATION_READY", "CAPTURE_EVIDENCE")) {
          this.emitLifecycle("repair.after", { issue: drafted, project });
        }
        return;
      }
      if (!this.complete(claimed, drafted, "IMPLEMENTATION_READY")) return;
      try {
        const delivered = await this.importDelivery(drafted, intake, result.evidence);
        if (this.complete(drafted, delivered, "DELIVERY_READY", "EVIDENCE")) {
          this.emitLifecycle("repair.after", { issue: delivered, project });
        }
      } catch (error) {
        this.queueEvidenceCapture(
          drafted,
          publicEvidenceFailure(error),
          evidenceFailureCode(error, "EVIDENCE_IMPORT_FAILED"),
        );
      }
    } finally {
      await intake.cleanup();
    }
  }

  private async captureEvidence(pending: Issue): Promise<void> {
    const project = this.dependencies.store.getProject(pending.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (
      !pending.agentSession ||
      !pending.assessment ||
      !pending.repair?.deliveryDraft ||
      pending.status !== "EVIDENCE_CAPTURE"
    ) throw new Error("EVIDENCE_CAPTURE_CONTEXT_REQUIRED");
    const attemptId = this.dependencies.id();
    const claimed = this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(pending.id);
      if (!current || current.status !== "EVIDENCE_CAPTURE" || !current.repair?.deliveryDraft) {
        return undefined;
      }
      tx.updateIssue(current, current.revision, null);
      tx.appendEvent(this.event(current.id, "EVIDENCE_CAPTURE_STARTED", "SYSTEM", { attemptId }));
      return current;
    });
    if (!claimed?.repair?.deliveryDraft) return;
    const projectPath = requireProjectPath(claimed);
    let intake: Awaited<ReturnType<EvidenceStore["prepareIntake"]>>;
    try {
      intake = await this.dependencies.evidence.prepareIntake(
        claimed.id,
        claimed.repair.iteration,
        projectPath,
      );
    } catch (error) {
      this.queueEvidenceCapture(
        claimed,
        publicEvidenceFailure(error),
        "EVIDENCE_INTAKE_FAILED",
      );
      return;
    }

    try {
      let evidence: RepairEvidencePath[];
      try {
        if (project.commands?.evidenceCapture) {
          evidence = [await this.captureWithHost(project, claimed, intake.directory)];
        } else {
          const agent = this.dependencies.agents.forSession(claimed.agentSession!);
          const result = await agent.captureEvidence(claimed.agentSession!, {
            issue: claimed,
            project,
            assessment: claimed.assessment!,
            deliveryDraft: claimed.repair.deliveryDraft,
            evidenceDirectory: intake.directory,
            feedback: claimed.repair.feedback,
            continuation: this.continuation(claimed, "CAPTURE_EVIDENCE"),
          });
          evidence = result.evidence;
        }
      } catch (error) {
        if (this.requeueInterrupted(claimed, error, "CAPTURE_EVIDENCE", attemptId)) return;
        this.queueEvidenceCapture(
          claimed,
          publicEvidenceFailure(error),
          evidenceFailureCode(error, "EVIDENCE_CAPTURE_PROCESS_FAILED"),
        );
        return;
      }

      try {
        const delivered = await this.importDelivery(claimed, intake, evidence);
        this.complete(claimed, delivered, "DELIVERY_READY", "EVIDENCE");
      } catch (error) {
        this.queueEvidenceCapture(
          claimed,
          publicEvidenceFailure(error),
          evidenceFailureCode(error, "EVIDENCE_IMPORT_FAILED"),
        );
      }
    } finally {
      await intake.cleanup();
    }
  }

  private async captureWithHost(
    project: NonNullable<ReturnType<RuntimeStore["getProject"]>>,
    issue: Issue,
    intakeDirectory: string,
  ): Promise<RepairEvidencePath> {
    const capture = project.commands?.evidenceCapture;
    if (!capture || !this.dependencies.capture) {
      throw new EvidenceCaptureError(
        "EVIDENCE_CAPTURE_PROCESS_FAILED",
        capture?.mode ?? "command",
        "host-provider",
      );
    }
    const artifact = await this.dependencies.capture.capture({
      issueId: issue.id,
      workspaceDirectory: requireProjectPath(issue),
      intakeDirectory,
      commands: project.commands ?? {},
      capture,
    });
    const [actualDirectory, actualArtifact] = await Promise.all([
      realpath(intakeDirectory),
      realpath(artifact.path),
    ]);
    const relativePath = relative(actualDirectory, actualArtifact);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new EvidenceCaptureError(
        "EVIDENCE_CAPTURE_PERMISSION_DENIED",
        capture.mode,
        "host-artifact",
      );
    }
    return { type: artifact.type, label: artifact.label, relativePath };
  }

  private async importDelivery(
    issue: Issue,
    intake: Awaited<ReturnType<EvidenceStore["prepareIntake"]>>,
    paths: RepairEvidencePath[],
  ): Promise<Issue> {
    const evidence = [];
    for (const item of paths) {
      evidence.push(await this.dependencies.evidence.import({
        issueId: issue.id,
        repairIteration: issue.repair!.iteration,
        workspaceDirectory: requireProjectPath(issue),
        intakeDirectory: intake.directory,
        ...item,
      }));
    }
    const delivery = deliverySchema.parse({
      summary: issue.repair?.deliveryDraft?.summary,
      evidence,
    });
    return recordDelivery(issue, delivery, this.dependencies.now());
  }

  private async inspectEvidence(pending: Issue): Promise<void> {
    const claimed = this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(pending.id);
      if (!current || current.status !== "EVIDENCE_CHECK" || !current.repair?.delivery) {
        return undefined;
      }
      tx.updateIssue(current, current.revision, null);
      tx.appendEvent(this.event(current.id, "EVIDENCE_CHECK_STARTED"));
      return current;
    });
    if (!claimed?.repair?.delivery) return;

    try {
      const delivery = claimed.repair.delivery;
      const inspections = await Promise.all(delivery.evidence.map((item) =>
        this.dependencies.evidence.inspect(
          claimed.id,
          claimed.repair!.iteration,
          item.evidenceId,
        )));
      const gate = reviewVisualEvidence(delivery, claimed.repair.iteration, inspections);
      if (gate.reviewable) {
        this.complete(
          claimed,
          recordEvidenceAcceptance(claimed, this.dependencies.now()),
          "EVIDENCE_ACCEPTED",
        );
      } else {
        this.requeueEvidence(
          claimed,
          gate.reasons.map((reason) => reason.message).join("\n"),
        );
      }
    } catch (error) {
      this.requeueEvidence(claimed, publicEvidenceFailure(error));
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

  private continuation(
    issue: Issue,
    operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE",
  ): AgentContinuation | undefined {
    const interrupted = this.dependencies.store.readEvents(issue.id).findLast((event) =>
      event.type === "RUNTIME_INTERRUPTED" &&
      event.data.operation === operation &&
      event.data.revision === issue.revision);
    if (!interrupted) return undefined;
    return {
      reason: "RUNTIME_INTERRUPTED",
      ...(typeof interrupted.data.attemptId === "string"
        ? { previousAttemptId: interrupted.data.attemptId }
        : {}),
    };
  }

  private requeueInterrupted(
    claimed: Issue,
    error: unknown,
    operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE",
    attemptId: string,
  ): boolean {
    if (
      !isAgentTurnInterruptedError(error) ||
      error.reason !== "RUNTIME_STOPPING"
    ) return false;

    return this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(claimed.id);
      if (!current || current.revision !== claimed.revision) return true;
      const resumable = {
        ...current,
        revision: current.revision + 1,
        updatedAt: this.dependencies.now(),
      };
      tx.updateIssue(resumable, current.revision, operation);
      tx.appendEvent(this.event(resumable.id, "RUNTIME_INTERRUPTED", "SYSTEM", {
        stage: operation === "ASSESS" ? "ASSESSMENT" : operation === "REPAIR" ? "REPAIR" : "EVIDENCE",
        reason: error.reason,
        operation,
        attemptId,
        revision: resumable.revision,
        ...(resumable.agentSession
          ? { sessionId: resumable.agentSession.sessionId }
          : {}),
        ...(operation !== "ASSESS" && resumable.repair
          ? { iteration: resumable.repair.iteration }
          : {}),
      }));
      return true;
    });
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
    this.queueEvidenceCapture(current, feedback, "EVIDENCE_NOT_REVIEWABLE");
  }

  private queueEvidenceCapture(
    current: Issue,
    feedback: string,
    failureCode = "EVIDENCE_NOT_REVIEWABLE",
  ): void {
    const retries = current.repair?.evidenceRetries ?? 0;
    if (retries >= MAX_AUTOMATIC_EVIDENCE_RETRIES) {
      this.complete(
        current,
        recordEvidenceFailure(
          current,
          "EVIDENCE_RETRY_LIMIT_REACHED",
          this.dependencies.now(),
        ),
        "EVIDENCE_FAILED",
      );
      return;
    }
    const capturing = current.status === "EVIDENCE_CHECK"
      ? recordEvidenceRejection(current, feedback, this.dependencies.now())
      : current;
    const next = {
      ...capturing,
      repair: {
        ...capturing.repair!,
        evidenceRetries: retries + 1,
        feedback,
        delivery: undefined,
      },
      lastFailure: undefined,
      ...(capturing.revision === current.revision
        ? {
            revision: current.revision + 1,
            updatedAt: this.dependencies.now(),
          }
        : {}),
    };
    this.complete(
      current,
      next,
      "EVIDENCE_CAPTURE_REQUEUED",
      "CAPTURE_EVIDENCE",
      { code: failureCode },
    );
  }

  private complete(
    previous: Issue,
    next: Issue,
    type: string,
    pending: PendingOperation | null = null,
    data: Record<string, unknown> = {},
  ): boolean {
    return this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(previous.id);
      if (!current || current.revision !== previous.revision) return false;
      tx.updateIssue(next, previous.revision, pending);
      tx.appendEvent(this.event(next.id, type, "AGENT", data));
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

function evidenceFailureCode(error: unknown, fallback: string): string {
  return error instanceof EvidenceCaptureError ? error.code : fallback;
}
