import {
  acceptIntegrationInput as acceptCoreInput,
  grantCapabilityRequest,
  replaceAgentSession,
  retryEvidence,
  submitReview as submitCoreReview,
  transitionIssue,
  type IntegrationAdapter,
  type IntegrationInput,
  type IntakeResult,
  type Issue,
  type PendingOperation,
  type RuntimeProject,
  type RuntimeStore,
  type ReviewSubmission,
} from "@oh-my-bug/core";
import type { LifecycleEventMap } from "@oh-my-bug/module-api";

import type { AgentRegistry } from "../agents/registry.js";
import type {
  LifecycleHookFailure,
  RuntimeLifecycleHooks,
} from "../modules/lifecycle-hooks.js";
import {
  applyReviewSideEffects,
  reviewResponseDuplicate,
} from "./reviews.js";

export interface ManualSubmission {
  commandId: string;
  content: string;
  summary?: string;
  context?: Record<string, unknown>;
}

export interface AssessmentReference {
  assessmentRevision: number;
  assessmentContentHash: string;
}

export interface ApproveAssessmentInput extends AssessmentReference {
  title: string;
}

export interface RuntimeCommandDependencies {
  store: RuntimeStore;
  manual: IntegrationAdapter<ManualSubmission>;
  agents: AgentRegistry;
  hooks?: RuntimeLifecycleHooks;
  id: () => string;
  now: () => string;
  wake: () => void;
}

export class RuntimeCommands {
  private accepting = true;

  constructor(private readonly dependencies: RuntimeCommandDependencies) {}

  stopAccepting(): void { this.accepting = false; }

  registerProject(project: RuntimeProject): void {
    this.assertAccepting();
    this.dependencies.store.registerProject(project);
  }

  async submitManual(projectId: string, rawData: ManualSubmission): Promise<IntakeResult> {
    this.assertAccepting();
    return this.acceptIntegrationInput(projectId, await this.dependencies.manual.adapt(rawData));
  }

  acceptIntegrationInput(projectId: string, input: IntegrationInput): IntakeResult {
    this.assertAccepting();
    const project = this.dependencies.store.getProject(projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const beforeCreateFailures: LifecycleHookFailure[] = [];
    const result = this.dependencies.store.transaction((transaction) => acceptCoreInput({
      projectId,
      input,
      transaction,
      id: this.dependencies.id,
      now: this.dependencies.now(),
      beforeCreate: (issue) => {
        this.dependencies.hooks?.emit("issue.beforeCreate", { issue, project, input });
        beforeCreateFailures.push(...this.dependencies.hooks?.takeFailures() ?? []);
      },
    }));
    if (result.kind === "CREATED") {
      this.reportHookFailures(result.issue.id, beforeCreateFailures);
      this.emitLifecycle("issue.created", { issue: result.issue, project });
      this.dependencies.wake();
    }
    return result;
  }

  getIssue(issueId: string): Issue {
    const issue = this.dependencies.store.getIssue(issueId);
    if (!issue) throw new Error("ISSUE_NOT_FOUND");
    return issue;
  }

  listIssues(projectId?: string): Issue[] { return this.dependencies.store.listIssues(projectId); }

  readIssueEvents(issueId: string, afterSequence = 0) {
    this.getIssue(issueId);
    return this.dependencies.store.readEvents(issueId, afterSequence);
  }

  submitReview(issueId: string, submission: ReviewSubmission): Issue {
    this.assertAccepting();
    const before = this.getIssue(issueId);
    let duplicateOf: string | undefined;
    if (before.review?.kind === "assessment" && submission.choiceId === "duplicate") {
      duplicateOf = this.resolveDuplicateTarget(before, reviewResponseDuplicate(submission));
    }
    const now = this.dependencies.now();
    const selected = this.dependencies.store.transaction((transaction) => {
      const current = this.getIssue(issueId);
      const submitted = submitCoreReview(current, submission, now);
      const next = applyReviewSideEffects({
        previous: current,
        next: submitted.issue,
        submission,
        ...(duplicateOf ? { duplicateOf } : {}),
      });
      transaction.updateIssue(next, current.revision, submitted.operation);
      transaction.appendEvent(this.event(issueId, "REVIEW_SUBMITTED", {
        requestId: submitted.request.id,
        kind: submitted.request.kind,
        choiceId: submitted.choice.id,
        operation: submitted.operation,
        revision: next.revision,
        ...(submission.feedback ? { feedback: submission.feedback } : {}),
        ...(submission.data !== undefined ? { response: submission.data } : {}),
      }));
      return { issue: next, operation: submitted.operation, request: submitted.request };
    });
    if (selected.operation) this.dependencies.wake();
    if (selected.request.kind === "delivery" && selected.operation === "FINALIZE") {
      const project = this.dependencies.store.getProject(selected.issue.projectId);
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      this.emitLifecycle("issue.userApproved", { issue: selected.issue, project });
    }
    return selected.issue;
  }

  approveAssessment(issueId: string, approval: ApproveAssessmentInput): Issue {
    const issue = this.getIssue(issueId);
    this.assertAssessmentReference(issue, approval);
    return this.submitChoice(issue, "implement", { title: approval.title });
  }

  /** @deprecated Use approveAssessment. */
  approveBugAssessment(issueId: string, approval: ApproveAssessmentInput): Issue {
    return this.approveAssessment(issueId, approval);
  }

  confirmNotABug(issueId: string, reference: AssessmentReference): Issue {
    const issue = this.getIssue(issueId);
    this.assertAssessmentReference(issue, reference);
    return this.submitChoice(issue, "not-a-bug");
  }

  confirmDuplicate(issueId: string, reference: AssessmentReference, duplicateOf: string): Issue {
    const issue = this.getIssue(issueId);
    this.assertAssessmentReference(issue, reference);
    return this.submitChoice(issue, "duplicate", { duplicateOf });
  }

  requestReassessment(issueId: string, feedback: string): Issue {
    return this.submitChoice(this.getIssue(issueId), "reassess", undefined, feedback);
  }

  rejectDelivery(issueId: string, feedback: string): Issue {
    return this.submitChoice(this.getIssue(issueId), "request-changes", undefined, feedback);
  }

  approveDelivery(issueId: string): Issue {
    this.assertAccepting();
    const current = this.getIssue(issueId);
    if (current.status === "FINALIZATION_FAILED") {
      return this.change(
        issueId,
        "DELIVERY_FINALIZATION_RETRIED",
        "FINALIZE",
        (issue, now) => transitionIssue(issue, "RETRY_FINALIZATION", now),
      );
    }

    return this.submitChoice(current, "accept");
  }

  retryIssue(issueId: string): Issue {
    const issue = this.getIssue(issueId);
    if (issue.status === "ASSESSMENT_FAILED") {
      return this.change(issueId, "ASSESSMENT_RETRIED", "ASSESS", (current, now) =>
        transitionIssue(current, "RETRY_ASSESSMENT", now));
    }
    if (issue.status === "REPAIR_FAILED") {
      return this.change(issueId, "REPAIR_RETRIED", "REPAIR", (current, now) =>
        transitionIssue(current, "RETRY_REPAIR", now));
    }
    if (issue.status === "EVIDENCE_FAILED" && issue.repair?.deliveryDraft) {
      return this.change(
        issueId,
        "EVIDENCE_RETRIED",
        "CAPTURE_EVIDENCE",
        (current, now) => retryEvidence(current, now),
      );
    }
    throw new Error(`RETRY_NOT_AVAILABLE:${issue.status}`);
  }

  async rebuildAgentSession(issueId: string, expectedRevision: number): Promise<Issue> {
    this.assertAccepting();
    const failed = this.getIssue(issueId);
    if (failed.revision !== expectedRevision) throw new Error("CONCURRENT_UPDATE");
    if (!failed.agentSession) throw new Error("AGENT_SESSION_REBUILD_NOT_AVAILABLE");
    const expectedStage = failed.status === "ASSESSMENT_FAILED"
      ? "ASSESSMENT"
      : failed.status === "REPAIR_FAILED"
        ? "REPAIR"
        : undefined;
    if (
      !expectedStage ||
      failed.lastFailure?.stage !== expectedStage ||
      failed.lastFailure.code !== "AGENT_SESSION_UNAVAILABLE"
    ) throw new Error("AGENT_SESSION_REBUILD_NOT_AVAILABLE");
    const project = this.dependencies.store.getProject(failed.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const agent = this.dependencies.agents.forSession(failed.agentSession);
    const replacement = await agent.createSession({ issue: failed, project });
    const now = this.dependencies.now();
    const rebuilt = this.dependencies.store.transaction((tx) => {
      const current = this.dependencies.store.getIssue(issueId);
      if (!current || current.revision !== expectedRevision) throw new Error("CONCURRENT_UPDATE");
      const oldSession = current.agentSession;
      if (!oldSession) throw new Error("AGENT_SESSION_REBUILD_NOT_AVAILABLE");
      const next = replaceAgentSession(current, replacement, now);
      tx.retireAgentSession(oldSession.sessionId, now);
      tx.insertAgentSession({
        agent: replacement.agent,
        logicalSessionId: replacement.sessionId,
        issueId: current.id,
        projectId: current.projectId,
        lifecycle: "ACTIVE",
        updatedAt: now,
      });
      tx.updateIssue(next, current.revision, next.status === "ASSESSING" ? "ASSESS" : "REPAIR");
      const data = {
        oldLogicalSessionId: oldSession.sessionId,
        newLogicalSessionId: replacement.sessionId,
        context: "NEW_PROVIDER_CONTEXT",
      };
      tx.appendEvent(this.event(issueId, "AGENT_SESSION_REBUILD_REQUESTED", data));
      tx.appendEvent(this.event(issueId, "AGENT_SESSION_REBUILT", data));
      return next;
    });
    this.dependencies.wake();
    return rebuilt;
  }

  grantIssueCapabilities(
    issueId: string,
    expectedRevision: number,
    requestId: string,
  ): Issue {
    this.assertAccepting();
    const now = this.dependencies.now();
    const result = this.dependencies.store.transaction((tx) => {
      const current = this.getIssue(issueId);
      if (current.capabilityGrants?.some((grant) => grant.requestId === requestId)) {
        return { issue: current, changed: false } as const;
      }
      if (current.revision !== expectedRevision) throw new Error("CONCURRENT_UPDATE");
      const request = current.pendingCapabilityRequest;
      if (!request) throw new Error("CAPABILITY_REQUEST_NOT_AVAILABLE");
      const next = grantCapabilityRequest(current, requestId, now);
      tx.updateIssue(next, current.revision, request.operation);
      tx.appendEvent(this.event(issueId, "CAPABILITY_GRANTED", {
        requestId,
        operation: request.operation,
        stage: request.stage,
        capabilities: request.capabilities,
        revision: next.revision,
      }));
      return { issue: next, changed: true } as const;
    });
    if (result.changed) this.dependencies.wake();
    return result.issue;
  }

  async cancelIssue(issueId: string): Promise<Issue> {
    this.assertAccepting();
    const canceled = this.change(issueId, "ISSUE_CANCELED", null, (current, now) =>
      transitionIssue(current, "CANCEL", now));
    if (!canceled.agentSession) return canceled;

    try {
      await this.dependencies.agents.forSession(canceled.agentSession).cancel(
        canceled.agentSession,
        "USER_CANCELED",
      );
    } catch (error) {
      this.dependencies.store.transaction((tx) => tx.appendEvent({
        id: this.dependencies.id(),
        issueId,
        type: "AGENT_CANCEL_FAILED",
        actor: "SYSTEM",
        data: { message: publicModuleError(error) },
        occurredAt: this.dependencies.now(),
      }));
    }
    return canceled;
  }

  private change(
    issueId: string,
    eventType: string,
    pendingOperation: PendingOperation | null,
    reduce: (issue: Issue, now: string) => Issue,
    eventData = {},
  ): Issue {
    this.assertAccepting();
    const now = this.dependencies.now();
    const updated = this.dependencies.store.transaction((transaction) => {
      const current = this.dependencies.store.getIssue(issueId);
      if (!current) throw new Error("ISSUE_NOT_FOUND");
      const next = reduce(current, now);
      transaction.updateIssue(next, current.revision, pendingOperation);
      transaction.appendEvent(this.event(issueId, eventType, eventData));
      return next;
    });
    if (pendingOperation) this.dependencies.wake();
    return updated;
  }

  private submitChoice(
    issue: Issue,
    choiceId: string,
    data?: ReviewSubmission["data"],
    feedback?: string,
  ): Issue {
    if (issue.status !== "REVIEW_REQUIRED" || !issue.review) {
      throw new Error("REVIEW_NOT_AVAILABLE");
    }
    return this.submitReview(issue.id, {
      expectedRevision: issue.revision,
      requestId: issue.review.id,
      choiceId,
      ...(feedback ? { feedback: feedback.trim() } : {}),
      ...(data !== undefined ? { data } : {}),
    });
  }

  private assertAssessmentReference(
    issue: Issue,
    reference: AssessmentReference,
  ): void {
    if (
      !issue.assessment
      || issue.assessment.revision !== reference.assessmentRevision
      || issue.assessment.contentHash !== reference.assessmentContentHash
    ) throw new Error("Stale Assessment approval");
  }

  private resolveDuplicateTarget(source: Issue, rawReference: string): string {
    const targetReference = rawReference.trim();
    if (!targetReference) throw new Error("DUPLICATE_TARGET_NOT_FOUND");
    if (targetReference === source.id || targetReference === source.identifier) {
      throw new Error("DUPLICATE_TARGET_SELF");
    }
    const directTarget = this.dependencies.store.getIssue(targetReference);
    if (directTarget && directTarget.projectId !== source.projectId) {
      throw new Error("DUPLICATE_TARGET_NOT_FOUND");
    }
    const target = directTarget ?? this.dependencies.store.listIssues(source.projectId)
      .find((candidate) =>
        candidate.id === targetReference || candidate.identifier === targetReference);
    if (!target) throw new Error("DUPLICATE_TARGET_NOT_FOUND");
    if (target.id === source.id) throw new Error("DUPLICATE_TARGET_SELF");
    return target.identifier;
  }

  private event(issueId: string, type: string, data = {}) {
    return {
      id: this.dependencies.id(),
      issueId,
      type,
      actor: "USER" as const,
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
            message: publicModuleError(failure.error),
          },
          occurredAt: this.dependencies.now(),
        });
      }
    });
  }

  private assertAccepting(): void {
    if (!this.accepting) throw new Error("RUNTIME_STOPPED");
  }
}

function publicModuleError(error: unknown): string {
  return error instanceof Error ? error.message : "MODULE_HOOK_FAILED";
}
