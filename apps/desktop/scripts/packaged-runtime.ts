import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

export const desktopBuildLayout = Object.freeze({
  main: ".vite/build/apps/desktop/src/electron/main.js",
  preload: ".vite/build/apps/desktop/src/electron/preload.cjs",
  renderer: ".vite/renderer/index.html",
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
  const sdkEntry = fileURLToPath(import.meta.resolve("@openai/codex-sdk"));
  const sdkRequire = createRequire(sdkEntry);
  const codexPackage = sdkRequire.resolve("@openai/codex/package.json");
  const codexRequire = createRequire(codexPackage);
  const nativePackageName = nativeCodexPackageName(process.platform, process.arch);
  const nativePackage = codexRequire.resolve(`${nativePackageName}/package.json`);
  const targetTriple = codexTargetTriple(process.platform, process.arch);
  const codexBinary = join(
    dirname(nativePackage),
    "vendor",
    targetTriple,
    "bin",
    process.platform === "win32" ? "codex.exe" : "codex"
  );

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

function nativeCodexPackageName(platform: NodeJS.Platform, arch: string): string {
  const suffix = platform === "darwin" && arch === "arm64" ? "darwin-arm64"
    : platform === "darwin" && arch === "x64" ? "darwin-x64"
      : platform === "linux" && arch === "arm64" ? "linux-arm64"
        : platform === "linux" && arch === "x64" ? "linux-x64"
          : platform === "win32" && arch === "arm64" ? "win32-arm64"
            : platform === "win32" && arch === "x64" ? "win32-x64"
              : undefined;
  if (!suffix) throw new Error(`CODEX_PLATFORM_UNSUPPORTED:${platform}-${arch}`);
  return `@openai/codex-${suffix}`;
}

function codexTargetTriple(platform: NodeJS.Platform, arch: string): string {
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  throw new Error(`CODEX_PLATFORM_UNSUPPORTED:${platform}-${arch}`);
}
