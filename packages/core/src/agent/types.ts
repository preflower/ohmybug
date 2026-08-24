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
}

export interface RepairEvidencePath {
  type: VisualEvidence["type"];
  label: string;
  relativePath: string;
}

export interface RepairResult {
  summary: string;
  evidence: RepairEvidencePath[];
}
