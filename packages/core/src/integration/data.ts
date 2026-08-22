import { z } from "zod";

export const dataSchema = z
  .object({
    content: z.string().trim().min(1),
    summary: z.string().trim().min(1).optional(),
    occurredAt: z.iso.datetime().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type Data = z.infer<typeof dataSchema>;
