import { z } from "zod";

export type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue;
};

export type JsonRpcId = number;
export type JsonRpcRequest = { id: JsonRpcId; method: string; params: unknown };
export type JsonRpcResponse =
  | { id: JsonRpcId; result: unknown }
  | { id: JsonRpcId; error: { code: number; message: string; data?: unknown } };
export type JsonRpcNotification = { method: string; params: unknown };

export type UnixAppServerEndpoint = Readonly<{
  transport: "unix";
  socketPath: string;
  remoteUrl: string;
}>;

export interface InitializeParams {
  clientInfo: { name: string; title: string; version: string };
  capabilities: null;
}

export type InitializeResponse = Record<string, unknown>;

export interface ThreadStartParams {
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: "never" | null;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access" | null;
  config?: Record<string, JsonValue> | null;
  experimentalRawEvents?: boolean;
}

export interface ThreadResumeParams extends ThreadStartParams { threadId: string }
export interface ThreadReadParams { threadId: string; includeTurns: boolean }
export interface ThreadResponse { thread: { id: string; [key: string]: unknown } }

export interface UserInputText { type: "text"; text: string; text_elements: never[] }
export interface TurnStartParams {
  threadId: string;
  input: UserInputText[];
  cwd?: string | null;
  approvalPolicy?: "never" | null;
  sandboxPolicy?: Record<string, JsonValue> | null;
  model?: string | null;
  outputSchema?: JsonValue | null;
}
export interface TurnResponse { turn: { id: string; [key: string]: unknown } }
export interface TurnSteerParams {
  threadId: string;
  turnId: string;
  input: UserInputText[];
}
export interface TurnInterruptParams { threadId: string; turnId: string }

export interface AppServerMethods {
  initialize: { input: InitializeParams; output: InitializeResponse };
  "thread/start": { input: ThreadStartParams; output: ThreadResponse };
  "thread/resume": { input: ThreadResumeParams; output: ThreadResponse };
  "thread/read": { input: ThreadReadParams; output: ThreadResponse };
  "turn/start": { input: TurnStartParams; output: TurnResponse };
  "turn/steer": { input: TurnSteerParams; output: TurnResponse };
  "turn/interrupt": { input: TurnInterruptParams; output: Record<string, unknown> };
}

const rpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
}).strict();

const rpcEnvelopeSchema = z.union([
  z.object({ id: z.number().int(), result: z.unknown() }).strict(),
  z.object({ id: z.number().int(), error: rpcErrorSchema }).strict(),
  z.object({ id: z.number().int(), method: z.string(), params: z.unknown() }).strict(),
  z.object({ method: z.string(), params: z.unknown() }).strict(),
]);

const recordSchema = z.record(z.string(), z.unknown());
const threadResponseSchema = z.object({
  thread: z.object({ id: z.string().min(1) }).passthrough(),
}).passthrough();
const turnResponseSchema = z.object({
  turn: z.object({ id: z.string().min(1) }).passthrough(),
}).passthrough();

export function parseRpcEnvelope(value: unknown): JsonRpcResponse | JsonRpcRequest | JsonRpcNotification {
  return rpcEnvelopeSchema.parse(value);
}

export function parseMethodResult<Name extends keyof AppServerMethods>(
  method: Name,
  value: unknown,
): AppServerMethods[Name]["output"] {
  const schema = method === "initialize" || method === "turn/interrupt"
    ? recordSchema
    : method.startsWith("thread/")
      ? threadResponseSchema
      : turnResponseSchema;
  return schema.parse(value) as AppServerMethods[Name]["output"];
}
