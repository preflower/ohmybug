import type { AgentCapability, Issue } from "@oh-my-bug/core";

export type CodexAgentStage =
  | "ASSESSMENT"
  | "REPAIR"
  | "EVIDENCE"
  | "FINALIZATION_RECOVERY";

export function effectiveStageCapabilities(
  issue: Issue,
  stage: CodexAgentStage,
): Set<AgentCapability> {
  const available = new Set(
    issue.capabilityGrants?.map((grant) => grant.capability),
  );
  if (stage === "REPAIR") available.add("NETWORK_ACCESS");
  if (stage === "EVIDENCE") {
    available.add("HOST_EXECUTION");
    available.add("NETWORK_ACCESS");
  }
  return available;
}
