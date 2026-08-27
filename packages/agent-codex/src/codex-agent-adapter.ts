import { isAbsolute } from "node:path";

import {
  AgentCapabilityRequiredError,
  AgentTurnInterruptedError,
  assessmentSchema,
  canonicalHash,
  validateRepairResult,
  type AgentAdapter,
  type AgentInterruptionReason,
  type AgentActivityReporter,
  type AgentActivityUpdate,
  type AgentCapabilityRequest,
  type AgentPlugin,
  type AgentPluginContext,
  type AgentSessionRecord,
  type AgentSessionRef,
  type AgentSessionStore,
  type AssessInput,
  type Assessment,
  type CreateSessionInput,
  type EvidenceCaptureInput,
  type EvidenceCaptureResult,
  type FinalizationRecoveryInput,
  type FinalizationRecoveryResult,
  type Issue,
  type RepairInput,
  type RepairResult,
} from "@oh-my-bug/core";

import type {
  CodexClient,
  CodexClientEvent,
  CodexClientItem,
  CodexThread,
  CodexThreadOptions,
} from "./codex-client.js";
import { isNativeThreadUnavailableError } from "./codex-client.js";
import {
  assessmentOutputSchema,
  parseAssessmentOutput,
  parseCapabilityRequiredOutput,
  parseEvidenceOutput,
  parseRepairOutput,
  evidenceOutputSchema,
  repairOutputSchema,
} from "./output-schemas.js";
import {
  finalizationRecoveryOutputSchema,
  parseFinalizationRecoveryOutput,
} from "./finalization-recovery-output.js";
import { finalizationRecoveryPrompt } from "./finalization-recovery-prompt.js";
import { assessmentPrompt, evidencePrompt, repairPrompt } from "./prompts.js";
import {
  effectiveStageCapabilities,
  type CodexAgentStage,
} from "./stage-capabilities.js";

export interface CodexActivity {
  sessionId: string;
  stage: CodexAgentStage;
  event: CodexClientEvent;
}

export interface CodexAgentAdapterOptions {
  sessions: AgentSessionStore;
  client: CodexClient;
  id?: () => string;
  now?: () => Date;
  onActivity?: (activity: CodexActivity) => void;
  reportActivity?: AgentActivityReporter;
}

interface ActiveTurn {
  abort: AbortController;
  done: Promise<void>;
  finish(): void;
}

interface CommandStreamState {
  buffer: string;
  discardingUntilNewline: boolean;
}

type CodexStageThreadOptions = Omit<CodexThreadOptions, "sessionId">;

export class CodexAgentAdapter implements AgentAdapter {
  private readonly client: CodexClient;
  private readonly now: () => Date;
  private readonly active = new Map<string, ActiveTurn>();
  private readonly commandStreams = new Map<string, CommandStreamState>();

  constructor(private readonly options: CodexAgentAdapterOptions) {
    this.client = options.client;
    this.now = options.now ?? (() => new Date());
  }

  async createSession(input: CreateSessionInput): Promise<AgentSessionRef> {
    if (input.issue.projectId !== input.project.id) throw new Error("SESSION_PROJECT_MISMATCH");
    return {
      agent: "codex",
      sessionId: this.options.id?.() ?? `codex-${input.issue.id}`,
    };
  }

  async assess(session: AgentSessionRef, input: AssessInput): Promise<Assessment> {
    const output = await this.stageTurn(
      session,
      input,
      "ASSESSMENT",
      {
        workingDirectory: requireProjectPath(input.issue),
        ...effectiveTurnOptions(input.issue, "ASSESSMENT", {
          sandboxMode: "read-only",
          networkAccessEnabled: false,
        }),
        approvalPolicy: "never",
      },
      assessmentPrompt(input),
      assessmentOutputSchema,
    );
    let content: ReturnType<typeof parseAssessmentOutput>;
    try {
      content = parseAssessmentOutput(output);
    } catch (error) {
      await this.reportFailure(session.sessionId, "ASSESSMENT", error);
      throw error;
    }
    return assessmentSchema.parse({
      revision: Math.max(1, input.issue.revision),
      contentHash: canonicalHash(content),
      ...content,
    });
  }

  async repair(session: AgentSessionRef, input: RepairInput): Promise<RepairResult> {
    if (input.assessment.verdict !== "BUG" && input.assessment.verdict !== "FEATURE") {
      throw new Error("IMPLEMENTABLE_ASSESSMENT_REQUIRED");
    }
    const rawOutput = await this.stageTurn(
      session,
      input,
      "REPAIR",
      {
        workingDirectory: requireProjectPath(input.issue),
        ...effectiveTurnOptions(input.issue, "REPAIR", {
          sandboxMode: "workspace-write",
          networkAccessEnabled: true,
        }),
        approvalPolicy: "never",
      },
      repairPrompt(input),
      repairOutputSchema,
    );
    let output: ReturnType<typeof parseRepairOutput>;
    try {
      output = parseRepairOutput(rawOutput);
    } catch (error) {
      await this.reportFailure(session.sessionId, "REPAIR", error);
      throw error;
    }
    if (output.kind === "BUSINESS_DECISION_REQUIRED") {
      return validateRepairResult(input, output);
    }
    return validateRepairResult(input, {
      ...output,
      evidence: output.evidence.map((evidence) => ({
        type: evidence.type,
        label: evidence.label,
        relativePath: validateEvidencePath(evidence.relativePath),
      })),
    });
  }

  async captureEvidence(
    session: AgentSessionRef,
    input: EvidenceCaptureInput,
  ): Promise<EvidenceCaptureResult> {
    if (input.assessment.verdict !== "BUG" && input.assessment.verdict !== "FEATURE") {
      throw new Error("IMPLEMENTABLE_ASSESSMENT_REQUIRED");
    }
    const rawOutput = await this.stageTurn(
      session,
      input,
      "EVIDENCE",
      {
        workingDirectory: requireProjectPath(input.issue),
        sandboxMode: "danger-full-access",
        networkAccessEnabled: true,
        approvalPolicy: "never",
      },
      evidencePrompt(input),
      evidenceOutputSchema,
    );
    let output: ReturnType<typeof parseEvidenceOutput>;
    try {
      output = parseEvidenceOutput(rawOutput);
    } catch (error) {
      await this.reportFailure(session.sessionId, "EVIDENCE", error);
      throw error;
    }
    return {
      evidence: output.evidence.map((evidence) => ({
        type: evidence.type,
        label: evidence.label,
        relativePath: validateEvidencePath(evidence.relativePath),
      })),
    };
  }

  async recoverFinalization(
    session: AgentSessionRef,
    input: FinalizationRecoveryInput,
  ): Promise<FinalizationRecoveryResult> {
    const rawOutput = await this.stageTurn(
      session,
      input,
      "FINALIZATION_RECOVERY",
      {
        workingDirectory: requireProjectPath(input.issue),
        ...effectiveTurnOptions(input.issue, "FINALIZATION_RECOVERY", {
          sandboxMode: "workspace-write",
          networkAccessEnabled: false,
        }),
        approvalPolicy: "never",
      },
      finalizationRecoveryPrompt(input),
      finalizationRecoveryOutputSchema,
    );
    try {
      return parseFinalizationRecoveryOutput(rawOutput);
    } catch (error) {
      await this.reportFailure(session.sessionId, "FINALIZATION_RECOVERY", error);
      throw error;
    }
  }

  async cancel(
    session: AgentSessionRef,
    reason: AgentInterruptionReason,
  ): Promise<void> {
    this.assertRef(session);
    const active = this.active.get(session.sessionId);
    if (!active) return;
    active.abort.abort(new AgentTurnInterruptedError(reason));
    await active.done;
  }

  private async stageTurn(
    session: AgentSessionRef,
    input: AssessInput | RepairInput | EvidenceCaptureInput | FinalizationRecoveryInput,
    stage: CodexActivity["stage"],
    threadOptions: CodexStageThreadOptions,
    prompt: string,
    outputSchema: unknown,
  ): Promise<unknown> {
    const run = (nextPrompt: string) => this.turn(
      session,
      input,
      stage,
      threadOptions,
      nextPrompt,
      outputSchema,
    );
    let correctionUsed = false;
    let output: unknown;
    try {
      output = await run(prompt);
    } catch (error) {
      if (!looksPermissionBlocked(error)) throw error;
      correctionUsed = true;
      output = await run([
        prompt,
        "The previous attempt was permission-blocked. Make exactly one choice: use a lower-privilege alternative, or return CAPABILITY_REQUIRED. Do not retry the blocked command.",
      ].join("\n\n"));
    }

    const checked = checkCapabilityRequest(output, input.issue, stage);
    if (checked.kind === "NEW") {
      throw new AgentCapabilityRequiredError(checked.request);
    }
    if (checked.kind === "NONE") return output;
    if (correctionUsed) throw new Error("AGENT_CAPABILITY_REQUEST_INVALID");

    const corrected = await run([
      prompt,
      "Every capability in the previous request is already available in this stage. Continue the task and return the normal stage result. Do not request it again.",
    ].join("\n\n"));
    const rechecked = checkCapabilityRequest(corrected, input.issue, stage);
    if (rechecked.kind === "NEW") {
      throw new AgentCapabilityRequiredError(rechecked.request);
    }
    if (rechecked.kind === "REDUNDANT") {
      throw new Error("AGENT_CAPABILITY_REQUEST_INVALID");
    }
    return corrected;
  }

  private async turn(
    session: AgentSessionRef,
    input: AssessInput | RepairInput | EvidenceCaptureInput | FinalizationRecoveryInput,
    stage: CodexActivity["stage"],
    threadOptions: CodexStageThreadOptions,
    prompt: string,
    outputSchema: unknown,
  ): Promise<unknown> {
    this.assertRef(session);
    if (this.active.has(session.sessionId)) throw new Error("AGENT_SESSION_BUSY");
    let finish!: () => void;
    const done = new Promise<void>((resolveDone) => { finish = resolveDone; });
    const abort = new AbortController();
    const active: ActiveTurn = { abort, done, finish };
    this.active.set(session.sessionId, active);
    let thread: CodexThread | undefined;
    let ownedTurn: { threadId: string; turnId: string } | undefined;
    let failureReported = false;
    try {
      const state = await this.options.sessions.get(session.sessionId);
      assertActive(abort.signal);
      this.assertState(state, session, input);
      thread = state.providerSessionId
        ? this.client.resumeThread(state.providerSessionId, {
            ...threadOptions,
            sessionId: session.sessionId,
          })
        : this.client.startThread({ ...threadOptions, sessionId: session.sessionId });
      const events = await thread.runStreamed(prompt, { outputSchema, signal: abort.signal });
      let lastMessage: string | undefined;
      for await (const event of events) {
        assertActive(abort.signal);
        if (event.type === "turn.started") {
          if (state.providerSessionId && event.threadId !== state.providerSessionId) {
            throw new Error("AGENT_SESSION_MISMATCH");
          }
          ownedTurn = { threadId: event.threadId, turnId: event.turnId };
        } else if ("turnId" in event && (
          !ownedTurn || event.threadId !== ownedTurn.threadId || event.turnId !== ownedTurn.turnId
        )) {
          continue;
        }
        this.options.onActivity?.({ sessionId: session.sessionId, stage, event });
        await this.reportActivity(session.sessionId, stage, event);
        if (event.type === "turn.failed" || event.type === "error") failureReported = true;
        if (event.type === "thread.started") await this.acceptThreadStarted(state, event.threadId);
        if (event.type === "item.completed" && event.item.type === "agent_message") {
          lastMessage = event.item.text;
        }
        if (event.type === "turn.failed" || event.type === "error") throw new Error(event.message);
      }
      assertActive(abort.signal);
      if (!state.providerSessionId) throw new Error("AGENT_SESSION_MISMATCH");
      if (!ownedTurn) throw new Error("AGENT_SESSION_MISMATCH");
      if (!lastMessage) throw new Error("CODEX_OUTPUT_MISSING");
      try {
        return JSON.parse(lastMessage) as unknown;
      } catch (error) {
        throw new Error("INVALID_CODEX_OUTPUT", { cause: error });
      }
    } catch (error) {
      if (abort.signal.aborted) throw canceledError(abort.signal.reason);
      if (!failureReported) await this.reportFailure(session.sessionId, stage, error);
      if (isNativeThreadUnavailableError(error)) {
        throw new Error("AGENT_SESSION_UNAVAILABLE", { cause: error });
      }
      throw error;
    } finally {
      if (ownedTurn) {
        clearCommandStreams(this.commandStreams, ownedTurn.threadId, ownedTurn.turnId);
      }
      try {
        await thread?.dispose();
      } catch (error) {
        await this.reportActivity(session.sessionId, stage, {
          type: "cleanup.failed",
          message: error instanceof Error ? error.message : "AGENT_TEMP_CLEANUP_FAILED",
        });
      } finally {
        if (this.active.get(session.sessionId) === active) this.active.delete(session.sessionId);
        finish();
      }
    }
  }

  private assertState(
    state: AgentSessionRecord | undefined,
    session: AgentSessionRef,
    input: AssessInput | RepairInput | EvidenceCaptureInput | FinalizationRecoveryInput,
  ): asserts state is AgentSessionRecord {
    if (!state) throw new Error("AGENT_SESSION_NOT_FOUND");
    if (state.lifecycle !== "ACTIVE") throw new Error("AGENT_SESSION_RETIRED");
    if (state.agent !== "codex" || session.agent !== state.agent) {
      throw new Error("AGENT_SESSION_MISMATCH");
    }
    if (state.issueId !== input.issue.id || state.projectId !== input.project.id) {
      throw new Error("AGENT_SESSION_CONTEXT_MISMATCH");
    }
  }

  private async acceptThreadStarted(state: AgentSessionRecord, threadId: string): Promise<void> {
    if (state.providerSessionId) {
      if (threadId !== state.providerSessionId) throw new Error("AGENT_SESSION_MISMATCH");
      return;
    }
    if (!threadId.trim()) throw new Error("AGENT_SESSION_MISMATCH");
    const updated = {
      ...state,
      providerSessionId: threadId,
      updatedAt: this.now().toISOString(),
    };
    await this.options.sessions.save(updated);
    state.providerSessionId = updated.providerSessionId;
    state.updatedAt = updated.updatedAt;
  }

  private assertRef(session: AgentSessionRef): void {
    if (session.agent !== "codex" || !session.sessionId.trim()) throw new Error("INVALID_CODEX_SESSION");
  }

  private async reportActivity(
    sessionId: string,
    stage: CodexActivity["stage"],
    event: CodexClientEvent,
  ): Promise<void> {
    if (!this.options.reportActivity) return;
    for (const update of publicActivities(sessionId, stage, event, this.commandStreams)) {
      try {
        await this.options.reportActivity(update);
      } catch {
        // Activity reporting is observational and must never fail the Agent turn.
      }
    }
  }

  private async reportFailure(
    sessionId: string,
    stage: CodexActivity["stage"],
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : "AGENT_FAILURE";
    await this.reportActivity(sessionId, stage, { type: "error", message });
  }
}

type CapabilityRequestCheck =
  | { kind: "NONE" }
  | { kind: "NEW"; request: AgentCapabilityRequest }
  | { kind: "REDUNDANT" };

function checkCapabilityRequest(
  output: unknown,
  issue: Issue,
  stage: CodexActivity["stage"],
): CapabilityRequestCheck {
  const request = parseCapabilityRequiredOutput(output);
  if (!request) return { kind: "NONE" };
  const available = effectiveStageCapabilities(issue, stage);
  const capabilities = request.capabilities.filter(
    (capability) => !available.has(capability),
  );
  return capabilities.length === 0
    ? { kind: "REDUNDANT" }
    : { kind: "NEW", request: { ...request, capabilities } };
}

function effectiveTurnOptions(
  issue: Issue,
  stage: CodexAgentStage,
  defaults: Pick<CodexThreadOptions, "sandboxMode" | "networkAccessEnabled">,
): Pick<CodexThreadOptions, "sandboxMode" | "networkAccessEnabled"> {
  const available = effectiveStageCapabilities(issue, stage);
  return {
    sandboxMode: available.has("HOST_EXECUTION")
      ? "danger-full-access"
      : defaults.sandboxMode,
    networkAccessEnabled: available.has("NETWORK_ACCESS")
      ? true
      : defaults.networkAccessEnabled,
  };
}

function looksPermissionBlocked(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /\b(?:EPERM|EACCES)\b|operation not permitted|permission denied|sandbox|network.*(?:disabled|denied|unavailable)/i
    .test(error.message);
}

export function codexAgent(
  options: Omit<CodexAgentAdapterOptions, "sessions">,
): AgentPlugin {
  return {
    id: "codex",
    create(context: AgentPluginContext) {
      return new CodexAgentAdapter({ ...options, ...context });
    },
  };
}

function requireProjectPath(issue: Issue): string {
  if (!issue.projectPath) throw new Error("ISSUE_PROJECT_PATH_REQUIRED");
  return issue.projectPath;
}

function validateEvidencePath(value: string): string {
  if (!value.trim()) throw new Error("EVIDENCE_PATH_REQUIRED");
  if (
    isAbsolute(value) ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith("\\\\") ||
    value.split(/[\\/]/).includes("..") ||
    value === "." ||
    value.includes("\0")
  ) {
    throw new Error("EVIDENCE_PATH_ESCAPE");
  }
  return value;
}

function canceledError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new Error("RUN_CANCELED");
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw canceledError(signal.reason);
}

function publicActivities(
  sessionId: string,
  stage: CodexActivity["stage"],
  event: CodexClientEvent,
  commandStreams: Map<string, CommandStreamState>,
): AgentActivityUpdate[] {
  const stageName = stage === "ASSESSMENT"
    ? "分析"
    : stage === "REPAIR"
      ? "实现"
      : stage === "EVIDENCE"
        ? "采集证据"
        : "交付恢复";
  if (event.type === "thread.started") {
    return [activity(sessionId, stage, "AGENT_SESSION_CONNECTED", "Codex 会话已连接")];
  }
  if (event.type === "turn.started") {
    return [
      activity(sessionId, stage, "AGENT_TURN_STARTED", `Codex 开始${stageName}`),
      activity(sessionId, stage, "AGENT_STATUS", "Started"),
      activity(sessionId, stage, "AGENT_STATUS", "Working"),
    ];
  }
  if (event.type === "turn.completed") {
    clearCommandStreams(commandStreams, event.threadId, event.turnId);
    return [activity(sessionId, stage, "AGENT_TURN_COMPLETED", `Codex 已完成${stageName}`)];
  }
  if (event.type === "turn.failed" || event.type === "error") {
    if (event.threadId && event.turnId) {
      clearCommandStreams(commandStreams, event.threadId, event.turnId);
    }
    return [activity(
      sessionId,
      stage,
      "AGENT_ERROR",
      publicErrorSummary(event.message),
      sanitizeDiagnostic(event.message),
      "error",
    )];
  }
  if (event.type === "cleanup.failed") {
    return [activity(
      sessionId,
      stage,
      "AGENT_TEMP_CLEANUP_FAILED",
      "Agent 临时目录清理失败",
      sanitizeDiagnostic(event.message),
      "error",
    )];
  }
  const item = event.item;
  if (item.type === "command_output") {
    return consumeCommandOutput(
      commandStreams,
      commandStreamKey(event.threadId, event.turnId, item.id),
      item.delta,
    ).map((detail) => withCorrelationId(activity(
          sessionId,
          stage,
          "AGENT_COMMAND_OUTPUT",
          "命令输出",
          detail,
        ), item.id));
  }
  if (item.type === "plan") {
    const detail = sanitizeDiagnostic(formatPlan(item));
    return [activity(sessionId, stage, "AGENT_STATUS", "Working", detail)];
  }
  if (item.type === "agent_message") {
    if (
      event.type !== "item.completed"
      || item.phase !== "commentary"
      || isStructuredResultPayload(item.text)
    ) return [];
    const message = sanitizeDiagnostic(item.text);
    return message ? [activity(sessionId, stage, "AGENT_MESSAGE", message)] : [];
  }
  if (item.type === "reasoning") {
    if (event.type !== "item.completed") return [];
    const message = sanitizeDiagnostic(item.summary);
    return message ? [activity(sessionId, stage, "AGENT_MESSAGE", message)] : [];
  }
  if (item.type === "command_execution") {
    const exploration = explorationDetail(item.actions ?? []);
    if (event.type === "item.started") {
      const updates = [];
      if (exploration) {
        updates.push(withCorrelationId(activity(
          sessionId,
          stage,
          "AGENT_STATUS",
          "Exploring",
          sanitizeDiagnostic(exploration),
        ), item.id));
      }
      updates.push(withCorrelationId(activity(
        sessionId,
        stage,
        "AGENT_COMMAND_STARTED",
        "正在执行项目命令",
        sanitizeDiagnostic(`$ ${item.command}`),
      ), item.id));
      return updates;
    }
    const failed = item.status === "failed";
    const updates = item.id
      ? flushCommandOutput(
          commandStreams,
          commandStreamKey(event.threadId, event.turnId, item.id),
        ).map((detail) => withCorrelationId(activity(
          sessionId,
          stage,
          "AGENT_COMMAND_OUTPUT",
          "命令输出",
          detail,
        ), item.id))
      : [];
    if (exploration) {
      updates.push(withCorrelationId(activity(
        sessionId,
        stage,
        "AGENT_STATUS",
        "Explored",
        sanitizeDiagnostic(exploration),
      ), item.id));
    }
    updates.push(withCorrelationId(activity(
      sessionId,
      stage,
      failed ? "AGENT_COMMAND_FAILED" : "AGENT_COMMAND_COMPLETED",
      failed ? "项目命令执行失败" : "项目命令执行完成",
      sanitizeDiagnostic([`$ ${item.command}`, item.output].filter(Boolean).join("\n")),
      failed ? "error" : "info",
    ), item.id));
    return updates;
  }
  if (item.type === "collaboration") {
    if (item.tool === "wait") {
      const waiting = event.type === "item.started" || item.status === "in_progress";
      const failed = item.status === "failed";
      return [withCorrelationId(activity(
        sessionId,
        stage,
        "AGENT_STATUS",
        waiting ? "Waiting" : failed ? "Waiting failed" : "Working",
        waiting ? "等待子 Agent" : failed ? "等待子 Agent 失败" : "子 Agent 已返回",
        failed ? "error" : "info",
      ), item.id)];
    }
    return [withCorrelationId(activity(
      sessionId,
      stage,
      "AGENT_STATUS",
      "Working",
      collaborationDetail(item.tool),
      item.status === "failed" ? "error" : "info",
    ), item.id)];
  }
  if (event.type === "item.completed" && item.type === "file_change") {
    const count = item.paths.length;
    return [activity(
      sessionId,
      stage,
      item.status === "failed" ? "AGENT_FILES_CHANGE_FAILED" : "AGENT_FILES_CHANGED",
      item.status === "failed" ? "文件更新失败" : `已更新 ${count} 个文件`,
      sanitizeDiagnostic(item.paths.join("\n")),
      item.status === "failed" ? "error" : "info",
    )];
  }
  if (item.type === "error") {
    return [activity(
      sessionId,
      stage,
      "AGENT_ERROR",
      publicErrorSummary(item.message),
      sanitizeDiagnostic(item.message),
      "error",
    )];
  }
  return [];
}

function explorationDetail(actions: Extract<CodexClientItem, { type: "command_execution" }>["actions"]): string | undefined {
  const lines = actions.flatMap((action) => {
    if (action.type === "read") return [`Read ${action.name || action.path}`];
    if (action.type === "list_files") return [`List${action.path ? ` ${action.path}` : " files"}`];
    if (action.type === "search") {
      const query = action.query ? ` ${action.query}` : "";
      const path = action.path ? ` in ${action.path}` : "";
      return [`Search${query}${path}`];
    }
    return [];
  });
  return lines.length ? lines.join("\n") : undefined;
}

function formatPlan(item: Extract<CodexClientItem, { type: "plan" }>): string {
  const steps = item.steps.map(({ status, step }) => (
    `${status === "completed" ? "✓" : status === "in_progress" ? "›" : "□"} ${step}`
  ));
  return [item.explanation, ...steps].filter(Boolean).join("\n");
}

function collaborationDetail(tool: string): string {
  if (tool === "spawnAgent") return "正在启动子 Agent";
  if (tool === "sendInput") return "正在向子 Agent 发送消息";
  if (tool === "resumeAgent") return "正在恢复子 Agent";
  if (tool === "closeAgent") return "正在关闭子 Agent";
  return `子 Agent 操作：${tool}`;
}

function isStructuredResultPayload(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const payload = parsed as Record<string, unknown>;
    return (
      typeof payload.outcome === "string"
      && ("result" in payload || "capabilityRequest" in payload)
    ) || typeof payload.verdict === "string"
      || payload.kind === "DELIVERY_READY"
      || payload.kind === "BUSINESS_DECISION_REQUIRED";
  } catch {
    return false;
  }
}

function activity(
  sessionId: string,
  stage: CodexActivity["stage"],
  type: string,
  message: string,
  detail?: string,
  level: AgentActivityUpdate["level"] = "info",
): AgentActivityUpdate {
  return {
    sessionId,
    stage,
    type,
    message,
    ...(detail ? { detail } : {}),
    level,
  };
}

function withCorrelationId(update: AgentActivityUpdate, correlationId?: string): AgentActivityUpdate {
  return correlationId ? { ...update, correlationId } : update;
}

function publicErrorSummary(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("connection failed") ||
    normalized.includes("error sending request") ||
    normalized.includes("stream disconnected") ||
    normalized.includes("err_connection") ||
    normalized.includes("network")
  ) return "Codex 网络连接中断";
  if (normalized.includes("rate limit") || normalized.includes("429")) {
    return "Codex 请求受到限流";
  }
  if (normalized.includes("unauthorized") || normalized.includes("authentication") || normalized.includes("401")) {
    return "Codex 登录状态无效";
  }
  if (normalized.includes("codex_output_missing")) return "Codex 未返回结果";
  if (normalized.includes("invalid_codex_output")) return "Codex 返回格式无效";
  if (normalized.includes("native_thread_unavailable") || normalized.includes("agent_session_unavailable")) {
    return "Codex 会话不可用";
  }
  if (normalized.includes("thread_start_failed")) return "Codex 启动失败";
  return "Codex 运行失败";
}

const secretAssignment = /((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)\s*[=:]\s*)([^\s"']+)/gi;
const bearerToken = /(bearer\s+)([^\s"']+)/gi;
const secretQuery = /([?&](?:api[_-]?key|access[_-]?token|token|password|secret)=)([^&\s]+)/gi;
const quotedSecretAssignment = /((?:["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)["']?)\s*[=:]\s*)(["'])(.*?)\2/gi;
const MAX_UNTERMINATED_STREAM_OUTPUT = 64_000;

function sanitizeDiagnostic(value: string): string | undefined {
  const sanitized = redactSecrets(value)
    .trim();
  if (!sanitized) return undefined;
  return sanitized.length > 2_000 ? `${sanitized.slice(0, 1_997)}...` : sanitized;
}

function sanitizeStreamChunks(value: string): string[] {
  const sanitized = redactSecrets(value);
  if (!sanitized) return [];
  const chunks: string[] = [];
  for (let offset = 0; offset < sanitized.length; offset += 2_000) {
    chunks.push(sanitized.slice(offset, offset + 2_000));
  }
  return chunks;
}

function redactSecrets(value: string): string {
  return value
    .replace(quotedSecretAssignment, "$1$2[REDACTED]$2")
    .replace(secretAssignment, "$1[REDACTED]")
    .replace(bearerToken, "$1[REDACTED]")
    .replace(secretQuery, "$1[REDACTED]");
}

function commandStreamKey(threadId: string, turnId: string, itemId: string): string {
  return `${threadId}\0${turnId}\0${itemId}`;
}

function commandTurnPrefix(threadId: string, turnId: string): string {
  return `${threadId}\0${turnId}\0`;
}

function consumeCommandOutput(
  streams: Map<string, CommandStreamState>,
  key: string,
  delta: string,
): string[] {
  const state = streams.get(key) ?? { buffer: "", discardingUntilNewline: false };
  streams.set(key, state);
  const output: string[] = [];
  let remaining = delta;

  if (state.discardingUntilNewline) {
    const newline = remaining.indexOf("\n");
    if (newline === -1) return output;
    output.push("\n");
    state.discardingUntilNewline = false;
    remaining = remaining.slice(newline + 1);
  }

  state.buffer += remaining;
  let newline = state.buffer.indexOf("\n");
  while (newline !== -1) {
    output.push(...sanitizeStreamChunks(state.buffer.slice(0, newline + 1)));
    state.buffer = state.buffer.slice(newline + 1);
    newline = state.buffer.indexOf("\n");
  }

  if (state.buffer.length > MAX_UNTERMINATED_STREAM_OUTPUT) {
    state.buffer = "";
    state.discardingUntilNewline = true;
    output.push("[OUTPUT REDACTED]");
  }
  return output;
}

function flushCommandOutput(
  streams: Map<string, CommandStreamState>,
  key: string,
): string[] {
  const state = streams.get(key);
  streams.delete(key);
  if (!state) return [];
  if (state.discardingUntilNewline) return ["\n"];
  return sanitizeStreamChunks(state.buffer);
}

function clearCommandStreams(
  streams: Map<string, CommandStreamState>,
  threadId: string,
  turnId: string,
): void {
  const prefix = commandTurnPrefix(threadId, turnId);
  for (const key of streams.keys()) {
    if (key.startsWith(prefix)) streams.delete(key);
  }
}
