import type { EvidenceInspection } from "../agent/evidence.js";

export interface EvidenceInspector {
  inspect(
    issueId: string,
    repairIteration: number,
    evidenceId: string,
  ): Promise<EvidenceInspection>;
}
