import { z } from "zod";

const boundedText = z.string().trim().min(1).max(4_000);
const repositoryRelativePathSchema = z.string().trim().min(1).max(1_000).refine(
  (value) =>
    !value.startsWith("/")
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.split(/[\\/]/).includes(".."),
  "REPOSITORY_RELATIVE_PATH_REQUIRED",
);
const commitSchema = z.string().trim().min(1).max(100);

export const assessmentSchema = z
  .object({
    revision: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    verdict: z.enum(["BUG", "FEATURE", "NOT_A_BUG", "UNCERTAIN"]),
    suggestedTitle: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    rootCause: z.string().trim().min(1).optional(),
    solution: z.string().trim().min(1).optional(),
    suspectedDuplicateOf: z.string().trim().min(1).optional(),
  })
  .strict();

export const agentSessionRefSchema = z
  .object({
    agent: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const visualEvidenceSchema = z
  .object({
    type: z.enum(["screenshot", "recording"]),
    label: z.string().trim().min(1),
    evidenceId: z.string().regex(/^sha256-[a-f0-9]{64}$/),
  })
  .strict();

export const deliverySchema = z
  .object({
    summary: z.string().trim().min(1),
    evidence: z.array(visualEvidenceSchema).min(1),
  })
  .strict();

export const repairIntegrationInputSchema = z.object({
  baseBranch: z.string().trim().min(1).max(200),
  observedBaseCommit: commitSchema,
  issueBranch: z.string().trim().min(1).max(200),
}).strict();

export const repairEvidencePathSchema = z.object({
  type: z.enum(["screenshot", "recording"]),
  label: z.string().trim().min(1).max(200),
  relativePath: repositoryRelativePathSchema,
}).strict();

export const repairVerificationSchema = z.object({
  command: z.string().trim().min(1).max(2_000),
  outcome: z.enum(["PASSED", "FAILED", "NOT_RUN"]),
  summary: boundedText,
}).strict();

export const repairConflictResolutionSchema = z.object({
  path: repositoryRelativePathSchema,
  classification: z.enum(["TEXTUAL", "COMPATIBLE_BUSINESS"]),
  resolution: boundedText,
}).strict();

const repairDeliveryReadySchema = z.object({
  kind: z.literal("DELIVERY_READY"),
  summary: boundedText,
  evidence: z.array(repairEvidencePathSchema).max(100),
  integration: z.object({
    baseCommit: commitSchema,
    issueCommit: commitSchema,
    conflicts: z.array(repairConflictResolutionSchema).max(100),
  }).strict().optional(),
  verification: z.array(repairVerificationSchema).min(1).max(100),
}).strict();

const repairBusinessDecisionSchema = z.object({
  kind: z.literal("BUSINESS_DECISION_REQUIRED"),
  summary: boundedText,
  decision: z.object({
    baseCommit: commitSchema,
    issueCommit: commitSchema,
    conflictPaths: z.array(repositoryRelativePathSchema).min(1).max(100),
    baseIntent: boundedText,
    issueIntent: boundedText,
    incompatibility: boundedText,
    recommendation: boundedText,
    rationale: boundedText,
    choices: z.array(z.object({
      id: z.string().trim().min(1).max(100),
      label: z.string().trim().min(1).max(200),
      description: boundedText,
    }).strict()).min(1).max(10).refine(
      (choices) => new Set(choices.map((choice) => choice.id)).size === choices.length,
      "REPAIR_DECISION_CHOICE_DUPLICATE",
    ),
  }).strict(),
}).strict();

export const repairResultSchema = z.discriminatedUnion("kind", [
  repairDeliveryReadySchema,
  repairBusinessDecisionSchema,
]);
