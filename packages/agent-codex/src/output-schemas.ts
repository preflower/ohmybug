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

export const assessmentOutputSchema = {
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

export const repairOutputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1 },
    evidence: {
      type: "array",
      minItems: 1,
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
  if (!Array.isArray(object.evidence) || object.evidence.length === 0 || object.evidence.length > 20) {
    throw new Error("VISUAL_EVIDENCE_REQUIRED");
  }
  return {
    summary: requiredString(object.summary, "DELIVERY_SUMMARY_REQUIRED"),
    evidence: object.evidence.map((entry) => {
      const item = strictObject(entry, ["type", "label", "relativePath"]);
      const type = requiredString(item.type, "EVIDENCE_TYPE_REQUIRED");
      if (type !== "screenshot" && type !== "recording") throw new Error("EVIDENCE_TYPE_INVALID");
      return {
        type,
        label: requiredString(item.label, "EVIDENCE_LABEL_REQUIRED"),
        relativePath: requiredString(item.relativePath, "EVIDENCE_PATH_REQUIRED"),
      };
    }),
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
