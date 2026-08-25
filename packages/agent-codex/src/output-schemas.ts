import type {
  AgentCapabilityRequest,
  AgentCapabilityRequester,
  RepairVerification,
  RepairResult,
} from "@oh-my-bug/core";

export interface AssessmentOutput {
  verdict: "BUG" | "FEATURE" | "NOT_A_BUG" | "UNCERTAIN";
  suggestedTitle: string;
  reasoning: string;
  rootCause?: string;
  solution?: string;
  suspectedDuplicateOf?: string;
}

export interface RepairEvidenceOutput {
  type: "screenshot" | "recording";
  label: string;
  relativePath: string;
}

export type RepairOutput = RepairResult;

export interface EvidenceOutput {
  evidence: RepairEvidenceOutput[];
}

const boundedTextSchema = { type: "string", minLength: 1, maxLength: 4_000 } as const;
const repositoryPathSchema = { type: "string", minLength: 1, maxLength: 1_000 } as const;
const commitSchema = { type: "string", minLength: 1, maxLength: 100 } as const;
const evidenceItemOutputSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["screenshot", "recording"] },
    label: { type: "string", minLength: 1, maxLength: 200 },
    relativePath: repositoryPathSchema,
  },
  required: ["type", "label", "relativePath"],
  additionalProperties: false,
} as const;
const verificationOutputSchema = {
  type: "object",
  properties: {
    command: { type: "string", minLength: 1, maxLength: 2_000 },
    outcome: { type: "string", enum: ["PASSED", "FAILED", "NOT_RUN"] },
    summary: boundedTextSchema,
  },
  required: ["command", "outcome", "summary"],
  additionalProperties: false,
} as const;
const conflictResolutionOutputSchema = {
  type: "object",
  properties: {
    path: repositoryPathSchema,
    classification: { type: "string", enum: ["TEXTUAL", "COMPATIBLE_BUSINESS"] },
    resolution: boundedTextSchema,
  },
  required: ["path", "classification", "resolution"],
  additionalProperties: false,
} as const;

export const assessmentResultOutputSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["BUG", "FEATURE", "NOT_A_BUG", "UNCERTAIN"] },
    suggestedTitle: { type: "string" },
    reasoning: { type: "string" },
    rootCause: { type: ["string", "null"] },
    solution: { type: ["string", "null"] },
    suspectedDuplicateOf: { type: ["string", "null"] },
  },
  required: [
    "verdict",
    "suggestedTitle",
    "reasoning",
    "rootCause",
    "solution",
    "suspectedDuplicateOf",
  ],
  additionalProperties: false,
} as const;

const deliveryReadyOutputSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["DELIVERY_READY"] },
    summary: boundedTextSchema,
    evidence: {
      type: "array",
      minItems: 0,
      maxItems: 20,
      items: evidenceItemOutputSchema,
    },
    integration: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            baseCommit: commitSchema,
            issueCommit: commitSchema,
            conflicts: {
              type: "array",
              minItems: 0,
              maxItems: 100,
              items: conflictResolutionOutputSchema,
            },
          },
          required: ["baseCommit", "issueCommit", "conflicts"],
          additionalProperties: false,
        },
      ],
    },
    verification: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: verificationOutputSchema,
    },
  },
  required: ["kind", "summary", "evidence", "integration", "verification"],
  additionalProperties: false,
} as const;

const businessDecisionOutputSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["BUSINESS_DECISION_REQUIRED"] },
    summary: boundedTextSchema,
    decision: {
      type: "object",
      properties: {
        baseCommit: commitSchema,
        issueCommit: commitSchema,
        conflictPaths: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: repositoryPathSchema,
        },
        baseIntent: boundedTextSchema,
        issueIntent: boundedTextSchema,
        incompatibility: boundedTextSchema,
        recommendation: boundedTextSchema,
        rationale: boundedTextSchema,
        choices: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              id: { type: "string", minLength: 1, maxLength: 100 },
              label: { type: "string", minLength: 1, maxLength: 200 },
              description: boundedTextSchema,
            },
            required: ["id", "label", "description"],
            additionalProperties: false,
          },
        },
      },
      required: [
        "baseCommit",
        "issueCommit",
        "conflictPaths",
        "baseIntent",
        "issueIntent",
        "incompatibility",
        "recommendation",
        "rationale",
        "choices",
      ],
      additionalProperties: false,
    },
  },
  required: ["kind", "summary", "decision"],
  additionalProperties: false,
} as const;

export const repairResultOutputSchema = {
  anyOf: [deliveryReadyOutputSchema, businessDecisionOutputSchema],
} as const;

export const evidenceResultOutputSchema = {
  type: "object",
  properties: {
    evidence: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: evidenceItemOutputSchema,
    },
  },
  required: ["evidence"],
  additionalProperties: false,
} as const;

const capabilityRequestOutputSchema = {
  type: "object",
  properties: {
    capabilities: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: { type: "string", enum: ["HOST_EXECUTION", "NETWORK_ACCESS"] },
    },
    reason: { type: "string", minLength: 1, maxLength: 4_000 },
    blockedCommand: { type: ["string", "null"], maxLength: 2_000 },
    requestedBy: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["AGENT", "SKILL"] },
            id: { type: ["string", "null"], maxLength: 200 },
          },
          required: ["type", "id"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ["capabilities", "reason", "blockedCommand", "requestedBy"],
  additionalProperties: false,
} as const;

export const capabilityRequiredOutputSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["CAPABILITY_REQUIRED"] },
    ...capabilityRequestOutputSchema.properties,
  },
  required: ["outcome", ...capabilityRequestOutputSchema.required],
  additionalProperties: false,
} as const;

function outputEnvelopeSchema<ResultSchema>(resultSchema: ResultSchema) {
  return {
    type: "object",
    properties: {
      outcome: { type: "string", enum: ["RESULT", "CAPABILITY_REQUIRED"] },
      result: { anyOf: [resultSchema, { type: "null" }] },
      capabilityRequest: { anyOf: [capabilityRequestOutputSchema, { type: "null" }] },
    },
    required: ["outcome", "result", "capabilityRequest"],
    additionalProperties: false,
  } as const;
}

export const assessmentOutputSchema = outputEnvelopeSchema(assessmentResultOutputSchema);
export const repairOutputSchema = outputEnvelopeSchema(repairResultOutputSchema);
export const evidenceOutputSchema = outputEnvelopeSchema(evidenceResultOutputSchema);

export function parseCapabilityRequiredOutput(
  value: unknown,
): AgentCapabilityRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.outcome !== "CAPABILITY_REQUIRED") return undefined;
  if ("result" in candidate || "capabilityRequest" in candidate) {
    const envelope = strictObject(value, ["outcome", "result", "capabilityRequest"]);
    if (envelope.result !== null || envelope.capabilityRequest === null) {
      throw new Error("AGENT_CAPABILITY_REQUIRED");
    }
    return parseCapabilityRequest(envelope.capabilityRequest);
  }

  // Stored fixtures and interrupted turns may still use the pre-envelope form.
  const object = strictObject(value, [
    "outcome",
    "capabilities",
    "reason",
    "blockedCommand",
    "requestedBy",
  ]);
  return parseCapabilityRequest(object);
}

function parseCapabilityRequest(value: unknown): AgentCapabilityRequest {
  const object = strictObject(value, [
    "outcome",
    "capabilities",
    "reason",
    "blockedCommand",
    "requestedBy",
  ]);
  if (!Array.isArray(object.capabilities) || object.capabilities.length === 0) {
    throw new Error("AGENT_CAPABILITY_REQUIRED");
  }
  const capabilities = [...new Set(object.capabilities.map((entry) => {
    if (entry !== "HOST_EXECUTION" && entry !== "NETWORK_ACCESS") {
      throw new Error("AGENT_CAPABILITY_INVALID");
    }
    return entry;
  }))];
  return {
    capabilities,
    reason: boundedString(object.reason, 4_000, "AGENT_CAPABILITY_REASON_REQUIRED"),
    ...optionalBoundedString(object.blockedCommand, "blockedCommand", 2_000),
    ...optionalRequester(object.requestedBy),
  };
}

export function parseAssessmentOutput(value: unknown): AssessmentOutput {
  const object = strictObject(unwrapResult(value), [
    "verdict", "suggestedTitle", "reasoning", "rootCause", "solution", "suspectedDuplicateOf",
  ]);
  const verdict = requiredString(object.verdict, "ASSESSMENT_VERDICT_REQUIRED");
  if (!(["BUG", "FEATURE", "NOT_A_BUG", "UNCERTAIN"] as string[]).includes(verdict)) {
    throw new Error("ASSESSMENT_VERDICT_INVALID");
  }
  const result: AssessmentOutput = {
    verdict: verdict as AssessmentOutput["verdict"],
    suggestedTitle: requiredString(object.suggestedTitle, "ASSESSMENT_TITLE_REQUIRED"),
    reasoning: requiredString(object.reasoning, "ASSESSMENT_REASONING_REQUIRED"),
    ...optionalString(object.rootCause, "rootCause"),
    ...optionalString(object.solution, "solution"),
    ...optionalString(object.suspectedDuplicateOf, "suspectedDuplicateOf"),
  };
  if (result.verdict === "BUG" && (!result.rootCause || !result.solution)) {
    throw new Error("BUG_ASSESSMENT_DETAILS_REQUIRED");
  }
  if (result.verdict === "FEATURE" && !result.solution) {
    throw new Error("FEATURE_ASSESSMENT_SOLUTION_REQUIRED");
  }
  return result;
}

export function parseRepairOutput(value: unknown): RepairOutput {
  const raw = unwrapResult(value);
  const candidate = strictObject(raw, ["kind", "summary", "evidence", "integration", "verification", "decision"]);
  if (candidate.kind === "DELIVERY_READY") return parseDeliveryReady(candidate);
  if (candidate.kind === "BUSINESS_DECISION_REQUIRED") return parseBusinessDecision(candidate);
  throw new Error("REPAIR_RESULT_KIND_INVALID");
}

function parseDeliveryReady(value: Record<string, unknown>): Extract<RepairOutput, { kind: "DELIVERY_READY" }> {
  const object = strictObject(value, ["kind", "summary", "evidence", "integration", "verification"]);
  if (!Array.isArray(object.evidence) || object.evidence.length > 20) {
    throw new Error("VISUAL_EVIDENCE_INVALID");
  }
  if (!Array.isArray(object.verification) || object.verification.length === 0 || object.verification.length > 100) {
    throw new Error("REPAIR_VERIFICATION_REQUIRED");
  }
  const integration = object.integration === undefined || object.integration === null
    ? undefined
    : parseIntegration(object.integration);
  return {
    kind: "DELIVERY_READY",
    summary: boundedString(object.summary, 4_000, "DELIVERY_SUMMARY_REQUIRED"),
    evidence: object.evidence.map(parseEvidenceItem),
    ...(integration ? { integration } : {}),
    verification: object.verification.map(parseVerification),
  };
}

function parseIntegration(
  value: unknown,
): NonNullable<Extract<RepairOutput, { kind: "DELIVERY_READY" }>["integration"]> {
  const object = strictObject(value, ["baseCommit", "issueCommit", "conflicts"]);
  if (!Array.isArray(object.conflicts) || object.conflicts.length > 100) {
    throw new Error("REPAIR_CONFLICTS_INVALID");
  }
  return {
    baseCommit: boundedString(object.baseCommit, 100, "REPAIR_BASE_COMMIT_REQUIRED"),
    issueCommit: boundedString(object.issueCommit, 100, "REPAIR_ISSUE_COMMIT_REQUIRED"),
    conflicts: object.conflicts.map((entry) => {
      const conflict = strictObject(entry, ["path", "classification", "resolution"]);
      if (conflict.classification !== "TEXTUAL" && conflict.classification !== "COMPATIBLE_BUSINESS") {
        throw new Error("REPAIR_CONFLICT_CLASSIFICATION_INVALID");
      }
      return {
        path: repositoryRelativePath(conflict.path),
        classification: conflict.classification,
        resolution: boundedString(conflict.resolution, 4_000, "REPAIR_CONFLICT_RESOLUTION_REQUIRED"),
      };
    }),
  };
}

function parseVerification(value: unknown): RepairVerification {
  const object = strictObject(value, ["command", "outcome", "summary"]);
  const outcome = object.outcome;
  if (outcome !== "PASSED" && outcome !== "FAILED" && outcome !== "NOT_RUN") {
    throw new Error("REPAIR_VERIFICATION_OUTCOME_INVALID");
  }
  return {
    command: boundedString(object.command, 2_000, "REPAIR_VERIFICATION_COMMAND_REQUIRED"),
    outcome,
    summary: boundedString(object.summary, 4_000, "REPAIR_VERIFICATION_SUMMARY_REQUIRED"),
  };
}

function parseBusinessDecision(
  value: Record<string, unknown>,
): Extract<RepairOutput, { kind: "BUSINESS_DECISION_REQUIRED" }> {
  const object = strictObject(value, ["kind", "summary", "decision"]);
  const decision = strictObject(object.decision, [
    "baseCommit",
    "issueCommit",
    "conflictPaths",
    "baseIntent",
    "issueIntent",
    "incompatibility",
    "recommendation",
    "rationale",
    "choices",
  ]);
  if (!Array.isArray(decision.conflictPaths) || decision.conflictPaths.length === 0 || decision.conflictPaths.length > 100) {
    throw new Error("REPAIR_CONFLICT_PATHS_REQUIRED");
  }
  if (!Array.isArray(decision.choices) || decision.choices.length === 0 || decision.choices.length > 10) {
    throw new Error("REPAIR_DECISION_CHOICES_REQUIRED");
  }
  const choices = decision.choices.map((entry) => {
    const choice = strictObject(entry, ["id", "label", "description"]);
    return {
      id: boundedString(choice.id, 100, "REPAIR_DECISION_CHOICE_ID_REQUIRED"),
      label: boundedString(choice.label, 200, "REPAIR_DECISION_CHOICE_LABEL_REQUIRED"),
      description: boundedString(choice.description, 4_000, "REPAIR_DECISION_CHOICE_DESCRIPTION_REQUIRED"),
    };
  });
  if (new Set(choices.map((choice) => choice.id)).size !== choices.length) {
    throw new Error("REPAIR_DECISION_CHOICE_DUPLICATE");
  }
  return {
    kind: "BUSINESS_DECISION_REQUIRED",
    summary: boundedString(object.summary, 4_000, "DELIVERY_SUMMARY_REQUIRED"),
    decision: {
      baseCommit: boundedString(decision.baseCommit, 100, "REPAIR_BASE_COMMIT_REQUIRED"),
      issueCommit: boundedString(decision.issueCommit, 100, "REPAIR_ISSUE_COMMIT_REQUIRED"),
      conflictPaths: decision.conflictPaths.map(repositoryRelativePath),
      baseIntent: boundedString(decision.baseIntent, 4_000, "REPAIR_BASE_INTENT_REQUIRED"),
      issueIntent: boundedString(decision.issueIntent, 4_000, "REPAIR_ISSUE_INTENT_REQUIRED"),
      incompatibility: boundedString(decision.incompatibility, 4_000, "REPAIR_INCOMPATIBILITY_REQUIRED"),
      recommendation: boundedString(decision.recommendation, 4_000, "REPAIR_RECOMMENDATION_REQUIRED"),
      rationale: boundedString(decision.rationale, 4_000, "REPAIR_RATIONALE_REQUIRED"),
      choices,
    },
  };
}

export function parseEvidenceOutput(value: unknown): EvidenceOutput {
  const object = strictObject(unwrapResult(value), ["evidence"]);
  if (!Array.isArray(object.evidence) || object.evidence.length === 0 || object.evidence.length > 20) {
    throw new Error("VISUAL_EVIDENCE_REQUIRED");
  }
  return { evidence: object.evidence.map(parseEvidenceItem) };
}

function parseEvidenceItem(entry: unknown): RepairEvidenceOutput {
  const item = strictObject(entry, ["type", "label", "relativePath"]);
  const type = requiredString(item.type, "EVIDENCE_TYPE_REQUIRED");
  if (type !== "screenshot" && type !== "recording") throw new Error("EVIDENCE_TYPE_INVALID");
  return {
    type,
    label: boundedString(item.label, 200, "EVIDENCE_LABEL_REQUIRED"),
    relativePath: boundedString(item.relativePath, 1_000, "EVIDENCE_PATH_REQUIRED"),
  };
}

function unwrapResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (!("result" in candidate) && !("capabilityRequest" in candidate)) return value;
  const envelope = strictObject(value, ["outcome", "result", "capabilityRequest"]);
  if (envelope.outcome !== "RESULT" || envelope.result === null || envelope.capabilityRequest !== null) {
    throw new Error("CODEX_OUTPUT_INVALID");
  }
  return envelope.result;
}

function repositoryRelativePath(value: unknown): string {
  const path = boundedString(value, 1_000, "REPAIR_PATH_REQUIRED");
  if (
    path.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(path)
    || path.split(/[\\/]/).includes("..")
  ) throw new Error("REPAIR_PATH_ESCAPE");
  return path;
}

function strictObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CODEX_OUTPUT_INVALID");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !keys.includes(key))) throw new Error("CODEX_OUTPUT_UNKNOWN_FIELD");
  return object;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function optionalString(value: unknown, key: string): Record<string, string> {
  if (value === undefined || value === null) return {};
  return { [key]: requiredString(value, `${key.toUpperCase()}_INVALID`) };
}

function boundedString(value: unknown, maxLength: number, code: string): string {
  const result = requiredString(value, code);
  if (result.length > maxLength) throw new Error(code);
  return result;
}

function optionalBoundedString(
  value: unknown,
  key: string,
  maxLength: number,
): Record<string, string> {
  if (value === undefined || value === null) return {};
  return { [key]: boundedString(value, maxLength, `${key.toUpperCase()}_INVALID`) };
}

function optionalRequester(value: unknown): { requestedBy?: AgentCapabilityRequester } {
  if (value === undefined || value === null) return {};
  const object = strictObject(value, ["type", "id"]);
  if (object.type !== "AGENT" && object.type !== "SKILL") {
    throw new Error("AGENT_CAPABILITY_REQUESTER_INVALID");
  }
  return {
    requestedBy: {
      type: object.type,
      ...optionalBoundedString(object.id, "id", 200),
    },
  };
}
