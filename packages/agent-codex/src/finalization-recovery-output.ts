import { isAbsolute } from "node:path";

import type { FinalizationRecoveryResult } from "@oh-my-bug/core";

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

const recoveryCapabilityRequestOutputSchema = {
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

export const finalizationRecoveryOutputSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["RESULT", "CAPABILITY_REQUIRED"] },
    result: { anyOf: [finalizationRecoveryResultOutputSchema, { type: "null" }] },
    capabilityRequest: {
      anyOf: [recoveryCapabilityRequestOutputSchema, { type: "null" }],
    },
  },
  required: ["outcome", "result", "capabilityRequest"],
  additionalProperties: false,
} as const;

export function parseFinalizationRecoveryOutput(value: unknown): FinalizationRecoveryResult {
  const object = strictObject(
    unwrapRecoveryResult(value),
    ["summary", "diagnosis", "disposition", "affectedPaths"],
  );
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

function unwrapRecoveryResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (!("result" in candidate) && !("capabilityRequest" in candidate)) return value;
  const envelope = strictObject(value, ["outcome", "result", "capabilityRequest"]);
  if (
    envelope.outcome !== "RESULT"
    || envelope.result === null
    || envelope.capabilityRequest !== null
  ) {
    throw new Error("CODEX_OUTPUT_INVALID");
  }
  return envelope.result;
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
