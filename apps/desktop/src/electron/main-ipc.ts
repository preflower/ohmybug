import {
  rendererOperationNames,
  utilityRequestSchema,
  type IssueEventEnvelope,
  type RuntimeOperation,
} from "@oh-my-bug/runtime/protocol";

import {
  DESKTOP_REQUEST_CHANNEL,
  ISSUE_EVENT_CHANNEL,
  OPEN_PROJECT_DIRECTORY_CHANNEL,
  SUBSCRIBE_ISSUE_CHANNEL,
  UNSUBSCRIBE_ISSUE_CHANNEL,
} from "./desktop-api.js";
import { isTrustedIpcSender } from "./window-security.js";

interface IpcMainLike {
  handle(channel: string, handler: (event: IpcEventLike, input?: unknown) => Promise<unknown>): unknown;
  removeHandler(channel: string): unknown;
}

interface IpcEventLike {
  sender: WebContentsLike;
  senderFrame: unknown;
}

interface WebContentsLike {
  mainFrame: { url: string };
  send(channel: string, value: unknown): void;
  once?(event: string, listener: () => void): unknown;
  isDestroyed?(): boolean;
}

interface WindowLike { webContents: WebContentsLike }

interface DialogLike {
  showOpenDialog(
    window: WindowLike,
    options: { properties: ["openDirectory"] },
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
}

interface DesktopUtilityClient {
  request(operation: RuntimeOperation, payload: never): Promise<unknown>;
  subscribeIssue(
    issueId: string,
    cursor: number,
    listener: (event: IssueEventEnvelope) => void,
  ): () => void;
}

interface DesktopIpcDependencies {
  ipcMain: IpcMainLike;
  window: WindowLike;
  dialog: DialogLike;
  getClient: () => DesktopUtilityClient;
  rendererUrl: string;
}

export function registerDesktopIpc(dependencies: DesktopIpcDependencies): { dispose(): void } {
  const { ipcMain, window, dialog, getClient, rendererUrl } = dependencies;
  const subscriptions = new Map<string, () => void>();
  const authorize = (event: IpcEventLike) => {
    if (!isTrustedIpcSender(event, window.webContents, rendererUrl)) {
      throw new Error("IPC_SENDER_UNTRUSTED");
    }
  };

  ipcMain.handle(DESKTOP_REQUEST_CHANNEL, async (event, input) => {
    authorize(event);
    if (!input || typeof input !== "object") throw new Error("INVALID_REQUEST");
    const candidate = input as { operation?: unknown; payload?: unknown };
    const parsed = utilityRequestSchema.parse({
      kind: "request",
      id: "renderer-validation",
      operation: candidate.operation,
      payload: candidate.payload,
    });
    if (parsed.kind !== "request" || !rendererOperationNames.includes(parsed.operation)) {
      throw new Error("IPC_OPERATION_DENIED");
    }
    return getClient().request(parsed.operation, parsed.payload as never);
  });

  ipcMain.handle(OPEN_PROJECT_DIRECTORY_CHANNEL, async (event) => {
    authorize(event);
    const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
    const path = result.filePaths[0];
    if (result.canceled || !path) return { canceled: true };
    const inspection = await getClient().request("inspectProject", { path } as never);
    return { canceled: false, inspection };
  });

  ipcMain.handle(SUBSCRIBE_ISSUE_CHANNEL, async (event, input) => {
    authorize(event);
    const message = utilityRequestSchema.parse({ kind: "subscribe", ...(input as object) });
    if (message.kind !== "subscribe") throw new Error("INVALID_REQUEST");
    subscriptions.get(message.subscriptionId)?.();
    const unsubscribe = getClient().subscribeIssue(message.issueId, message.cursor, (envelope) => {
      if (window.webContents.isDestroyed?.()) return;
      window.webContents.send(ISSUE_EVENT_CHANNEL, { subscriptionId: message.subscriptionId, ...envelope });
    });
    subscriptions.set(message.subscriptionId, unsubscribe);
    return { subscriptionId: message.subscriptionId };
  });

  ipcMain.handle(UNSUBSCRIBE_ISSUE_CHANNEL, async (event, input) => {
    authorize(event);
    const message = utilityRequestSchema.parse({ kind: "unsubscribe", ...(input as object) });
    if (message.kind !== "unsubscribe") throw new Error("INVALID_REQUEST");
    subscriptions.get(message.subscriptionId)?.();
    subscriptions.delete(message.subscriptionId);
    return null;
  });

  const dispose = () => {
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
    ipcMain.removeHandler(DESKTOP_REQUEST_CHANNEL);
    ipcMain.removeHandler(OPEN_PROJECT_DIRECTORY_CHANNEL);
    ipcMain.removeHandler(SUBSCRIBE_ISSUE_CHANNEL);
    ipcMain.removeHandler(UNSUBSCRIBE_ISSUE_CHANNEL);
  };
  window.webContents.once?.("render-process-gone", dispose);
  return { dispose };
}
