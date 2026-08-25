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
    "Never run git add, git commit, git merge, git rebase, git reset, git clean, or git push. Never update refs, stage the real index, abort merge state, or release the Worktree.",
    ...recoveryInstructions(input),
    "Return RECOVERED only when the workspace obstruction was safely removed, REVALIDATION_REQUIRED when delivery content changed, and UNSAFE when no bounded safe repair is possible.",
    "Return REVALIDATION_REQUIRED whenever source content changed. Your disposition is advisory; the Workspace Provider validates the result independently.",
    "Always use the response envelope. On completion set outcome=RESULT, populate result, and set capabilityRequest=null. For a capability request set outcome=CAPABILITY_REQUIRED, set result=null, and populate capabilityRequest.",
    `Issue request: ${JSON.stringify(input.issue.inputs.at(-1)?.data.content ?? input.issue.title)}`,
    `Assessment: ${JSON.stringify(input.issue.assessment ?? "Unavailable")}`,
    `Approved delivery summary: ${JSON.stringify(input.issue.repair?.delivery?.summary ?? input.issue.repair?.deliveryDraft?.summary ?? "Unavailable")}`,
    `Finalization diagnostic: ${JSON.stringify(input.diagnostic)}`,
    `Current workspace status: ${JSON.stringify(input.workspaceStatus)}`,
    `Approved delivery fingerprint summary: ${JSON.stringify(input.fingerprintSummary)}`,
    `Project instructions: ${input.project.instructions ?? "None"}`,
  ].join("\n\n");
}

function recoveryInstructions(input: FinalizationRecoveryInput): string[] {
  if (input.recoveryKind === "MERGE_CONFLICT" && input.merge?.mergePrepared) {
    if (input.merge.conflictPaths.length === 0) {
      return [
        "The Provider prepared a renewed merge against an advanced base and found no unresolved content conflict.",
        "Inspect the prepared result without editing it unless a concrete Issue-Worktree defect is present. Do not stage files.",
        "Return REVALIDATION_REQUIRED so the recomputed merge receives evidence and renewed human acceptance.",
        `Merge context: ${JSON.stringify(input.merge)}`,
      ];
    }
    return [
      "Resolve the Provider-prepared content conflicts in the retained Issue Worktree.",
      "Inspect every conflict path and preserve both the Issue intent and compatible base-branch behavior.",
      "Edit working files only. Do not stage them. Run the smallest relevant project tests when feasible.",
      `Merge context: ${JSON.stringify(input.merge)}`,
    ];
  }
  if (input.recoveryKind === "MERGE_ENVIRONMENT") {
    return [
      "Diagnose this merge environment or policy failure. This is inspection-only unless a safe Issue-Worktree-only repair is proven.",
      "Do not edit the base checkout, refs, hooks, Git configuration, permissions, or repository policy.",
      "Return UNSAFE when progress requires repository authority outside the retained Issue Worktree.",
      `Merge context: ${JSON.stringify(input.merge ?? "Unavailable")}`,
    ];
  }
  return [
    "Do not change product behavior. Remove untracked generated content only after proving it is untracked. Restore tracked generated content exactly to HEAD; never delete tracked generated content or replace it with invented content. If any other product or approved delivery content must change, return REVALIDATION_REQUIRED.",
    "Inspect every generated root listed in the fingerprint summary. Remove all untracked generated entries and restore every tracked entry under those roots exactly to HEAD; do not return RECOVERED while generated pollution or a non-HEAD tracked generated entry remains.",
  ];
}

function continuationPrompt(input: FinalizationRecoveryInput): string[] {
  if (input.continuation?.reason === "USER_RESUMED") {
    return [
      "The previous recovery turn was paused by the user and is now being continued.",
      "Inspect the preserved recovery workspace and prior verification. Do not redo completed work; finish only the remaining recovery requirements.",
    ];
  }
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
