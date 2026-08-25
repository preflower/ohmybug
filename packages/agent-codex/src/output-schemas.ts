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

export interface RepairOutput {
  summary: string;
  evidence: RepairEvidenceOutput[];
}

export interface EvidenceOutput {
  evidence: RepairEvidenceOutput[];
}

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

export const repairResultOutputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1 },
    evidence: {
      type: "array",
      minItems: 0,
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["screenshot", "recording"] },
          label: { type: "string", minLength: 1 },
          relativePath: { type: "string", minLength: 1 },
        },
        required: ["type", "label", "relativePath"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "evidence"],
  additionalProperties: false,
} as const;

export const evidenceResultOutputSchema = {
  type: "object",
  properties: {
    evidence: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: repairResultOutputSchema.properties.evidence.items,
    },
  },
  required: ["evidence"],
  additionalProperties: false,
} as const;

export const capabilityRequiredOutputSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["CAPABILITY_REQUIRED"] },
    capabilities: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
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
  required: ["outcome", "capabilities", "reason", "blockedCommand", "requestedBy"],
  additionalProperties: false,
} as const;

export const assessmentOutputSchema = {
  anyOf: [assessmentResultOutputSchema, capabilityRequiredOutputSchema],
} as const;

export const repairOutputSchema = {
  anyOf: [repairResultOutputSchema, capabilityRequiredOutputSchema],
} as const;

export const evidenceOutputSchema = {
  anyOf: [evidenceResultOutputSchema, capabilityRequiredOutputSchema],
} as const;

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
  return parseCapabilityRequest(value);
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
  const object = strictObject(value, [
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
  const object = strictObject(value, ["summary", "evidence"]);
  if (!Array.isArray(object.evidence) || object.evidence.length > 20) {
    throw new Error("VISUAL_EVIDENCE_INVALID");
  }
  return {
    summary: requiredString(object.summary, "DELIVERY_SUMMARY_REQUIRED"),
    evidence: object.evidence.map(parseEvidenceItem),
  };
}

export function parseEvidenceOutput(value: unknown): EvidenceOutput {
  const object = strictObject(value, ["evidence"]);
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
    label: requiredString(item.label, "EVIDENCE_LABEL_REQUIRED"),
    relativePath: requiredString(item.relativePath, "EVIDENCE_PATH_REQUIRED"),
  };
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
import type {
  AgentCapabilityRequest,
  AgentCapabilityRequester,
} from "@oh-my-bug/core";
