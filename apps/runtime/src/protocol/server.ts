import { ZodError } from "zod";

import {
  runtimeOperations,
  type RuntimeOperationDefinition,
} from "./operations.js";
import {
  utilityRequestSchema,
  type UtilityOperationRequest,
} from "./schemas.js";
import type { RuntimeApi, RuntimeOperation } from "./types.js";

export interface RuntimeMessagePort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  off?(event: "message", listener: (message: unknown) => void): unknown;
}

export interface RuntimeServerOptions {
  pollMs?: number;
}

export interface RuntimeServer {
  close(): void;
}

interface Subscription {
  issueId: string;
  cursor: number;
}

export function createRuntimeServer(
  service: RuntimeApi,
  port: RuntimeMessagePort,
  options: RuntimeServerOptions = {},
): RuntimeServer {
  const subscriptions = new Map<string, Subscription>();
  const canceled = new Set<string>();
  let polling = false;
  let closed = false;

  const dispatch = async (request: UtilityOperationRequest): Promise<void> => {
    try {
      const definition = runtimeOperations[request.operation as RuntimeOperation] as
        RuntimeOperationDefinition;
      const input = definition.input.parse(request.payload);
      const rawOutput = await definition.invoke(service, input);
      let value: unknown;
      try {
        value = definition.output.parse(rawOutput);
      } catch (error) {
        throw new Error("INVALID_RESPONSE", { cause: error });
      }
      if (!canceled.delete(request.id) && !closed) {
        port.postMessage({ kind: "response", id: request.id, ok: true, value });
      }
    } catch (error) {
      if (!canceled.delete(request.id) && !closed) postError(port, request.id, error);
    }
  };

  const poll = async (): Promise<void> => {
    if (polling || closed) return;
    polling = true;
    try {
      for (const [subscriptionId, subscription] of subscriptions) {
        try {
          const page = await service.issueEvents({
            id: subscription.issueId,
            cursor: subscription.cursor,
          });
          if (page.items.length === 0 || closed || !subscriptions.has(subscriptionId)) continue;
          subscription.cursor = page.nextCursor;
          port.postMessage({
            kind: "event",
            subscriptionId,
            issueId: subscription.issueId,
            cursor: page.nextCursor,
            events: page.items,
          });
        } catch (error) {
          if (!closed) {
            port.postMessage({ kind: "runtime-error", message: publicMessage(error) });
          }
        }
      }
    } finally {
      polling = false;
    }
  };

  const onMessage = (rawMessage: unknown): void => {
    const parsed = utilityRequestSchema.safeParse(rawMessage);
    if (!parsed.success) {
      const id = requestId(rawMessage);
      if (id) postError(port, id, new Error("INVALID_REQUEST", { cause: parsed.error }));
      return;
    }
    const message = parsed.data;
    if (message.kind === "cancel") {
      canceled.add(message.id);
    } else if (message.kind === "subscribe") {
      subscriptions.set(message.subscriptionId, {
        issueId: message.issueId,
        cursor: message.cursor,
      });
      void poll();
    } else if (message.kind === "unsubscribe") {
      subscriptions.delete(message.subscriptionId);
    } else {
      void dispatch(message as UtilityOperationRequest);
    }
  };

  port.on("message", onMessage);
  const interval = setInterval(() => { void poll(); }, options.pollMs ?? 250);
  interval.unref?.();
  return {
    close() {
      if (closed) return;
      closed = true;
      clearInterval(interval);
      subscriptions.clear();
      canceled.clear();
      port.off?.("message", onMessage);
    },
  };
}

function postError(port: RuntimeMessagePort, id: string, error: unknown): void {
  const message = publicMessage(error);
  const code = error instanceof Error && error.message === "INVALID_RESPONSE"
    ? "INVALID_RESPONSE"
    : error instanceof ZodError || message === "INVALID_REQUEST"
      ? "INVALID_REQUEST"
      : message.split(":", 1)[0] || "INTERNAL_ERROR";
  port.postMessage({ kind: "response", id, ok: false, error: { code, message } });
}

function publicMessage(error: unknown): string {
  return error instanceof Error ? error.message : "INTERNAL_ERROR";
}

function requestId(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as { kind?: unknown; id?: unknown };
  return candidate.kind === "request" && typeof candidate.id === "string"
    ? candidate.id
    : undefined;
}
