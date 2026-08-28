import type { AgentCapability, Issue, ProjectContext } from "@oh-my-bug/core";

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
  return available;
}

export function effectiveProjectStageCapabilities(
  project: ProjectContext,
  issue: Issue,
  stage: CodexAgentStage,
): Set<AgentCapability> {
  const available = effectiveStageCapabilities(issue, stage);
  if (project.permissionMode === "full-access") {
    available.add("HOST_EXECUTION");
    available.add("NETWORK_ACCESS");
  }
  return available;
}

export function projectCapabilityPrompt(
  project: ProjectContext,
  issue: Issue,
  stage: CodexAgentStage,
): string[] {
  const permissionMode = project.permissionMode ?? "request-approval";
  const available = effectiveProjectStageCapabilities(project, issue, stage);
  const context = `Capabilities already available in this stage: ${JSON.stringify([...available])}`;
  if (permissionMode === "auto-review") {
    return [
      context,
      "Project permission mode is automatic review. Native sandbox approval requests are automatically reviewed.",
      "Do not return CAPABILITY_REQUIRED for human approval. Attempt the needed operation so the native reviewer can decide it; if denied, use a lower-privilege alternative and return the normal stage result.",
    ];
  }
  if (permissionMode === "full-access") {
    return [
      context,
      "Project permission mode is full access. HOST_EXECUTION and NETWORK_ACCESS are already available.",
      "Do not return CAPABILITY_REQUIRED for human approval; continue the task and return the normal stage result.",
    ];
  }
  return [
    context,
    "Use a practical lower-privilege alternative first.",
    "If a project Skill explicitly requires host or network access, or a sandbox, permission, or network denial leaves no practical lower-privilege alternative, stop retrying and return the CAPABILITY_REQUIRED structured outcome.",
    "Request HOST_EXECUTION for unrestricted host execution and NETWORK_ACCESS for network access. Do not request a capability that is already available.",
  ];
}
