export const ALLOWED_EXTERNAL_HOSTS = new Set([
  "developers.openai.com",
  "www.electronjs.org"
]);

export interface SecureWindowOptions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  show: boolean;
  backgroundColor: string;
  webPreferences: {
    preload: string;
    nodeIntegration: false;
    contextIsolation: true;
    sandbox: true;
    webviewTag: false;
    allowRunningInsecureContent: false;
  };
}

export function resolveRendererUrl(options: {
  configuredUrl?: string;
  development: boolean;
  developmentUrl: string;
  packagedUrl: string;
}): string {
  return options.configuredUrl ?? (
    options.development ? options.developmentUrl : options.packagedUrl
  );
}

export function createWindowOptions(preload: string): SecureWindowOptions {
  return {
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: "#0f0f12",
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      allowRunningInsecureContent: false
    }
  };
}

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_EXTERNAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

interface FrameLike {
  url: string;
}

interface WebContentsLike {
  mainFrame: FrameLike;
}

interface IpcEventLike {
  sender: unknown;
  senderFrame: unknown;
}

export function isTrustedIpcSender(
  event: IpcEventLike,
  webContents: WebContentsLike,
  rendererUrl: string
): boolean {
  return event.sender === webContents &&
    event.senderFrame === webContents.mainFrame &&
    rendererDocumentUrl(webContents.mainFrame.url) === rendererDocumentUrl(rendererUrl);
}

function rendererDocumentUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return value.split("#", 1)[0] ?? value;
  }
}

interface PreventableEvent {
  preventDefault(): void;
}

interface SecureWebContents {
  on(event: "will-navigate", listener: (event: PreventableEvent, url: string) => void): unknown;
  on(event: "will-attach-webview", listener: (event: PreventableEvent) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): unknown;
  session: {
    setPermissionRequestHandler(handler: (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void
    ) => void): unknown;
    webRequest: {
      onHeadersReceived(handler: (
        details: { responseHeaders?: Record<string, string[]> },
        callback: (response: { responseHeaders: Record<string, string[]> }) => void
      ) => void): unknown;
    };
  };
}

interface ExternalShell {
  openExternal(url: string): Promise<unknown>;
}

function contentSecurityPolicy(rendererUrl: string): string {
  const development = isLocalDevelopmentRenderer(rendererUrl);
  const developmentConnections = development ? localDevelopmentConnections(rendererUrl) : [];
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    development ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    development ? "worker-src 'self' blob:" : "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    [
      "connect-src 'self'",
      "http://127.0.0.1:*",
      "ws://127.0.0.1:*",
      ...developmentConnections,
    ].join(" ")
  ].join("; ");
}

function localDevelopmentConnections(rendererUrl: string): string[] {
  const origin = new URL(rendererUrl).origin;
  return [origin, origin.replace(/^http:/, "ws:")];
}

function isLocalDevelopmentRenderer(rendererUrl: string): boolean {
  try {
    const url = new URL(rendererUrl);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

export function installWindowSecurity(
  webContents: SecureWebContents,
  shell: ExternalShell,
  rendererUrl: string
): void {
  webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl) event.preventDefault();
  });
  webContents.on("will-attach-webview", (event) => event.preventDefault());
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });
  webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy(rendererUrl)]
      }
    });
  });
}
