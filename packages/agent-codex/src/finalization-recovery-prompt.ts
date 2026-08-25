import type { FinalizationRecoveryInput } from "@oh-my-bug/core";

import { effectiveStageCapabilities } from "./stage-capabilities.js";

export function finalizationRecoveryPrompt(input: FinalizationRecoveryInput): string {
  const available = [...effectiveStageCapabilities(input.issue, "FINALIZATION_RECOVERY")];
  return [
    "Diagnose and surgically repair the retained Issue workspace after delivery finalization failed. This is the single automatic recovery attempt.",
    ...continuationPrompt(input),
    `Capabilities already available in this stage: ${JSON.stringify(available)}`,
    "Use a practical lower-privilege alternative first. If the permission boundary is insufficient, stop and return CAPABILITY_REQUIRED instead of retrying a blocked command.",
    "Do not commit, merge, push, release, rewrite branches, or rewrite history. Do not run delivery finalization commands; the Workspace Provider owns Git publication.",
    "Do not change product behavior. Remove untracked generated content only after proving it is untracked. Restore tracked generated content exactly to HEAD; never delete tracked generated content or replace it with invented content. If any other product or approved delivery content must change, return REVALIDATION_REQUIRED.",
    "Inspect every generated root listed in the fingerprint summary. Remove all untracked generated entries and restore every tracked entry under those roots exactly to HEAD; do not return RECOVERED while generated pollution or a non-HEAD tracked generated entry remains.",
    "Return RECOVERED only when the workspace obstruction was safely removed, REVALIDATION_REQUIRED when delivery content changed, and UNSAFE when no bounded safe repair is possible.",
    "Always use the response envelope. On completion set outcome=RESULT, populate result, and set capabilityRequest=null. For a capability request set outcome=CAPABILITY_REQUIRED, set result=null, and populate capabilityRequest.",
    `Approved delivery summary: ${JSON.stringify(input.issue.repair?.delivery?.summary ?? input.issue.repair?.deliveryDraft?.summary ?? "Unavailable")}`,
    `Finalization diagnostic: ${JSON.stringify(input.diagnostic)}`,
    `Current workspace status: ${JSON.stringify(input.workspaceStatus)}`,
    `Approved delivery fingerprint summary: ${JSON.stringify(input.fingerprintSummary)}`,
    `Project instructions: ${input.project.instructions ?? "None"}`,
  ].join("\n\n");
}

function continuationPrompt(input: FinalizationRecoveryInput): string[] {
  if (input.continuation?.reason === "CAPABILITY_GRANTED") {
    return [
      `Capability request ${input.continuation.requestId} was granted: ${JSON.stringify(input.continuation.capabilities)}.`,
      "Continue the same recovery attempt in the existing workspace. Inspect current state and do not redo completed work.",
    ];
  }
  if (input.continuation?.reason === "RUNTIME_INTERRUPTED") {
    return [
      "The previous recovery turn was interrupted by a Runtime restart. Continue the same attempt in the existing workspace after inspecting current state. Do not redo completed work.",
    ];
  }
  return [];
}
