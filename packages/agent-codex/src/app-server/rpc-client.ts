// oxlint-disable-next-line typescript/triple-slash-reference -- consuming workspace projects need this ambient ws declaration.
/// <reference path="../ws.d.ts" />

import { connect as connectSocket } from "node:net";

import WebSocket from "ws";

import {
  parseMethodResult,
  parseRpcEnvelope,
  type AppServerMethods,
  type JsonRpcNotification,
  type JsonRpcResponse,
  type UnixAppServerEndpoint,
} from "./protocol.js";

export interface RpcClientOptions {
  clientName?: string;
  clientTitle?: string;
  clientVersion?: string;
}

interface PendingRequest {
  method: keyof AppServerMethods;
  resolve(value: unknown): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class AppServerRpcClient {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationQueue = new AsyncQueue<JsonRpcNotification>();
  private readonly clientName: string;
  private readonly clientTitle: string;
  private readonly clientVersion: string;
  private nextId = 0;
  private initialized = false;
  private initializeTask?: Promise<void>;
  private disconnected = false;

  private constructor(
    private readonly socket: WebSocket,
    options: RpcClientOptions,
  ) {
    this.clientName = options.clientName ?? "oh-my-bug";
    this.clientTitle = options.clientTitle ?? "Oh My Bug";
    this.clientVersion = options.clientVersion ?? "0.1.0";
    socket.on("message", (data) => this.handleMessage(data.toString()));
    socket.on("close", () => this.disconnect());
    socket.on("error", () => this.disconnect());
  }

  static async connect(
    endpoint: UnixAppServerEndpoint,
    options: RpcClientOptions = {},
  ): Promise<AppServerRpcClient> {
    if (
      endpoint.transport !== "unix" ||
      !endpoint.socketPath.startsWith("/") ||
      endpoint.remoteUrl !== `unix://${endpoint.socketPath}`
    ) throw new Error("CODEX_APP_SERVER_ENDPOINT_INVALID");
    const socket = new WebSocket("ws://localhost", {
      perMessageDeflate: false,
      createConnection: () => connectSocket(endpoint.socketPath),
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new AppServerRpcClient(socket, options);
  }

  initialize(): Promise<void> {
    this.initializeTask ??= (async () => {
      await this.request("initialize", {
        clientInfo: {
          name: this.clientName,
          title: this.clientTitle,
          version: this.clientVersion,
        },
        capabilities: null,
      });
      this.send({ method: "initialized", params: {} });
      this.initialized = true;
    })();
    return this.initializeTask;
  }

  request<Name extends keyof AppServerMethods>(
    method: Name,
    params: AppServerMethods[Name]["input"],
    options: { signal?: AbortSignal } = {},
  ): Promise<AppServerMethods[Name]["output"]> {
    if (method !== "initialize" && !this.initialized) {
      return Promise.reject(new Error("CODEX_APP_SERVER_NOT_INITIALIZED"));
    }
    if (this.disconnected) return Promise.reject(new Error("CODEX_APP_SERVER_DISCONNECTED"));
    if (options.signal?.aborted) return Promise.reject(canceledError(options.signal.reason));
    const id = ++this.nextId;
    return new Promise<AppServerMethods[Name]["output"]>((resolve, reject) => {
      const pending: PendingRequest = {
        method,
        resolve: (value) => resolve(value as AppServerMethods[Name]["output"]),
        reject,
        signal: options.signal,
      };
      if (options.signal) {
        pending.onAbort = () => this.settle(id, canceledError(options.signal?.reason));
        options.signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      this.pending.set(id, pending);
      try {
        this.send({ id, method, params });
      } catch (error) {
        this.settle(id, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notifications(): AsyncIterable<JsonRpcNotification> {
    return this.notificationQueue;
  }

  async close(): Promise<void> {
    if (this.disconnected) return;
    await new Promise<void>((resolve) => {
      this.socket.once("close", resolve);
      this.socket.close();
    });
  }

  private handleMessage(serialized: string): void {
    let envelope;
    try {
      envelope = parseRpcEnvelope(JSON.parse(serialized));
    } catch (error) {
      this.disconnect(new Error("CODEX_PROTOCOL_INVALID_MESSAGE", { cause: error }));
      return;
    }
    if ("id" in envelope && "method" in envelope) {
      this.send({
        id: envelope.id,
        error: { code: -32601, message: "Method not supported by Oh My Bug" },
      });
      return;
    }
    if ("id" in envelope) {
      this.handleResponse(envelope);
      return;
    }
    this.notificationQueue.push(envelope);
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if ("error" in response) {
      this.settle(
        response.id,
        new Error(`CODEX_APP_SERVER_RPC_ERROR:${response.error.code}:${response.error.message}`),
      );
      return;
    }
    try {
      this.settle(response.id, undefined, parseMethodResult(pending.method, response.result));
    } catch (error) {
      this.settle(response.id, new Error("CODEX_PROTOCOL_INVALID_MESSAGE", { cause: error }));
    }
  }

  private send(value: unknown): void {
    if (this.disconnected || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("CODEX_APP_SERVER_DISCONNECTED");
    }
    this.socket.send(JSON.stringify(value));
  }

  private disconnect(error: Error = new Error("CODEX_APP_SERVER_DISCONNECTED")): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const id of [...this.pending.keys()]) this.settle(id, error);
    this.notificationQueue.close();
  }

  private settle(id: number, error?: Error, value?: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    if (error) pending.reject(error);
    else pending.resolve(value);
  }
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.closed) return { done: true, value: undefined };
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

function canceledError(reason: unknown): Error {
  return new Error("RUN_CANCELED", { cause: reason });
}
