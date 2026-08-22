import { z } from "zod";

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
