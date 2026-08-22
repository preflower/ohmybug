import { z } from "zod";

import {
  agentSessionRefSchema,
  assessmentSchema,
  deliverySchema,
} from "../agent/schemas.js";
import { integrationInputSchema } from "../integration/input.js";
import type { Issue } from "./types.js";

export const issueStatusSchema = z.enum([
  "RECEIVED",
  "ASSESSING",
  "ASSESSMENT_REVIEW",
  "ASSESSMENT_FAILED",
  "REPAIRING",
  "EVIDENCE_CHECK",
  "REPAIR_FAILED",
  "ACCEPTANCE_REVIEW",
  "APPROVED",
  "COMPLETED",
  "CLOSED",
  "CANCELED",
]);

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
        automaticEvidenceRetries: z.number().int().nonnegative().optional(),
        feedback: z.string().trim().min(1).optional(),
        delivery: deliverySchema.optional(),
      })
      .strict()
      .optional(),
    lastFailure: z
      .object({
        stage: z.enum(["ASSESSMENT", "REPAIR"]),
        code: z.string().trim().min(1),
      })
      .strict()
      .optional(),
    revision: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
