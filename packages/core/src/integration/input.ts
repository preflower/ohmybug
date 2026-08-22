import { z } from "zod";

import { dataSchema, type Data } from "./data.js";

export const integrationInputSchema = z
  .object({
    id: z.string().trim().min(1),
    integration: z.string().regex(/^[a-z][a-z0-9-]*$/),
    inputKey: z.string().trim().min(1),
    groupKey: z.string().trim().min(1).optional(),
    rawData: z.unknown(),
    data: dataSchema,
    receivedAt: z.iso.datetime(),
  })
  .strict();

export interface IntegrationInput<RawData = unknown> {
  id: string;
  integration: string;
  inputKey: string;
  groupKey?: string;
  rawData: RawData;
  data: Data;
  receivedAt: string;
}
