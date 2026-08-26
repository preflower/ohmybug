declare module "ws" {
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";
  import { EventEmitter } from "node:events";

  export interface RawData { toString(): string }
  export interface ClientOptions {
    createConnection?: () => Duplex;
    perMessageDeflate?: boolean;
  }

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;
    constructor(address: string, options?: ClientOptions);
    send(data: string): void;
    close(): void;
    terminate(): void;
    on(event: "open" | "close", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "message", listener: (data: RawData) => void): this;
    once(event: "open" | "close", listener: () => void): this;
    once(event: "error", listener: (error: Error) => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    readonly clients: Set<WebSocket>;
    constructor(options: { noServer: true });
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (socket: WebSocket) => void,
    ): void;
    close(): void;
  }

  export default WebSocket;
}
