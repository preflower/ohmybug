import type {
  AssessInput,
  EvidenceCaptureInput,
  Issue,
  RepairInput,
} from "@oh-my-bug/core";

import {
  effectiveStageCapabilities,
  type CodexAgentStage,
} from "./stage-capabilities.js";

export function assessmentPrompt(input: AssessInput): string {
  return [
    "Assess whether this Issue requests a software bug fix or a feature change. Do not modify files or Git state.",
    ...continuationPrompt(input.continuation),
    ...capabilityPrompt(input.issue, "ASSESSMENT"),
    "Use BUG when existing intended behavior is broken, FEATURE for a new capability or enhancement, NOT_A_BUG when no code change is warranted, and UNCERTAIN when evidence is insufficient.",
    "BUG requires rootCause and solution. FEATURE requires solution; rootCause may be omitted.",
    "Return only the requested structured Assessment. Every verdict will be reviewed by a human.",
    `Issue: ${JSON.stringify(input.issue)}`,
    `Project instructions: ${input.project.instructions ?? "None"}`,
    ...(input.feedback ? [`Human reassessment feedback: ${input.feedback}`] : []),
  ].join("\n\n");
}

export function repairPrompt(input: RepairInput): string {
  return [
    "Implement the approved BUG or FEATURE change in the supplied project directory. Run your own engineering loop until ready.",
    ...continuationPrompt(input.continuation),
    ...capabilityPrompt(input.issue, "REPAIR"),
    "Oh My Bug does not manage Git operations.",
    `Write screenshots or recordings under: ${input.evidenceDirectory}`,
    "Visual evidence must directly capture a real acceptance run that proves the change, such as the running application, an actual API request and response, or an executed benchmark. Never submit generated, reconstructed, mocked, or illustrative visuals.",
    "Return relative paths beneath that directory; do not return absolute paths.",
    `Issue: ${JSON.stringify(input.issue)}`,
    `Approved Assessment: ${JSON.stringify(input.assessment)}`,
    `Project commands: ${JSON.stringify(input.project.commands ?? {})}`,
    `Project instructions: ${input.project.instructions ?? "None"}`,
    ...(input.previousDelivery ? [`Previous Delivery: ${JSON.stringify(input.previousDelivery)}`] : []),
    ...(input.feedback ? [`Human/evidence feedback: ${input.feedback}`] : []),
  ].join("\n\n");
}

export function evidencePrompt(input: EvidenceCaptureInput): string {
  return [
    "Capture real visual evidence for the already completed implementation. Do not reimplement or refactor the product change.",
    ...continuationPrompt(input.continuation),
    ...capabilityPrompt(input.issue, "EVIDENCE"),
    "Inspect the existing files and prior verification first. Modify product code only if the acceptance run exposes a real defect.",
    `Write screenshots or recordings under: ${input.evidenceDirectory}`,
    "Visual evidence must directly capture a real acceptance run that proves the change. Never submit generated, reconstructed, mocked, or illustrative visuals.",
    "Return only screenshots or recordings using relative paths beneath that directory; do not return absolute paths.",
    `Issue: ${JSON.stringify(input.issue)}`,
    `Approved Assessment: ${JSON.stringify(input.assessment)}`,
    `Completed implementation: ${JSON.stringify(input.deliveryDraft)}`,
    `Project commands: ${JSON.stringify(input.project.commands ?? {})}`,
    `Project instructions: ${input.project.instructions ?? "None"}`,
    ...(input.feedback ? [`Human/evidence feedback: ${input.feedback}`] : []),
  ].join("\n\n");
}

function continuationPrompt(
  continuation:
    | AssessInput["continuation"]
    | RepairInput["continuation"]
    | EvidenceCaptureInput["continuation"],
): string[] {
  if (continuation?.reason === "CAPABILITY_GRANTED") {
    return [
      `Capability request ${continuation.requestId} was granted: ${JSON.stringify(continuation.capabilities)}.`,
      "Continue the previously blocked stage in the existing workspace. Inspect current files and do not redo completed work.",
    ];
  }
  if (continuation?.reason === "RUNTIME_INTERRUPTED") {
    return [
      "The previous turn was interrupted by a Runtime restart. Continue the existing work in the supplied workspace. Inspect current files and prior verification before making changes. Do not redo completed implementation work. Complete only the remaining stage requirements.",
    ];
  }
  return [];
}

function capabilityPrompt(
  issue: Issue,
  stage: CodexAgentStage,
): string[] {
  const available = effectiveStageCapabilities(issue, stage);
  return [
    `Capabilities already available in this stage: ${JSON.stringify([...available])}`,
    "Use a practical lower-privilege alternative first.",
    "If a project Skill explicitly requires host or network access, or a sandbox, permission, or network denial leaves no practical lower-privilege alternative, stop retrying and return the CAPABILITY_REQUIRED structured outcome.",
    "Request HOST_EXECUTION for unrestricted host execution and NETWORK_ACCESS for network access. Do not request a capability that is already available.",
  ];
}
