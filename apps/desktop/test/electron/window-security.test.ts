import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import * as windowSecurity from "../../src/electron/window-security.js";

import {
  createWindowOptions,
  installWindowSecurity,
  isAllowedExternalUrl,
  isTrustedIpcSender
} from "../../src/electron/window-security.js";

describe("Electron window security", () => {
  it("loads the fixed Vite dev server in development and the packaged renderer otherwise", () => {
    const resolveRendererUrl = (
      windowSecurity as typeof windowSecurity & {
        resolveRendererUrl?: (options: {
          configuredUrl?: string;
          development: boolean;
          developmentUrl: string;
          packagedUrl: string;
        }) => string;
      }
    ).resolveRendererUrl;

    expect(resolveRendererUrl).toBeDefined();
    expect(resolveRendererUrl?.({
      development: true,
      developmentUrl: "http://127.0.0.1:5173",
      packagedUrl: "file:///app/renderer/index.html",
    })).toBe("http://127.0.0.1:5173");
    expect(resolveRendererUrl?.({
      configuredUrl: "http://127.0.0.1:9000",
      development: true,
      developmentUrl: "http://127.0.0.1:5173",
      packagedUrl: "file:///app/renderer/index.html",
    })).toBe("http://127.0.0.1:9000");
    expect(resolveRendererUrl?.({
      development: false,
      developmentUrl: "http://127.0.0.1:5173",
      packagedUrl: "file:///app/renderer/index.html",
    })).toBe("file:///app/renderer/index.html");
  });

  it("creates a context-isolated sandboxed renderer without Node authority", () => {
    expect(createWindowOptions("/app/preload.js")).toMatchObject({
      minWidth: 900,
      minHeight: 620,
      webPreferences: {
        preload: "/app/preload.js",
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
        allowRunningInsecureContent: false
      }
    });
  });

  it("allows only fixed HTTPS documentation hosts", () => {
    expect(isAllowedExternalUrl("https://developers.openai.com/codex/")).toBe(true);
    expect(isAllowedExternalUrl("https://www.electronjs.org/docs/latest/" )).toBe(true);
    expect(isAllowedExternalUrl("http://developers.openai.com/codex/")).toBe(false);
    expect(isAllowedExternalUrl("https://developers.openai.com.evil.example/codex/")).toBe(false);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
  });

  it("trusts only the main frame of the configured local renderer", () => {
    const mainFrame = { url: "file:///app/renderer/index.html" };
    const webContents = { mainFrame };
    const trusted = { sender: webContents, senderFrame: mainFrame };

    expect(isTrustedIpcSender(trusted, webContents, "file:///app/renderer/index.html")).toBe(true);
    mainFrame.url = "file:///app/renderer/index.html#/projects";
    expect(isTrustedIpcSender(trusted, webContents, "file:///app/renderer/index.html")).toBe(true);
    expect(isTrustedIpcSender({ ...trusted, senderFrame: { url: mainFrame.url } }, webContents, mainFrame.url)).toBe(false);
    expect(isTrustedIpcSender({ ...trusted, sender: {} }, webContents, mainFrame.url)).toBe(false);
    expect(isTrustedIpcSender(trusted, webContents, "file:///other/index.html")).toBe(false);
  });

  it("allows the Vite inline bootstrap only for the local development renderer", () => {
    const rendererCsp = (rendererUrl: string) => {
      const webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler: vi.fn(),
        session: {
          setPermissionRequestHandler: vi.fn(),
          webRequest: { onHeadersReceived: vi.fn() }
        }
      });
      installWindowSecurity(webContents, { openExternal: async () => undefined }, rendererUrl);
      const headersHandler = webContents.session.webRequest.onHeadersReceived.mock.calls[0]![0];
      const responses: Array<{ responseHeaders: Record<string, string[]> }> = [];
      headersHandler({ responseHeaders: {} }, (response: { responseHeaders: Record<string, string[]> }) => {
        responses.push(response);
      });
      return responses[0]!.responseHeaders["Content-Security-Policy"]![0]!;
    };

    expect(rendererCsp("http://127.0.0.1:5173")).toContain(
      "script-src 'self' 'unsafe-inline'"
    );
    expect(rendererCsp("http://localhost:5174")).toContain("ws://localhost:5174");
    expect(rendererCsp("http://localhost:5174")).toContain("worker-src 'self' blob:");
    expect(rendererCsp("file:///app/renderer/index.html")).toContain("script-src 'self'");
    expect(rendererCsp("file:///app/renderer/index.html")).not.toContain(
      "script-src 'self' 'unsafe-inline'"
    );
    expect(rendererCsp("file:///app/renderer/index.html")).not.toContain("ws://localhost:5174");
    expect(rendererCsp("file:///app/renderer/index.html")).not.toContain("worker-src 'self' blob:");
  });

  it("denies navigation, popups, permissions, and injects a restrictive CSP", async () => {
    const webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      session: {
        setPermissionRequestHandler: vi.fn(),
        webRequest: { onHeadersReceived: vi.fn() }
      }
    });
    const shell = { openExternal: vi.fn(async () => undefined) };
    installWindowSecurity(webContents, shell, "file:///app/renderer/index.html");

    const preventDefault = vi.fn();
    webContents.emit("will-navigate", { preventDefault }, "https://evil.example/");
    expect(preventDefault).toHaveBeenCalledOnce();

    const popupHandler = webContents.setWindowOpenHandler.mock.calls[0]![0];
    expect(popupHandler({ url: "https://developers.openai.com/codex/" })).toEqual({ action: "deny" });
    await Promise.resolve();
    expect(shell.openExternal).toHaveBeenCalledWith("https://developers.openai.com/codex/");

    const permissionHandler = webContents.session.setPermissionRequestHandler.mock.calls[0]![0];
    const permission = vi.fn();
    permissionHandler({}, "media", permission);
    expect(permission).toHaveBeenCalledWith(false);

    const headersHandler = webContents.session.webRequest.onHeadersReceived.mock.calls[0]![0];
    const callback = vi.fn();
    headersHandler({ responseHeaders: { Existing: ["value"] } }, callback);
    expect(callback).toHaveBeenCalledWith({
      responseHeaders: expect.objectContaining({
        Existing: ["value"],
        "Content-Security-Policy": [expect.stringContaining("default-src 'self'")]
      })
    });
  });
});
