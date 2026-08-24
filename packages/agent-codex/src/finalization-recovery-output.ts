import { isAbsolute } from "node:path";

import type { FinalizationRecoveryResult } from "@oh-my-bug/core";

import { capabilityRequiredOutputSchema } from "./output-schemas.js";

export const finalizationRecoveryResultOutputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 4_000 },
    diagnosis: { type: "string", minLength: 1, maxLength: 4_000 },
    disposition: {
      type: "string",
      enum: ["RECOVERED", "REVALIDATION_REQUIRED", "UNSAFE"],
    },
    affectedPaths: {
      type: "array",
      minItems: 0,
      maxItems: 50,
      items: { type: "string", minLength: 1, maxLength: 1_000 },
    },
  },
  required: ["summary", "diagnosis", "disposition", "affectedPaths"],
  additionalProperties: false,
} as const;

export const finalizationRecoveryOutputSchema = {
  anyOf: [finalizationRecoveryResultOutputSchema, capabilityRequiredOutputSchema],
} as const;

export function parseFinalizationRecoveryOutput(value: unknown): FinalizationRecoveryResult {
  const object = strictObject(value, ["summary", "diagnosis", "disposition", "affectedPaths"]);
  const disposition = requiredString(
    object.disposition,
    100,
    "FINALIZATION_RECOVERY_DISPOSITION_INVALID",
  );
  if (
    disposition !== "RECOVERED"
    && disposition !== "REVALIDATION_REQUIRED"
    && disposition !== "UNSAFE"
  ) {
    throw new Error("FINALIZATION_RECOVERY_DISPOSITION_INVALID");
  }
  if (!Array.isArray(object.affectedPaths) || object.affectedPaths.length > 50) {
    throw new Error("FINALIZATION_RECOVERY_PATHS_INVALID");
  }
  return {
    summary: requiredString(object.summary, 4_000, "FINALIZATION_RECOVERY_SUMMARY_REQUIRED"),
    diagnosis: requiredString(
      object.diagnosis,
      4_000,
      "FINALIZATION_RECOVERY_DIAGNOSIS_REQUIRED",
    ),
    disposition,
    affectedPaths: object.affectedPaths.map(relativePath),
  };
}

function strictObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CODEX_OUTPUT_INVALID");
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !keys.includes(key))) {
    throw new Error("CODEX_OUTPUT_UNKNOWN_FIELD");
  }
  return object;
}

function requiredString(value: unknown, maxLength: number, code: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(code);
  }
  return value.trim();
}

function relativePath(value: unknown): string {
  const path = requiredString(value, 1_000, "FINALIZATION_RECOVERY_PATH_INVALID");
  if (
    isAbsolute(path)
    || /^[a-zA-Z]:[\\/]/.test(path)
    || path.startsWith("\\\\")
    || path.split(/[\\/]/).includes("..")
    || path === "."
    || path.includes("\0")
  ) {
    throw new Error("FINALIZATION_RECOVERY_PATH_ESCAPE");
  }
  return path;
}
