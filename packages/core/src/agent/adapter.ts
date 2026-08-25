import type {
  FinalizationRecoveryKind,
  FinalizationRecoveryMergeContext,
  Issue,
  WorkspaceFinalizationDiagnostic,
} from "../issue/types.js";
import type {
  AgentCapability,
  AgentCapabilityRequest,
  AgentSessionRef,
  Assessment,
  Delivery,
  DeliveryDraft,
  RepairEvidencePath,
  RepairResult,
  FinalizationRecoveryResult,
} from "./types.js";

export type AgentInterruptionReason = "RUNTIME_STOPPING" | "USER_CANCELED";

export class AgentTurnInterruptedError extends Error {
  readonly code = "AGENT_TURN_INTERRUPTED" as const;

  constructor(readonly reason: AgentInterruptionReason) {
    super(`AGENT_TURN_INTERRUPTED:${reason}`);
    this.name = "AgentTurnInterruptedError";
  }
}

export function isAgentTurnInterruptedError(
  value: unknown,
): value is AgentTurnInterruptedError {
  return value instanceof AgentTurnInterruptedError;
}

export type AgentContinuation =
  | {
      reason: "RUNTIME_INTERRUPTED";
      previousAttemptId?: string;
    }
  | {
      reason: "CAPABILITY_GRANTED";
      requestId: string;
      capabilities: AgentCapability[];
    };

export class AgentCapabilityRequiredError extends Error {
  readonly code = "AGENT_CAPABILITY_REQUIRED" as const;

  constructor(readonly request: AgentCapabilityRequest) {
    super("AGENT_CAPABILITY_REQUIRED");
    this.name = "AgentCapabilityRequiredError";
  }
}

export function isAgentCapabilityRequiredError(
  value: unknown,
): value is AgentCapabilityRequiredError {
  return value instanceof AgentCapabilityRequiredError;
}

export type ProjectEvidenceCapture =
  | { mode: "browser"; label: string; timeoutMs?: number }
  | { mode: "electron"; label: string; electronEntry: string; timeoutMs?: number }
  | { mode: "command"; label: string; command: string; timeoutMs?: number };

export interface ProjectCommands {
  install?: string;
  test?: string;
  start?: string;
  acceptanceUrl?: string;
  evidenceCapture?: ProjectEvidenceCapture;
}

export interface ProjectContext {
  id: string;
  path: string;
  instructions?: string;
  commands?: ProjectCommands;
}

export interface CreateSessionInput {
  issue: Issue;
  project: ProjectContext;
}

export interface AssessInput {
  issue: Issue;
  project: ProjectContext;
  feedback?: string;
  continuation?: AgentContinuation;
}

export interface RepairInput {
  issue: Issue;
  project: ProjectContext;
  assessment: Assessment;
  evidenceDirectory: string;
  previousDelivery?: Delivery;
  feedback?: string;
  continuation?: AgentContinuation;
}

export interface EvidenceCaptureInput {
  issue: Issue;
  project: ProjectContext;
  assessment: Assessment;
  deliveryDraft: DeliveryDraft;
  evidenceDirectory: string;
  feedback?: string;
  continuation?: AgentContinuation;
}

export interface EvidenceCaptureResult {
  evidence: RepairEvidencePath[];
}

export interface FinalizationRecoveryInput {
  issue: Issue;
  project: ProjectContext;
  diagnostic: WorkspaceFinalizationDiagnostic;
  workspaceStatus: string;
  fingerprintSummary: string;
  recoveryKind: FinalizationRecoveryKind;
  merge?: FinalizationRecoveryMergeContext;
  continuation?: AgentContinuation;
}

export interface AgentAdapter {
  createSession(input: CreateSessionInput): Promise<AgentSessionRef>;
  assess(
    session: AgentSessionRef,
    input: AssessInput,
  ): Promise<Assessment>;
  repair(session: AgentSessionRef, input: RepairInput): Promise<RepairResult>;
  captureEvidence(
    session: AgentSessionRef,
    input: EvidenceCaptureInput,
  ): Promise<EvidenceCaptureResult>;
  recoverFinalization?(
    session: AgentSessionRef,
    input: FinalizationRecoveryInput,
  ): Promise<FinalizationRecoveryResult>;
  cancel(
    session: AgentSessionRef,
    reason: AgentInterruptionReason,
  ): Promise<void>;
}
