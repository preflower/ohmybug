import type { z } from "zod";

import type {
  agentSessionRefSchema,
  assessmentSchema,
  deliverySchema,
  visualEvidenceSchema,
} from "./schemas.js";

export type Assessment = z.infer<typeof assessmentSchema>;
export type AssessmentVerdict = Assessment["verdict"];
export type AgentSessionRef = z.infer<typeof agentSessionRefSchema>;
export type VisualEvidence = z.infer<typeof visualEvidenceSchema>;
export type Delivery = z.infer<typeof deliverySchema>;

export type AgentCapability = "HOST_EXECUTION" | "NETWORK_ACCESS";

export interface AgentCapabilityRequester {
  type: "AGENT" | "SKILL";
  id?: string;
}

export interface AgentCapabilityRequest {
  capabilities: AgentCapability[];
  reason: string;
  blockedCommand?: string;
  requestedBy?: AgentCapabilityRequester;
}

export interface CapabilityGrant {
  capability: AgentCapability;
  requestId: string;
  grantedAt: string;
}

export interface DeliveryDraft {
  summary: string;
  repairIteration: number;
  implementationCompletedAt: string;
  integration?: DeliveryIntegrationSnapshot;
}

export interface DeliveryIntegrationSnapshot {
  baseBranch: string;
  baseCommit: string;
  issueBranch: string;
  issueCommit: string;
  conflicts: RepairConflictResolution[];
  verification: RepairVerification[];
}

export interface RepairEvidencePath {
  type: VisualEvidence["type"];
  label: string;
  relativePath: string;
}

export interface RepairIntegrationInput {
  baseBranch: string;
  observedBaseCommit: string;
  issueBranch: string;
}

export interface RepairVerification {
  command: string;
  outcome: "PASSED" | "FAILED" | "NOT_RUN";
  summary: string;
}

export interface RepairConflictResolution {
  path: string;
  classification: "TEXTUAL" | "COMPATIBLE_BUSINESS";
  resolution: string;
}

export type RepairResult =
  | {
      kind: "DELIVERY_READY";
      summary: string;
      evidence: RepairEvidencePath[];
      integration?: {
        baseCommit: string;
        issueCommit: string;
        conflicts: RepairConflictResolution[];
      };
      verification: RepairVerification[];
    }
  | {
      kind: "BUSINESS_DECISION_REQUIRED";
      summary: string;
      decision: {
        baseCommit: string;
        issueCommit: string;
        conflictPaths: string[];
        baseIntent: string;
        issueIntent: string;
        incompatibility: string;
        recommendation: string;
        rationale: string;
        choices: Array<{ id: string; label: string; description: string }>;
      };
    };

export interface FinalizationRecoveryResult {
  summary: string;
  diagnosis: string;
  disposition: "RECOVERED" | "REVALIDATION_REQUIRED" | "UNSAFE";
  affectedPaths: string[];
}
