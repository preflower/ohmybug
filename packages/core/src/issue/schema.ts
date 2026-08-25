import { z } from "zod";

import {
  agentSessionRefSchema,
  assessmentSchema,
  deliverySchema,
} from "../agent/schemas.js";
import { integrationInputSchema } from "../integration/input.js";
import type { Issue, ReviewJson } from "./types.js";

export const issueStatusSchema = z.enum([
  "RECEIVED",
  "ASSESSING",
  "ASSESSMENT_REVIEW",
  "ASSESSMENT_FAILED",
  "REPAIRING",
  "EVIDENCE_CAPTURE",
  "EVIDENCE_CHECK",
  "EVIDENCE_FAILED",
  "REPAIR_FAILED",
  "PERMISSION_REQUIRED",
  "ACCEPTANCE_REVIEW",
  "REVIEW_REQUIRED",
  "FINALIZING",
  "FINALIZATION_RECOVERY",
  "FINALIZATION_FAILED",
  "COMPLETED",
  "CLOSED",
  "CANCELED",
]);

const MAX_REVIEW_JSON_BYTES = 32_768;
const MAX_REVIEW_JSON_DEPTH = 8;

function reviewJsonDepth(value: ReviewJson): number {
  if (value === null || typeof value !== "object") return 0;
  const values: ReviewJson[] = Array.isArray(value) ? value : Object.values(value);
  let childDepth = 0;
  for (const item of values) {
    childDepth = Math.max(childDepth, reviewJsonDepth(item));
  }
  return 1 + childDepth;
}

export const reviewJsonSchema: z.ZodType<ReviewJson> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string().max(MAX_REVIEW_JSON_BYTES),
  z.array(reviewJsonSchema).max(1_000),
  z.record(z.string().trim().min(1).max(200), reviewJsonSchema),
])).superRefine((value, context) => {
  if (reviewJsonDepth(value) > MAX_REVIEW_JSON_DEPTH) {
    context.addIssue({ code: "custom", message: "REVIEW_PAYLOAD_TOO_DEEP" });
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_REVIEW_JSON_BYTES) {
    context.addIssue({ code: "custom", message: "REVIEW_PAYLOAD_TOO_LARGE" });
  }
});

const reviewContinuationSchema = z.object({
  operation: z.enum(["ASSESS", "REPAIR", "FINALIZE"]).optional(),
  resumeStatus: z.enum(["ASSESSING", "REPAIRING", "FINALIZING", "CLOSED"]),
  resolution: z.enum(["FIXED", "IMPLEMENTED", "NOT_A_BUG", "DUPLICATE"]).optional(),
}).strict();

const reviewChoiceSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  feedbackRequired: z.boolean().optional(),
  continuation: reviewContinuationSchema,
}).strict();

export const reviewRequestSchema = z.object({
  id: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(100),
  requestedFrom: z.enum(["ASSESSING", "REPAIRING", "EVIDENCE_CHECK"]),
  payload: reviewJsonSchema,
  choices: z.array(reviewChoiceSchema).min(1).max(10).refine(
    (choices) => new Set(choices.map((choice) => choice.id)).size === choices.length,
    "REVIEW_CHOICE_DUPLICATE",
  ),
  requestedAt: z.iso.datetime(),
}).strict();

export const reviewSubmissionSchema = z.object({
  expectedRevision: z.number().int().positive(),
  requestId: z.string().trim().min(1).max(200),
  choiceId: z.string().trim().min(1).max(100),
  feedback: z.string().trim().min(1).max(4_000).optional(),
  data: reviewJsonSchema.optional(),
}).strict();

const agentCapabilitySchema = z.enum(["HOST_EXECUTION", "NETWORK_ACCESS"]);
const capabilityRequesterSchema = z.object({
  type: z.enum(["AGENT", "SKILL"]),
  id: z.string().trim().min(1).max(200).optional(),
}).strict();
const capabilityGrantSchema = z.object({
  capability: agentCapabilitySchema,
  requestId: z.string().trim().min(1),
  grantedAt: z.iso.datetime(),
}).strict();
const pendingCapabilityRequestSchema = z.object({
  id: z.string().trim().min(1),
  operation: z.enum([
    "ASSESS",
    "REPAIR",
    "CAPTURE_EVIDENCE",
    "RECOVER_FINALIZATION",
  ]),
  stage: z.enum([
    "ASSESSMENT",
    "REPAIR",
    "EVIDENCE",
    "FINALIZATION_RECOVERY",
  ]),
  resumeStatus: z.enum([
    "ASSESSING",
    "REPAIRING",
    "EVIDENCE_CAPTURE",
    "FINALIZATION_RECOVERY",
  ]),
  capabilities: z.array(agentCapabilitySchema).min(1).max(2).refine(
    (items) => new Set(items).size === items.length,
    "AGENT_CAPABILITY_DUPLICATE",
  ),
  reason: z.string().trim().min(1).max(4_000),
  blockedCommand: z.string().trim().min(1).max(2_000).optional(),
  requestedBy: capabilityRequesterSchema.optional(),
  requestedAt: z.iso.datetime(),
}).strict();

const repositoryRelativePathSchema = z.string().trim().min(1).max(1_000).refine(
  (value) =>
    !value.startsWith("/")
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.split(/[\\/]/).includes(".."),
  "REPOSITORY_RELATIVE_PATH_REQUIRED",
);

export const workspaceFinalizationDiagnosticSchema = z.object({
  providerId: z.string().trim().min(1).max(200),
  step: z.enum(["status", "add", "commit", "push", "merge", "release", "unknown"]),
  code: z.string().trim().min(1).max(200),
  exitCode: z.number().int().optional(),
  message: z.string().trim().min(1).max(4_000),
  stderr: z.string().max(8_000).optional(),
  relatedPaths: z.array(repositoryRelativePathSchema).max(50),
}).strict();

const mergeContextFields = {
  baseBranch: z.string().trim().min(1).max(200),
  baseCommit: z.string().trim().min(1).max(100).optional(),
  issueBranch: z.string().trim().min(1).max(200),
  issueCommit: z.string().trim().min(1).max(100),
  conflictPaths: z.array(repositoryRelativePathSchema).max(50),
  mergeMessages: z.array(z.string().trim().min(1).max(1_000)).max(20),
};

export const finalizationRecoveryContextSchema = z.discriminatedUnion(
  "recoveryKind",
  [
    z.object({
      recoveryKind: z.literal("GENERATED_ARTIFACT_CLEANUP"),
    }).strict(),
    z.object({
      recoveryKind: z.literal("MERGE_CONFLICT"),
      merge: z.object({
        kind: z.literal("MERGE_CONFLICT"),
        ...mergeContextFields,
        baseCommit: z.string().trim().min(1).max(100),
        conflictPaths: z.array(repositoryRelativePathSchema).max(50),
        mergePrepared: z.literal(true),
      }).strict(),
    }).strict(),
    z.object({
      recoveryKind: z.literal("MERGE_ENVIRONMENT"),
      merge: z.object({
        kind: z.literal("MERGE_ENVIRONMENT"),
        ...mergeContextFields,
        mergePrepared: z.literal(false),
      }).strict(),
    }).strict(),
  ],
);

const finalizationRecoverySchema = z.object({
  automaticAttempts: z.union([z.literal(0), z.literal(1)]),
  attemptId: z.string().trim().min(1).max(200).optional(),
  diagnostic: workspaceFinalizationDiagnosticSchema.optional(),
  fingerprintRef: z.string().trim().min(1).max(500).optional(),
  context: finalizationRecoveryContextSchema.optional(),
  summary: z.string().trim().min(1).max(4_000).optional(),
}).strict();

export const issueSchema: z.ZodType<Issue> = z
  .object({
    id: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    projectPath: z.string().trim().min(1).optional(),
    identifier: z.string().trim().min(1),
    title: z.string().trim().min(1),
    titleSource: z.enum(["integration", "assessment", "user"]),
    status: issueStatusSchema,
    resolution: z.enum(["FIXED", "IMPLEMENTED", "NOT_A_BUG", "DUPLICATE", "CANCELED"]).optional(),
    duplicateOf: z.string().trim().min(1).optional(),
    inputs: z.array(integrationInputSchema),
    agentSession: agentSessionRefSchema.optional(),
    assessment: assessmentSchema.optional(),
    assessmentFeedback: z.string().trim().min(1).optional(),
    repair: z
      .object({
        iteration: z.number().int().positive(),
        evidenceRetries: z.number().int().nonnegative().optional(),
        automaticEvidenceRetries: z.number().int().nonnegative().optional(),
        feedback: z.string().trim().min(1).optional(),
        deliveryDraft: z.object({
          summary: z.string().trim().min(1),
          repairIteration: z.number().int().positive(),
          implementationCompletedAt: z.iso.datetime(),
        }).strict().optional(),
        delivery: deliverySchema.optional(),
      })
      .strict()
      .optional(),
    lastFailure: z
      .object({
        stage: z.enum([
          "ASSESSMENT",
          "REPAIR",
          "EVIDENCE",
          "FINALIZATION_RECOVERY",
        ]),
        code: z.string().trim().min(1),
      })
      .strict()
      .optional(),
    capabilityGrants: z.array(capabilityGrantSchema).refine(
      (grants) => new Set(grants.map((grant) => grant.capability)).size === grants.length,
      "CAPABILITY_GRANT_DUPLICATE",
    ).optional(),
    pendingCapabilityRequest: pendingCapabilityRequestSchema.optional(),
    review: reviewRequestSchema.optional(),
    finalizationRecovery: finalizationRecoverySchema.optional(),
    revision: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
