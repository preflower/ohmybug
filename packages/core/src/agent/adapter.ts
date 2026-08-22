import type { Issue } from "../issue/types.js";
import type {
  AgentSessionRef,
  Assessment,
  Delivery,
  DeliveryDraft,
  RepairEvidencePath,
  RepairResult,
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

export interface AgentContinuation {
  reason: "RUNTIME_INTERRUPTED";
  previousAttemptId?: string;
}

export interface ProjectCommands {
  install?: string;
  test?: string;
  start?: string;
  acceptanceUrl?: string;
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
  cancel(
    session: AgentSessionRef,
    reason: AgentInterruptionReason,
  ): Promise<void>;
}
