import { describe, expect, it, vi } from "vitest";

import {
  DESKTOP_REQUEST_CHANNEL,
  ISSUE_EVENT_CHANNEL,
  OPEN_AGENT_TERMINAL_CHANNEL,
  OPEN_PROJECT_DIRECTORY_CHANNEL,
  SUBSCRIBE_ISSUE_CHANNEL,
  UNSUBSCRIBE_ISSUE_CHANNEL
} from "../../src/electron/desktop-api.js";
import { registerDesktopIpc } from "../../src/electron/main-ipc.js";

function setup() {
  const handlers = new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (event: unknown, input?: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel))
  };
  const mainFrame = { url: "file:///app/renderer/index.html" };
  const webContents = { mainFrame, send: vi.fn(), once: vi.fn() };
  const window = { webContents };
  const request = vi.fn(async (operation: string, payload: unknown): Promise<unknown> => ({
    operation,
    payload,
  }));
  const unsubscribe = vi.fn();
  const subscribeIssue = vi.fn((_issueId: string, _cursor: number, listener: (event: unknown) => void) => {
    listener({
      issueId: "issue-1",
      cursor: 2,
      events: [{
        id: "event-2",
        issueId: "issue-1",
        sequence: 2,
        type: "ASSESSMENT_READY",
        actor: "AGENT",
        data: {},
        occurredAt: "2026-08-21T00:00:00.000Z"
      }]
    });
    return unsubscribe;
  });
  const client = { request, subscribeIssue };
  const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })) };
  const launchAgentTerminal = vi.fn(async () => ({ opened: true as const }));
  const registration = registerDesktopIpc({
    ipcMain,
    window,
    dialog,
    getClient: () => client,
    launchAgentTerminal,
    rendererUrl: mainFrame.url
  });
  const event = { sender: webContents, senderFrame: mainFrame };
  return {
    handlers,
    ipcMain,
    webContents,
    request,
    subscribeIssue,
    unsubscribe,
    dialog,
    launchAgentTerminal,
    registration,
    event,
  };
}

describe("Electron main IPC", () => {
  it("resolves and launches a private target only after sender and Issue validation", async () => {
    const fixture = setup();
    const handle = fixture.handlers.get(OPEN_AGENT_TERMINAL_CHANNEL)!;
    const target = {
      agent: "codex",
      providerThreadId: "0198e8dc-6de0-7c10-81ce-6c6544bc1bf7",
      executablePath: "/bin/codex",
      remoteUrl: "unix:///private/run/codex-app-server.sock",
      workingDirectory: "/repo/worktree",
    };
    fixture.request.mockResolvedValueOnce(target);

    await expect(handle(fixture.event, { issueId: "issue-1" })).resolves
      .toEqual({ opened: true });
    expect(fixture.request).toHaveBeenCalledWith(
      "resolveAgentTerminalLaunchTarget",
      { id: "issue-1" },
    );
    expect(fixture.launchAgentTerminal).toHaveBeenCalledWith(target);

    await expect(handle({ sender: {}, senderFrame: {} }, { issueId: "issue-1" }))
      .rejects.toThrow("IPC_SENDER_UNTRUSTED");
    await expect(handle(fixture.event, {
      issueId: "issue-1",
      remoteUrl: "unix:///renderer-controlled",
    })).rejects.toThrow("INVALID_REQUEST");
    expect(fixture.request).toHaveBeenCalledTimes(1);

    fixture.registration.dispose();
    expect(fixture.ipcMain.removeHandler).toHaveBeenCalledWith(OPEN_AGENT_TERMINAL_CHANNEL);
  });

  it("authorizes the sender and forwards only validated product operations", async () => {
    const fixture = setup();
    const handle = fixture.handlers.get(DESKTOP_REQUEST_CHANNEL)!;

    await expect(handle(fixture.event, { operation: "listProjects", payload: {} })).resolves.toEqual({
      operation: "listProjects",
      payload: {}
    });
    await expect(handle(fixture.event, { operation: "shutdown", payload: {} })).rejects.toThrow("IPC_OPERATION_DENIED");
    await expect(handle({ sender: {}, senderFrame: {} }, { operation: "listProjects", payload: {} }))
      .rejects.toThrow("IPC_SENDER_UNTRUSTED");
  });

  it("opens a parented directory-only dialog and inspects only a selected path", async () => {
    const fixture = setup();
    const handle = fixture.handlers.get(OPEN_PROJECT_DIRECTORY_CHANNEL)!;

    await expect(handle(fixture.event)).resolves.toEqual({ canceled: true });
    expect(fixture.request).not.toHaveBeenCalled();

    fixture.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/work/checkout"] });
    await expect(handle(fixture.event)).resolves.toEqual({
      canceled: false,
      inspection: { operation: "inspectProject", payload: { path: "/work/checkout" } }
    });
    expect(fixture.dialog.showOpenDialog).toHaveBeenLastCalledWith(
      expect.anything(),
      { properties: ["openDirectory"] }
    );
  });

  it("owns Issue subscriptions and relays envelopes to the requesting renderer", async () => {
    const fixture = setup();
    const subscribe = fixture.handlers.get(SUBSCRIBE_ISSUE_CHANNEL)!;
    const unsubscribe = fixture.handlers.get(UNSUBSCRIBE_ISSUE_CHANNEL)!;

    await subscribe(fixture.event, { subscriptionId: "renderer-1", issueId: "issue-1", cursor: 1 });
    expect(fixture.subscribeIssue).toHaveBeenCalledWith("issue-1", 1, expect.any(Function));
    expect(fixture.webContents.send).toHaveBeenCalledWith(ISSUE_EVENT_CHANNEL, {
      subscriptionId: "renderer-1",
      issueId: "issue-1",
      cursor: 2,
      events: [expect.objectContaining({ sequence: 2 })]
    });

    await unsubscribe(fixture.event, { subscriptionId: "renderer-1" });
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    fixture.registration.dispose();
  });
});
