import type {
  AgentCapabilityRequest,
  AgentSessionRef,
  Assessment,
  Delivery,
  DeliveryDraft,
  CapabilityGrant,
} from "../agent/types.js";
import type { IntegrationInput } from "../integration/input.js";

export type IssueStatus =
  | "RECEIVED"
  | "ASSESSING"
  | "ASSESSMENT_REVIEW"
  | "ASSESSMENT_FAILED"
  | "REPAIRING"
  | "EVIDENCE_CAPTURE"
  | "EVIDENCE_CHECK"
  | "EVIDENCE_FAILED"
  | "REPAIR_FAILED"
  | "PERMISSION_REQUIRED"
  | "ACCEPTANCE_REVIEW"
  | "FINALIZING"
  | "FINALIZATION_RECOVERY"
  | "FINALIZATION_FAILED"
  | "COMPLETED"
  | "CLOSED"
  | "CANCELED";

export type IssueResolution =
  | "FIXED"
  | "IMPLEMENTED"
  | "NOT_A_BUG"
  | "DUPLICATE"
  | "CANCELED";
export type IssueTitleSource = "integration" | "assessment" | "user";

export interface RepairState {
  iteration: number;
  evidenceRetries?: number;
  automaticEvidenceRetries?: number;
  feedback?: string;
  deliveryDraft?: DeliveryDraft;
  delivery?: Delivery;
}

export interface IssueFailure {
  stage: "ASSESSMENT" | "REPAIR" | "EVIDENCE" | "FINALIZATION_RECOVERY";
  code: string;
}

export type WorkspaceFinalizationStep =
  | "status"
  | "add"
  | "commit"
  | "push"
  | "merge"
  | "release"
  | "unknown";

export interface WorkspaceFinalizationDiagnostic {
  providerId: string;
  step: WorkspaceFinalizationStep;
  code: string;
  exitCode?: number;
  message: string;
  stderr?: string;
  relatedPaths: string[];
}

export interface FinalizationRecoveryState {
  automaticAttempts: 0 | 1;
  attemptId?: string;
  diagnostic?: WorkspaceFinalizationDiagnostic;
  fingerprintRef?: string;
  summary?: string;
}

export interface PendingCapabilityRequest extends AgentCapabilityRequest {
  id: string;
  operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE" | "RECOVER_FINALIZATION";
  stage: "ASSESSMENT" | "REPAIR" | "EVIDENCE" | "FINALIZATION_RECOVERY";
  resumeStatus:
    | "ASSESSING"
    | "REPAIRING"
    | "EVIDENCE_CAPTURE"
    | "FINALIZATION_RECOVERY";
  requestedAt: string;
}

export interface Issue {
  id: string;
  projectId: string;
  projectPath?: string;
  identifier: string;
  title: string;
  titleSource: IssueTitleSource;
  status: IssueStatus;
  resolution?: IssueResolution;
  duplicateOf?: string;
  inputs: IntegrationInput[];
  agentSession?: AgentSessionRef;
  assessment?: Assessment;
  assessmentFeedback?: string;
  repair?: RepairState;
  lastFailure?: IssueFailure;
  capabilityGrants?: CapabilityGrant[];
  pendingCapabilityRequest?: PendingCapabilityRequest;
  finalizationRecovery?: FinalizationRecoveryState;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
