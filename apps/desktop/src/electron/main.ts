import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  utilityProcess,
  type NativeImage,
  type UtilityProcess
} from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { registerDesktopIpc } from "./main-ipc.js";
import {
  RUNTIME_STATE_CHANNEL,
  TRAY_NAVIGATION_CHANNEL,
  type TrayNavigationTarget,
} from "./desktop-api.js";
import { buildUtilityProcessEnvironment } from "./e2e-agent-handshake.js";
import { installTrayMenuEvents, TrayMenuController } from "./tray-menu-controller.js";
import type { TrayTaskIndicator } from "./tray-task-model.js";
import { TrayNavigationQueue } from "./tray-navigation.js";
import { UtilitySupervisor, type UtilityRuntimeState } from "./utility-supervisor.js";
import { installWindowLifecycle } from "./window-lifecycle.js";
import { createWindowOptions, installWindowSecurity, resolveRendererUrl } from "./window-security.js";

app.setName("Oh My Bug");

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let supervisor: UtilitySupervisor | undefined;
let ipcRegistration: { dispose(): void } | undefined;
let quitting = false;
let shutdownComplete = false;
let runtimeState: UtilityRuntimeState = "starting";
const trayNavigation = new TrayNavigationQueue((target) => {
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    window.webContents.send(TRAY_NAVIGATION_CHANNEL, target);
  }
});
const trayStatusIconNames: Record<TrayTaskIndicator, string> = {
  failure: "tray-status-failure.png",
  review: "tray-status-review.png",
  processing: "tray-status-processing.png",
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
  app.on("activate", () => showMainWindow());
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    void quitApplication();
  });
  void app.whenReady()
    .then(() => startDesktop())
    .catch((error) => {
      process.stderr.write(`DESKTOP_START_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    });
}

async function startDesktop(): Promise<void> {
  const utilityPath = fileURLToPath(
    new URL("../../../../node_modules/@oh-my-bug/runtime/src/entry.js", import.meta.url)
  );
  const dataRoot = process.env.OH_MY_BUG_HOME ?? join(homedir(), ".oh-my-bug");
  const playwrightBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (app.isPackaged ? process.resourcesPath : undefined);
  supervisor = new UtilitySupervisor({
    spawn: () => {
      const child = utilityProcess.fork(utilityPath, [], {
        env: stringEnvironment(buildUtilityProcessEnvironment(process.argv, process.env, {
          OH_MY_BUG_HOME: dataRoot,
          PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath
        })),
        serviceName: "Oh My Bug Agent Core",
        stdio: "pipe"
      }) as UtilityProcess;
      child.stdout?.on("data", (chunk) => process.stdout.write(`[agent-core] ${String(chunk)}`));
      child.stderr?.on("data", (chunk) => process.stderr.write(`[agent-core] ${String(chunk)}`));
      return child;
    },
    restartLimit: 1,
    startupTimeoutMs: 15_000,
    onState: (state) => {
      runtimeState = state;
      const window = mainWindow;
      if (window && !window.isDestroyed()) window.webContents.send(RUNTIME_STATE_CHANNEL, state);
    }
  });
  await supervisor.start().catch(() => undefined);
  createMainWindow();
  createTray();
}

function createMainWindow(): void {
  trayNavigation.setReady(false);
  const preloadPath = fileURLToPath(new URL("./preload.cjs", import.meta.url));
  const rendererUrl = resolveRendererUrl({
    configuredUrl: process.env.OMB_RENDERER_URL,
    development: process.env.OMB_VITE_DEV === "1",
    developmentUrl: "http://127.0.0.1:5173",
    packagedUrl: pathToFileURL(
      fileURLToPath(new URL("../../../../../renderer/index.html", import.meta.url))
    ).href,
  });
  const window = new BrowserWindow(createWindowOptions(preloadPath));
  mainWindow = window;
  installWindowLifecycle(window, () => quitting);
  installWindowSecurity(
    window.webContents as unknown as Parameters<typeof installWindowSecurity>[0],
    shell,
    rendererUrl
  );
  ipcRegistration?.dispose();
  ipcRegistration = registerDesktopIpc({
    ipcMain: ipcMain as unknown as Parameters<typeof registerDesktopIpc>[0]["ipcMain"],
    window: window as unknown as Parameters<typeof registerDesktopIpc>[0]["window"],
    dialog: dialog as unknown as Parameters<typeof registerDesktopIpc>[0]["dialog"],
    getClient: () => supervisor!.client(),
    rendererUrl
  });
  window.webContents.once("did-finish-load", () => {
    window.webContents.send(RUNTIME_STATE_CHANNEL, runtimeState);
    trayNavigation.setReady(true);
  });
  void window.loadURL(rendererUrl);
}

function createTray(): void {
  if (tray) return;
  const image = nativeImage.createFromPath(fileURLToPath(
    new URL("../../assets/icons/oh-my-bug-trayTemplate.png", import.meta.url),
  ));
  if (image.isEmpty()) throw new Error("TRAY_ICON_MISSING");
  image.setTemplateImage(true);
  const currentTray = new Tray(image);
  tray = currentTray;
  currentTray.setToolTip("Oh My Bug");
  const taskIcons = loadTrayStatusIcons();
  const menu = new TrayMenuController({
    loadIssues: () => supervisor!.client().request("listIssues", {}),
    resolveTaskIcon: (indicator) => taskIcons[indicator],
    buildMenu: (template) => Menu.buildFromTemplate(template),
    popUp: (nativeMenu) => currentTray.popUpContextMenu(nativeMenu),
    openIssue: (issueId) => openIssues({ issueId }),
    openAll: () => openIssues({}),
    quit: () => { void quitApplication(); },
  });
  installTrayMenuEvents(currentTray, menu);
}

function loadTrayStatusIcons(): Partial<Record<TrayTaskIndicator, NativeImage>> {
  const icons: Partial<Record<TrayTaskIndicator, NativeImage>> = {};
  for (const indicator of Object.keys(trayStatusIconNames) as TrayTaskIndicator[]) {
    const image = nativeImage.createFromPath(fileURLToPath(
      new URL(`../../assets/icons/${trayStatusIconNames[indicator]}`, import.meta.url),
    ));
    if (!image.isEmpty()) icons[indicator] = image;
  }
  return icons;
}

function openIssues(target: TrayNavigationTarget): void {
  showMainWindow();
  trayNavigation.request(target);
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) createMainWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

async function quitApplication(): Promise<void> {
  if (quitting) return;
  quitting = true;
  ipcRegistration?.dispose();
  ipcRegistration = undefined;
  await supervisor?.shutdown();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  tray?.destroy();
  tray = undefined;
  shutdownComplete = true;
  app.quit();
}

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}
