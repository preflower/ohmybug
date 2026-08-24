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
  "EVIDENCE_CAPTURE",
  "EVIDENCE_CHECK",
  "EVIDENCE_FAILED",
  "REPAIR_FAILED",
  "PERMISSION_REQUIRED",
  "ACCEPTANCE_REVIEW",
  "APPROVED",
  "COMPLETED",
  "CLOSED",
  "CANCELED",
]);

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
  operation: z.enum(["ASSESS", "REPAIR", "CAPTURE_EVIDENCE"]),
  stage: z.enum(["ASSESSMENT", "REPAIR", "EVIDENCE"]),
  resumeStatus: z.enum(["ASSESSING", "REPAIRING", "EVIDENCE_CAPTURE"]),
  capabilities: z.array(agentCapabilitySchema).min(1).max(2).refine(
    (items) => new Set(items).size === items.length,
    "AGENT_CAPABILITY_DUPLICATE",
  ),
  reason: z.string().trim().min(1).max(4_000),
  blockedCommand: z.string().trim().min(1).max(2_000).optional(),
  requestedBy: capabilityRequesterSchema.optional(),
  requestedAt: z.iso.datetime(),
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
        stage: z.enum(["ASSESSMENT", "REPAIR", "EVIDENCE"]),
        code: z.string().trim().min(1),
      })
      .strict()
      .optional(),
    capabilityGrants: z.array(capabilityGrantSchema).refine(
      (grants) => new Set(grants.map((grant) => grant.capability)).size === grants.length,
      "CAPABILITY_GRANT_DUPLICATE",
    ).optional(),
    pendingCapabilityRequest: pendingCapabilityRequestSchema.optional(),
    revision: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
