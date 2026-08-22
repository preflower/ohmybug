import { z, type ZodType } from "zod";

import { runtimeOperations } from "./operations.js";
import { issueEventSchema, messageIdSchema } from "./schema-definitions.js";
import type {
  RuntimeOperation,
  RuntimeOperationInput,
} from "./types.js";

const operationRequestSchemas = Object.entries(runtimeOperations).map(([name, definition]) =>
  z.object({
    kind: z.literal("request"),
    id: messageIdSchema,
    operation: z.literal(name),
    payload: definition.input,
  }).strict());

const operationRequestSchema = z.union(operationRequestSchemas as unknown as [
  ZodType,
  ZodType,
  ...ZodType[],
]);
const cancelRequestSchema = z.object({
  kind: z.literal("cancel"),
  id: messageIdSchema,
}).strict();
const subscribeRequestSchema = z.object({
  kind: z.literal("subscribe"),
  subscriptionId: messageIdSchema,
  issueId: z.string().trim().min(1),
  cursor: z.number().int().nonnegative(),
}).strict();
const unsubscribeRequestSchema = z.object({
  kind: z.literal("unsubscribe"),
  subscriptionId: messageIdSchema,
}).strict();

export type UtilityOperationRequest = {
  [Name in RuntimeOperation]: {
    kind: "request";
    id: string;
    operation: Name;
    payload: RuntimeOperationInput<Name>;
  };
}[RuntimeOperation];

export type UtilityRequest = UtilityOperationRequest |
  { kind: "cancel"; id: string } |
  { kind: "subscribe"; subscriptionId: string; issueId: string; cursor: number } |
  { kind: "unsubscribe"; subscriptionId: string };

export const utilityRequestSchema = z.union([
  operationRequestSchema,
  cancelRequestSchema,
  subscribeRequestSchema,
  unsubscribeRequestSchema,
]) as unknown as ZodType<UtilityRequest>;

export type UtilityResponse =
  | { kind: "ready" }
  | { kind: "response"; id: string; ok: true; value: unknown }
  | { kind: "response"; id: string; ok: false; error: { code: string; message: string } }
  | {
      kind: "event";
      subscriptionId: string;
      issueId: string;
      cursor: number;
      events: Array<z.infer<typeof issueEventSchema>>;
    }
  | { kind: "runtime-error"; message: string };

export const utilityResponseSchema = z.union([
  z.object({ kind: z.literal("ready") }).strict(),
  z.object({
    kind: z.literal("response"),
    id: messageIdSchema,
    ok: z.literal(true),
    value: z.unknown(),
  }).strict(),
  z.object({
    kind: z.literal("response"),
    id: messageIdSchema,
    ok: z.literal(false),
    error: z.object({
      code: z.string().min(1),
      message: z.string().min(1),
    }).strict(),
  }).strict(),
  z.object({
    kind: z.literal("event"),
    subscriptionId: messageIdSchema,
    issueId: z.string().trim().min(1),
    cursor: z.number().int().nonnegative(),
    events: z.array(issueEventSchema),
  }).strict(),
  z.object({
    kind: z.literal("runtime-error"),
    message: z.string().min(1),
  }).strict(),
]) as unknown as ZodType<UtilityResponse>;

export * from "./schema-definitions.js";
