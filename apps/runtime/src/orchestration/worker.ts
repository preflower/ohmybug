import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

import {
  deliverySchema,
  reviewJsonSchema,
  isAgentCapabilityRequiredError,
  isAgentTurnInterruptedError,
  recordCapabilityRequest,
  recordAgentSession,
  recordAssessment,
  recordAssessmentFailure,
  recordDelivery,
  recordEvidenceAcceptance,
  recordEvidenceFailure,
  recordEvidenceRejection,
  recordImplementationDraft,
  requestReview,
  recordRepairFailure,
  reviewVisualEvidence,
  transitionIssue,
  type EvidenceInspector,
  type EvidenceStore,
  type FinalizationRecoveryResult,
  type AgentAdapter,
  type AgentContinuation,
  type AgentSessionRef,
  type Issue,
  type PendingOperation,
  type RepairResult,
  type RepairEvidencePath,
  type RuntimeStore,
} from "@oh-my-bug/core";
import type {
  LifecycleEventMap,
  WorkspaceRepairObservation,
} from "@oh-my-bug/module-api";

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
import { publicCapabilityRequest } from "./capability-request.js";
import {
  assessmentReview,
  businessMergeReview,
  deliveryReview,
} from "./reviews.js";

export interface RuntimeWorkerDependencies {
  store: RuntimeStore;
  agents: AgentRegistry;
  evidence: EvidenceStore & EvidenceInspector;
  capture?: EvidenceCaptureProvider;
  workspaces: Pick<
    WorkspaceCoordinator,
    | "prepare"
    | "finalize"
    | "recover"
    | "observeRepair"
    | "validateRepair"
    | "validateFinalizationRecovery"
  >;
  hooks?: RuntimeLifecycleHooks;
  id: () => string;
  now: () => string;
}

export interface RuntimeWorkerOptions {
  maxConcurrentIssues?: number;
}

type OperationSettlement =
  | { kind: "settled"; issueId: string; ok: true }
  | { kind: "settled"; issueId: string; ok: false; error: unknown };

type SchedulerProgress = OperationSettlement | { kind: "wake" };

const DEFAULT_MAX_CONCURRENT_ISSUES = 3;
const MAX_AUTOMATIC_EVIDENCE_RETRIES = 2;

export class RuntimeWorker {
  private running?: Promise<void>;
  private accepting = true;
  private wakeRequested = false;
  private wakeScheduler?: () => void;
  private readonly maxConcurrentIssues: number;

  constructor(
    private readonly dependencies: RuntimeWorkerDependencies,
    options: RuntimeWorkerOptions = {},
  ) {
    const maxConcurrentIssues = options.maxConcurrentIssues
      ?? DEFAULT_MAX_CONCURRENT_ISSUES;
    if (!Number.isInteger(maxConcurrentIssues) || maxConcurrentIssues < 1) {
      throw new Error("INVALID_MAX_CONCURRENT_ISSUES");
    }
    this.maxConcurrentIssues = maxConcurrentIssues;
  }

  kick(): void {
    if (!this.accepting) return;
    this.wakeRequested = true;
    if (this.running) {
      this.wakeScheduler?.();
      return;
    }
    const pump = Promise.resolve().then(() => this.runUntilIdle());
    this.running = pump;
    void pump.then(
      () => this.finishPump(pump),
      () => this.finishPump(pump),
    );
  }

  beginShutdown(): void {
    this.accepting = false;
  }

  async drain(): Promise<void> {
    if (this.accepting) this.kick();
    let firstFailure: { error: unknown } | undefined;
    while (this.running) {
      try {
        await this.running;
      } catch (error) {
        firstFailure ??= { error };
      }
    }
    if (firstFailure) throw firstFailure.error;
  }

  async drainOne(): Promise<void> {
    const pending = this.dependencies.store.listPendingOperations()[0];
    if (!pending) return;
    await this.runPendingOperation(pending);
  }

  private async runPendingOperation(
    pending: ReturnType<RuntimeStore["listPendingOperations"]>[number],
  ): Promise<void> {
    if (pending.operation === "PREPARE") {
      return this.dependencies.workspaces.prepare(pending.issue);
    }
    if (pending.operation === "ASSESS") return this.assess(pending.issue);
    if (pending.operation === "REPAIR") return this.repair(pending.issue);
    if (pending.operation === "CAPTURE_EVIDENCE") {
      return this.captureEvidence(pending.issue);
    }
    if (pending.operation === "EVIDENCE") return this.inspectEvidence(pending.issue);
    if (pending.operation === "FINALIZE") {
      return this.dependencies.workspaces.finalize(pending.issue);
    }
    if (pending.operation === "RECOVER_FINALIZATION") {
      return this.recoverFinalization(pending.issue);
    }
    throw new Error("UNSUPPORTED_PENDING_OPERATION");
  }

  private async runUntilIdle(): Promise<void> {
    const active = new Map<string, Promise<OperationSettlement>>();
    const failedInPump = new Set<string>();
    let firstFailure: { error: unknown } | undefined;

    while (true) {
      if (this.accepting) {
        this.wakeRequested = false;
        for (const pending of this.dependencies.store.listPendingOperations()) {
          if (active.size >= this.maxConcurrentIssues) break;
          const issueId = pending.issue.id;
          if (active.has(issueId) || failedInPump.has(issueId)) continue;

          const operation = Promise.resolve()
            .then(() => this.runPendingOperation(pending))
            .then<OperationSettlement, OperationSettlement>(
              () => ({ kind: "settled", issueId, ok: true }),
              (error: unknown) => ({ kind: "settled", issueId, ok: false, error }),
            );
          active.set(issueId, operation);
        }
      }

      if (active.size === 0) break;
      const progress = await this.waitForProgress(active);
      if (progress.kind === "wake") continue;

      active.delete(progress.issueId);
      if (!progress.ok) {
        failedInPump.add(progress.issueId);
        firstFailure ??= { error: progress.error };
      }
    }

    if (firstFailure) throw firstFailure.error;
  }

  private finishPump(pump: Promise<void>): void {
    if (this.running !== pump) return;
    this.running = undefined;
    if (this.accepting && this.wakeRequested) this.kick();
  }

  private async waitForProgress(
    active: Map<string, Promise<OperationSettlement>>,
  ): Promise<SchedulerProgress> {
    let wake!: () => void;
    const woken = new Promise<SchedulerProgress>((resolve) => {
      wake = () => resolve({ kind: "wake" });
    });
    this.wakeScheduler = wake;
    try {
      return await Promise.race([...active.values(), woken]);
    } finally {
      if (this.wakeScheduler === wake) this.wakeScheduler = undefined;
    }
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
      const reviewedAt = this.dependencies.now();
      const assessed = recordAssessment(claimed, result, reviewedAt);
      const reviewed = requestReview(
        assessed,
        assessmentReview(assessed, this.dependencies.id(), reviewedAt),
        reviewedAt,
      );
      if (this.completeReview(claimed, reviewed, "ASSESSMENT_READY")) {
        this.emitLifecycle("assessment.after", {
          issue: reviewed,
          project,
          assessment: reviewed.assessment,
        });
      }
    } catch (error) {
      if (this.pauseForCapability(
        claimed,
        error,
        "ASSESS",
        "ASSESSMENT",
        attemptId,
      )) return;
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
    let observation: WorkspaceRepairObservation;
    let integration: Parameters<AgentAdapter["repair"]>[1]["integration"];
    try {
      observation = await this.dependencies.workspaces.observeRepair(claimed);
      integration = repairIntegrationInput(observation);
    } catch (error) {
      const failed = recordRepairFailure(
        claimed,
        repairFailureCode(error),
        this.dependencies.now(),
      );
      if (this.complete(claimed, failed, "REPAIR_FAILED")) {
        this.emitLifecycle("repair.after", { issue: failed, project });
      }
      return;
    }
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
          ...(integration ? { integration } : {}),
        });
      } catch (error) {
        if (this.pauseForCapability(
          claimed,
          error,
          "REPAIR",
          "REPAIR",
          attemptId,
        )) return;
        if (this.requeueInterrupted(claimed, error, "REPAIR", attemptId)) return;
        const failed = recordRepairFailure(
          claimed,
          repairFailureCode(error),
          this.dependencies.now(),
        );
        if (this.complete(claimed, failed, "REPAIR_FAILED")) {
          this.emitLifecycle("repair.after", { issue: failed, project });
        }
        return;
      }

      let validation: Awaited<ReturnType<WorkspaceCoordinator["validateRepair"]>>;
      try {
        validation = await this.dependencies.workspaces.validateRepair(
          claimed,
          observation,
          result,
          intake.directory,
        );
      } catch (error) {
        const failed = recordRepairFailure(
          claimed,
          repairFailureCode(error),
          this.dependencies.now(),
        );
        if (this.complete(claimed, failed, "REPAIR_FAILED")) {
          this.emitLifecycle("repair.after", { issue: failed, project });
        }
        return;
      }

      if (result.kind === "BUSINESS_DECISION_REQUIRED") {
        if (validation.kind !== "BUSINESS_DECISION_REQUIRED") {
          const failed = recordRepairFailure(
            claimed,
            "WORKSPACE_REPAIR_VALIDATION_MISMATCH",
            this.dependencies.now(),
          );
          if (this.complete(claimed, failed, "REPAIR_FAILED")) {
            this.emitLifecycle("repair.after", { issue: failed, project });
          }
          return;
        }
        const now = this.dependencies.now();
        const reviewed = requestReview(
          claimed,
          businessMergeReview(claimed, result, this.dependencies.id(), now),
          now,
        );
        if (this.completeReview(
          claimed,
          reviewed,
          "REPAIR_BUSINESS_DECISION_REQUIRED",
        )) {
          this.emitLifecycle("repair.after", { issue: reviewed, project });
        }
        return;
      }
      if (validation.kind !== "DELIVERY_READY") {
        const failed = recordRepairFailure(
          claimed,
          "WORKSPACE_REPAIR_VALIDATION_MISMATCH",
          this.dependencies.now(),
        );
        if (this.complete(claimed, failed, "REPAIR_FAILED")) {
          this.emitLifecycle("repair.after", { issue: failed, project });
        }
        return;
      }
      const integrationSnapshot = observation.required && result.integration
        ? {
            baseBranch: integration!.baseBranch,
            baseCommit: result.integration.baseCommit,
            issueBranch: validation.branch.name,
            issueCommit: validation.branch.commit,
            conflicts: result.integration.conflicts,
            verification: result.verification,
          }
        : undefined;
      const drafted = recordImplementationDraft(
        claimed,
        result.summary,
        this.dependencies.now(),
        integrationSnapshot,
      );
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
        if (this.pauseForCapability(
          claimed,
          error,
          "CAPTURE_EVIDENCE",
          "EVIDENCE",
          attemptId,
        )) return;
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
        const reviewedAt = this.dependencies.now();
        const accepted = recordEvidenceAcceptance(claimed, reviewedAt);
        const reviewed = requestReview(
          accepted,
          deliveryReview(accepted, this.dependencies.id(), reviewedAt),
          reviewedAt,
        );
        this.completeReview(claimed, reviewed, "EVIDENCE_ACCEPTED");
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

  private async recoverFinalization(pending: Issue): Promise<void> {
    const current = this.dependencies.store.getIssue(pending.id);
    if (
      !current
      || current.revision !== pending.revision
      || current.status !== "FINALIZATION_RECOVERY"
    ) return;
    const attemptId = current.finalizationRecovery?.attemptId;
    const diagnostic = current.finalizationRecovery?.diagnostic;
    const fingerprintRef = current.finalizationRecovery?.fingerprintRef;
    const recoveryContext = current.finalizationRecovery?.context;
    const contextEvent = this.dependencies.store.readEvents(current.id).findLast((event) =>
      event.type === "DELIVERY_FINALIZATION_RECOVERY_STARTED"
      && event.data.attemptId === attemptId);
    const workspaceStatus = contextEvent?.data.workspaceStatus;
    const fingerprintSummary = contextEvent?.data.fingerprintSummary;
    const project = this.dependencies.store.getProject(current.projectId);
    if (
      !project
      || !current.agentSession
      || !attemptId
      || !diagnostic
      || !fingerprintRef
      || !recoveryContext
      || typeof workspaceStatus !== "string"
      || typeof fingerprintSummary !== "string"
    ) {
      await this.dependencies.workspaces.validateFinalizationRecovery(
        current,
        unsafeRecoveryResult("FINALIZATION_RECOVERY_CONTEXT_REQUIRED"),
      );
      return;
    }

    let agent: AgentAdapter;
    try {
      agent = this.dependencies.agents.forSession(current.agentSession);
      if (!agent.recoverFinalization) throw new Error("FINALIZATION_RECOVERY_AGENT_UNSUPPORTED");
    } catch (error) {
      await this.dependencies.workspaces.validateFinalizationRecovery(
        current,
        unsafeRecoveryResult(agentFailureCode(error)),
      );
      return;
    }
    const claimed = this.dependencies.store.transaction((tx) => {
      const latest = this.dependencies.store.getIssue(current.id);
      if (
        !latest
        || latest.revision !== current.revision
        || latest.status !== "FINALIZATION_RECOVERY"
      ) return undefined;
      tx.updateIssue(latest, latest.revision, null);
      return latest;
    });
    if (!claimed) return;

    try {
      const result = await agent.recoverFinalization!(claimed.agentSession!, {
        issue: claimed,
        project,
        diagnostic,
        workspaceStatus,
        fingerprintSummary,
        recoveryKind: recoveryContext.recoveryKind,
        ...(recoveryContext.merge ? { merge: recoveryContext.merge } : {}),
        continuation: this.continuation(claimed, "RECOVER_FINALIZATION"),
      });
      await this.dependencies.workspaces.validateFinalizationRecovery(
        claimed,
        publicRecoveryResult(result),
      );
    } catch (error) {
      if (this.pauseForCapability(
        claimed,
        error,
        "RECOVER_FINALIZATION",
        "FINALIZATION_RECOVERY",
        attemptId,
      )) return;
      if (this.requeueInterrupted(
        claimed,
        error,
        "RECOVER_FINALIZATION",
        attemptId,
      )) return;
      await this.dependencies.workspaces.validateFinalizationRecovery(
        claimed,
        unsafeRecoveryResult(agentFailureCode(error)),
      );
    }
  }

  private continuation(
    issue: Issue,
    operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE" | "RECOVER_FINALIZATION",
  ): AgentContinuation | undefined {
    const events = this.dependencies.store.readEvents(issue.id);
    const resumed = events.findLast((event) =>
      event.type === "ISSUE_RESUMED" &&
      event.data.operation === operation &&
      event.data.revision === issue.revision);
    if (resumed) return { reason: "USER_RESUMED" };
    const granted = events.findLast((event) =>
      event.type === "CAPABILITY_GRANTED" &&
      event.data.operation === operation &&
      event.data.revision === issue.revision);
    if (
      granted &&
      typeof granted.data.requestId === "string" &&
      Array.isArray(granted.data.capabilities)
    ) {
      const capabilities = granted.data.capabilities.filter(
        (capability): capability is "HOST_EXECUTION" | "NETWORK_ACCESS" =>
          capability === "HOST_EXECUTION" || capability === "NETWORK_ACCESS",
      );
      if (capabilities.length > 0) {
        return {
          reason: "CAPABILITY_GRANTED",
          requestId: granted.data.requestId,
          capabilities,
        };
      }
    }
    const reviewed = events.findLast((event) =>
      event.type === "REVIEW_SUBMITTED" &&
      event.data.operation === operation &&
      event.data.revision === issue.revision);
    if (
      reviewed &&
      typeof reviewed.data.requestId === "string" &&
      typeof reviewed.data.kind === "string" &&
      typeof reviewed.data.choiceId === "string"
    ) {
      const response = reviewed.data.response === undefined
        ? undefined
        : reviewJsonSchema.safeParse(reviewed.data.response);
      if (response === undefined || response.success) {
        return {
          reason: "REVIEW_SUBMITTED",
          requestId: reviewed.data.requestId,
          kind: reviewed.data.kind,
          choiceId: reviewed.data.choiceId,
          ...(typeof reviewed.data.feedback === "string"
            ? { feedback: reviewed.data.feedback }
            : {}),
          ...(response?.success ? { data: response.data } : {}),
        };
      }
    }
    const interrupted = events.findLast((event) =>
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

  private pauseForCapability(
    claimed: Issue,
    error: unknown,
    operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE" | "RECOVER_FINALIZATION",
    stage: "ASSESSMENT" | "REPAIR" | "EVIDENCE" | "FINALIZATION_RECOVERY",
    attemptId: string,
  ): boolean {
    if (!isAgentCapabilityRequiredError(error)) return false;
    const request = publicCapabilityRequest(error.request);
    const requestId = this.dependencies.id();
    return this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(claimed.id);
      if (!current || current.revision !== claimed.revision) return true;
      const paused = recordCapabilityRequest(current, {
        ...request,
        id: requestId,
        operation,
        stage,
        requestedAt: this.dependencies.now(),
      }, this.dependencies.now());
      tx.updateIssue(paused, current.revision, null);
      const pending = paused.pendingCapabilityRequest!;
      tx.appendEvent(this.event(paused.id, "CAPABILITY_REQUESTED", "AGENT", {
        requestId,
        operation,
        stage,
        capabilities: pending.capabilities,
        reason: pending.reason,
        ...(pending.blockedCommand
          ? { blockedCommand: pending.blockedCommand }
          : {}),
        ...(pending.requestedBy
          ? { requestedBy: pending.requestedBy }
          : {}),
        attemptId,
        revision: paused.revision,
      }));
      return true;
    });
  }

  private requeueInterrupted(
    claimed: Issue,
    error: unknown,
    operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE" | "RECOVER_FINALIZATION",
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
        stage: operation === "ASSESS"
          ? "ASSESSMENT"
          : operation === "REPAIR"
            ? "REPAIR"
            : operation === "CAPTURE_EVIDENCE"
              ? "EVIDENCE"
              : "FINALIZATION_RECOVERY",
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

  private completeReview(previous: Issue, next: Issue, type: string): boolean {
    const review = next.review;
    if (next.status !== "REVIEW_REQUIRED" || !review) {
      throw new Error("REVIEW_COMPLETION_REQUIRED");
    }
    return this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(previous.id);
      if (!current || current.revision !== previous.revision) return false;
      tx.updateIssue(next, previous.revision, null);
      tx.appendEvent(this.event(next.id, type, "AGENT"));
      tx.appendEvent(this.event(next.id, "REVIEW_REQUESTED", "SYSTEM", {
        requestId: review.id,
        kind: review.kind,
        choiceIds: review.choices.map((choice) => choice.id),
        revision: next.revision,
      }));
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

const REPAIR_OUTPUT_FAILURE_CODES = new Set([
  "EVIDENCE_LABEL_REQUIRED",
  "EVIDENCE_PATH_REQUIRED",
  "EVIDENCE_PATH_ESCAPE",
  "VISUAL_EVIDENCE_REQUIRED",
  "EVIDENCE_TYPE_REQUIRED",
  "EVIDENCE_TYPE_INVALID",
  "DELIVERY_SUMMARY_REQUIRED",
  "CODEX_OUTPUT_INVALID",
  "CODEX_OUTPUT_UNKNOWN_FIELD",
  "INVALID_CODEX_OUTPUT",
]);

function repairFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return agentFailureCode(error);
  if (
    REPAIR_OUTPUT_FAILURE_CODES.has(error.message) ||
    /^GIT_REPAIR_[A-Z_]+$/.test(error.message) ||
    /^WORKSPACE_REPAIR_[A-Z_]+$/.test(error.message)
  ) return error.message;
  return agentFailureCode(error);
}

function repairIntegrationInput(
  observation: WorkspaceRepairObservation,
): Parameters<AgentAdapter["repair"]>[1]["integration"] {
  if (!observation.required) return undefined;
  if (
    !observation.baseBranch ||
    !observation.baseCommit ||
    !observation.issueBranch
  ) throw new Error("WORKSPACE_REPAIR_OBSERVATION_INVALID");
  return {
    baseBranch: observation.baseBranch,
    observedBaseCommit: observation.baseCommit,
    issueBranch: observation.issueBranch,
  };
}

function publicEvidenceFailure(error: unknown): string {
  void error;
  return "Evidence could not be imported or verified. Produce new screenshot or recording evidence.";
}

function evidenceFailureCode(error: unknown, fallback: string): string {
  return error instanceof EvidenceCaptureError ? error.code : fallback;
}

const recoverySecretAssignment = /((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)\s*[=:]\s*)([^\s"']+)/gi;
const recoveryBearerToken = /(bearer\s+)([^\s"']+)/gi;

function publicRecoveryText(value: string, maxLength: number): string {
  return stripControlCharacters(value
    .trim()
    .replace(recoverySecretAssignment, "$1[REDACTED]")
    .replace(recoveryBearerToken, "$1[REDACTED]")
  )
    .slice(0, maxLength);
}

function stripControlCharacters(value: string): string {
  return [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
}

function publicRecoveryResult(result: FinalizationRecoveryResult): FinalizationRecoveryResult {
  return {
    summary: publicRecoveryText(result.summary, 4_000) || "Automatic finalization recovery finished",
    diagnosis: publicRecoveryText(result.diagnosis, 4_000) || "No diagnosis was provided",
    disposition: result.disposition,
    affectedPaths: result.affectedPaths.slice(0, 50).map((path) =>
      publicRecoveryText(path, 1_000)),
  };
}

function unsafeRecoveryResult(diagnosis: string): FinalizationRecoveryResult {
  return publicRecoveryResult({
    summary: "Automatic finalization recovery stopped safely",
    diagnosis,
    disposition: "UNSAFE",
    affectedPaths: [],
  });
}
