import { access } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCodexBinary } from "@oh-my-bug/agent-codex";
import { chromium } from "playwright";

export const desktopBuildLayout = Object.freeze({
  main: ".vite/build/apps/desktop/src/electron/main.js",
  preload: ".vite/build/apps/desktop/src/electron/preload.cjs",
  renderer: ".vite/renderer/index.html",
  trayIcon: ".vite/build/apps/desktop/assets/icons/oh-my-bug-trayTemplate.png",
  trayIcon2x: ".vite/build/apps/desktop/assets/icons/oh-my-bug-trayTemplate@2x.png",
  trayStatusFailure: ".vite/build/apps/desktop/assets/icons/tray-status-failure.png",
  trayStatusFailure2x: ".vite/build/apps/desktop/assets/icons/tray-status-failure@2x.png",
  trayStatusReview: ".vite/build/apps/desktop/assets/icons/tray-status-review.png",
  trayStatusReview2x: ".vite/build/apps/desktop/assets/icons/tray-status-review@2x.png",
  trayStatusProcessing: ".vite/build/apps/desktop/assets/icons/tray-status-processing.png",
  trayStatusProcessing2x: ".vite/build/apps/desktop/assets/icons/tray-status-processing@2x.png",
  runtimeEntry: ".vite/build/node_modules/@oh-my-bug/runtime/src/entry.js",
  runtimeProtocol: ".vite/build/node_modules/@oh-my-bug/runtime/src/protocol/index.js",
  core: ".vite/build/node_modules/@oh-my-bug/core/src/index.js",
  agentCodex: ".vite/build/node_modules/@oh-my-bug/agent-codex/src/index.js",
  integrationManual: ".vite/build/node_modules/@oh-my-bug/integration-manual/src/index.js",
  integrationSentry: ".vite/build/node_modules/@oh-my-bug/integration-sentry/src/index.js",
  integrationDingTalk: ".vite/build/node_modules/@oh-my-bug/integration-dingtalk/src/index.js",
  storage: ".vite/build/node_modules/@oh-my-bug/storage/src/index.js",
  mediaProbe: ".vite/build/node_modules/@oh-my-bug/storage/src/evidence/media-probe-child.mjs",
  wasmMemoryCap: ".vite/build/node_modules/@oh-my-bug/storage/src/evidence/wasm-memory-cap.mjs"
});

export interface RuntimeResources {
  codexBinary: string;
  mediaInfoWasm: string;
  chromium: {
    source: string;
    resourceName: string;
  };
}

export function requiredDesktopBuildPaths(): string[] {
  return Object.values(desktopBuildLayout);
}

export async function verifyDesktopBuild(projectRoot: string): Promise<string[]> {
  return verifyPaths(projectRoot, requiredDesktopBuildPaths());
}

export async function verifyElectronBuild(projectRoot: string): Promise<string[]> {
  return verifyPaths(
    projectRoot,
    requiredDesktopBuildPaths().filter((path) => path !== desktopBuildLayout.renderer)
  );
}

async function verifyPaths(projectRoot: string, relativePaths: string[]): Promise<string[]> {
  const paths = relativePaths.map((path) => resolve(projectRoot, path));
  for (const path of paths) {
    try {
      await access(path);
    } catch {
      throw new Error(`PACKAGED_RUNTIME_MISSING:${relative(projectRoot, path)}`);
    }
  }
  return paths;
}

export function resolveRuntimeResources(): RuntimeResources {
  const codexBinary = resolveCodexBinary().executablePath;

  const mediaInfoWasm = fileURLToPath(import.meta.resolve("mediainfo.js/MediaInfoModule.wasm"));
  const chromiumExecutable = chromium.executablePath();
  const chromiumInstall = findAncestor(chromiumExecutable, /^chromium-(\d+)$/);
  const revision = /^chromium-(\d+)$/.exec(basename(chromiumInstall))?.[1];
  if (!revision) throw new Error("PLAYWRIGHT_CHROMIUM_REVISION_UNRESOLVED");
  const resourceName = `chromium_headless_shell-${revision}`;
  const chromiumSource = join(dirname(chromiumInstall), resourceName);
  return {
    codexBinary,
    mediaInfoWasm,
    chromium: { source: chromiumSource, resourceName }
  };
}

export async function verifyRuntimeResources(resources = resolveRuntimeResources()): Promise<RuntimeResources> {
  for (const path of [resources.codexBinary, resources.mediaInfoWasm, resources.chromium.source]) {
    try {
      await access(path);
    } catch {
      throw new Error(`PACKAGED_RUNTIME_RESOURCE_MISSING:${path}`);
    }
  }
  return resources;
}

function findAncestor(path: string, pattern: RegExp): string {
  let candidate = resolve(path);
  while (dirname(candidate) !== candidate) {
    if (pattern.test(candidate.split(/[\\/]/).at(-1) ?? "")) return candidate;
    candidate = dirname(candidate);
  }
  throw new Error("PLAYWRIGHT_CHROMIUM_INSTALL_UNRESOLVED");
}
