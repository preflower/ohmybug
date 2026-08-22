import type { VisualEvidence } from "../agent/types.js";

export interface EvidenceIntake {
  directory: string;
  cleanup(): Promise<void>;
}

export interface EvidenceImport {
  issueId: string;
  repairIteration: number;
  workspaceDirectory: string;
  intakeDirectory: string;
  relativePath: string;
  type: VisualEvidence["type"];
  label: string;
}

export interface EvidenceStore {
  prepareIntake(
    issueId: string,
    repairIteration: number,
    workspaceDirectory: string,
  ): Promise<EvidenceIntake>;
  import(input: EvidenceImport): Promise<VisualEvidence>;
  read(issueId: string, evidenceId: string): Promise<{
    bytes: Uint8Array;
    mimeType: string;
    label: string;
  }>;
}
