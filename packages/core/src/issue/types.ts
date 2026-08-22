import type {
  AgentSessionRef,
  Assessment,
  Delivery,
} from "../agent/types.js";
import type { IntegrationInput } from "../integration/input.js";

export type IssueStatus =
  | "RECEIVED"
  | "ASSESSING"
  | "ASSESSMENT_REVIEW"
  | "ASSESSMENT_FAILED"
  | "REPAIRING"
  | "EVIDENCE_CHECK"
  | "REPAIR_FAILED"
  | "ACCEPTANCE_REVIEW"
  | "APPROVED"
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
  automaticEvidenceRetries?: number;
  feedback?: string;
  delivery?: Delivery;
}

export interface IssueFailure {
  stage: "ASSESSMENT" | "REPAIR";
  code: string;
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
  revision: number;
  createdAt: string;
  updatedAt: string;
}
