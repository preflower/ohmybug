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

export interface RepairEvidencePath {
  type: VisualEvidence["type"];
  label: string;
  relativePath: string;
}

export interface RepairResult {
  summary: string;
  evidence: RepairEvidencePath[];
}
