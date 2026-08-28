import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, type ElectronApplication, type Page } from "@playwright/test";
import { _electron as electron } from "playwright";

import { createTempDir } from "../../../../../test/helpers/temp-dir.js";

const packagedBundleName = "Oh My Bug";
const packagedExecutableName = "Oh My Bug";

export interface DesktopHarness {
  app: ElectronApplication;
  page: Page;
  dataRoot: string;
  chooseProjectDirectory(path: string | undefined): Promise<void>;
}

export interface LaunchDesktopOptions {
  dataRoot: string;
  delayMs?: number;
  unavailableOnce?: boolean;
}

export const test = base.extend<{ desktop: DesktopHarness }>({
  // Playwright requires an object destructuring pattern even when this fixture has no dependencies.
  // oxlint-disable-next-line no-empty-pattern
  desktop: async ({}, provide) => {
    const temporary = await createTempDir("oh-my-bug-electron-e2e-");
    const desktop = await launchPackagedDesktop({ dataRoot: temporary.path });
    try {
      await provide(desktop);
    } finally {
      await desktop.app.close().catch(() => undefined);
      await temporary.cleanup();
    }
  }
});

export { expect } from "@playwright/test";

export function packagedExecutable(): string {
  if (process.platform === "darwin") {
    return resolve("out", `${packagedBundleName}-darwin-${process.arch}`, `${packagedBundleName}.app`, "Contents", "MacOS", packagedExecutableName);
  }
  if (process.platform === "win32") {
    return resolve("out", `${packagedBundleName}-win32-${process.arch}`, `${packagedExecutableName}.exe`);
  }
  return resolve("out", `${packagedBundleName}-linux-${process.arch}`, packagedExecutableName);
}

export async function launchPackagedDesktop(options: LaunchDesktopOptions): Promise<DesktopHarness> {
  const executablePath = packagedExecutable();
  const agentToken = randomUUID();
  await access(executablePath);
  const application = await electron.launch({
    executablePath,
    args: [
      "-r", playwrightElectronLoader(),
      `--user-data-dir=${resolve(options.dataRoot, `electron-profile-${randomUUID()}`)}`,
      `--oh-my-bug-e2e-demo-agent=${agentToken}`,
    ],
    env: stringEnvironment({
      ...process.env,
      OH_MY_BUG_HOME: options.dataRoot,
      OH_MY_BUG_E2E_DEMO_AGENT_TOKEN: agentToken,
      ...(options.delayMs ? { OH_MY_BUG_E2E_DEMO_AGENT_DELAY_MS: String(options.delayMs) } : {}),
      ...(options.unavailableOnce ? { OH_MY_BUG_E2E_DEMO_AGENT_UNAVAILABLE_ONCE: "true" } : {}),
    }),
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  try {
    await page.locator(".app-shell").waitFor({ state: "attached", timeout: 5_000 });
  } catch {
    const diagnostic = await page.evaluate(() => ({
      url: location.href,
      bridge: typeof window.ohMyBug,
      root: document.querySelector("#root")?.innerHTML ?? "missing",
      scripts: [...document.scripts].map((script) => script.src),
    }));
    throw new Error(`DESKTOP_RENDERER_NOT_READY:${JSON.stringify(diagnostic)}`);
  }
  return {
    app: application,
    page,
    dataRoot: options.dataRoot,
    chooseProjectDirectory: async (path) => {
      await application.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: selectedPath === null,
          filePaths: selectedPath === null ? [] : [selectedPath],
          bookmarks: [],
        });
      }, path ?? null);
    },
  };
}

function playwrightElectronLoader(): string {
  const playwrightEntry = fileURLToPath(import.meta.resolve("playwright"));
  return resolve(dirname(playwrightEntry), "..", "playwright-core", "lib", "server", "electron", "loader.js");
}

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}
