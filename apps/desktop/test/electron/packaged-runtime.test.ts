import { access, chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createPackageWithOptions } from "@electron/asar";
import { describe, expect, it } from "vitest";

import {
  desktopBuildLayout,
  requiredDesktopBuildPaths,
  resolveRuntimeResources,
  verifyDesktopBuild
} from "../../scripts/packaged-runtime.js";
import { discoverRuntimeWorkspaces } from "../../scripts/copy-runtime-assets.js";
import * as packagedRuntimeVerifier from "../../scripts/verify-packaged-runtime.js";
import { createTempDir } from "../../../../test/helpers/temp-dir.js";

type RuntimeResources = ReturnType<typeof resolveRuntimeResources>;
type VerifyPackagedArchive = (appPath: string, resources: RuntimeResources) => Promise<string[]>;

const desktopRoot = resolve(import.meta.dirname, "../..");

function directPackageName(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) return undefined;
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

async function discoverDesktopImports(path: string): Promise<Set<string>> {
  const discovered = new Set<string>();
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(path, entry.name);
    if (entry.isDirectory()) {
      for (const dependency of await discoverDesktopImports(sourcePath)) discovered.add(dependency);
      continue;
    }
    if (!/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) continue;
    const source = await readFile(sourcePath, "utf8");
    const patterns = [
      /\bfrom\s+["']([^"']+)["']/g,
      /\bimport\s+["']([^"']+)["']/g,
      /\bimport\s*\(\s*["']([^"']+)["']/g,
      /\bimport\.meta\.resolve\(\s*["']([^"']+)["']/g
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const dependency = directPackageName(match[1] ?? "");
        if (dependency) discovered.add(dependency);
      }
    }
  }
  return discovered;
}

async function desktopSourceAndBuildImports(): Promise<Set<string>> {
  const imported = new Set<string>();
  for (const path of [
    join(desktopRoot, "src"),
    join(desktopRoot, "scripts")
  ]) {
    for (const dependency of await discoverDesktopImports(path)) imported.add(dependency);
  }
  for (const file of ["forge.config.ts", "vite.config.ts"]) {
    const source = await readFile(join(desktopRoot, file), "utf8");
    for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      const dependency = directPackageName(match[1] ?? "");
      if (dependency) imported.add(dependency);
    }
  }
  return imported;
}

async function createArchiveFixture(options: {
  omit?: string[];
  unpack?: boolean;
} = {}): Promise<{
  appPath: string;
  archivePath: string;
  resources: RuntimeResources;
  resourcesPath: string;
  cleanup: () => Promise<void>;
}> {
  const temporary = await createTempDir("oh-my-bug-asar-");
  const source = join(temporary.path, "source");
  const appPath = join(temporary.path, "Oh My Bug.app");
  const resourcesPath = process.platform === "darwin"
    ? join(appPath, "Contents", "Resources")
    : join(appPath, "resources");
  const archivePath = join(resourcesPath, "app.asar");
  const codexPackage = `@openai/codex-${process.platform}-${process.arch}`;
  const codexRelative = join("node_modules", codexPackage, "vendor", "fixture", "bin", process.platform === "win32" ? "codex.exe" : "codex");
  const mediaRelative = join("node_modules", "mediainfo.js", "dist", "MediaInfoModule.wasm");
  const chromiumSource = join(temporary.path, "chromium_headless_shell-1234");
  const chromiumExecutable = join("fixture", process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");
  const resources: RuntimeResources = {
    codexBinary: join(source, codexRelative),
    mediaInfoWasm: join(source, mediaRelative),
    chromium: {
      source: chromiumSource,
      resourceName: "chromium_headless_shell-1234"
    }
  };
  const required = [
    ...Object.values(desktopBuildLayout),
    codexRelative,
    mediaRelative
  ].filter((path) => !options.omit?.includes(path));
  for (const relativePath of required) {
    const path = join(source, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, relativePath, {
      mode: relativePath === codexRelative ? 0o755 : 0o644
    });
  }
  for (const decoy of options.omit ?? []) {
    const path = join(source, `${decoy}.backup`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "decoy");
  }
  await mkdir(resourcesPath, { recursive: true });
  await createPackageWithOptions(source, archivePath, options.unpack === false ? {} : {
    unpack: "**/{*.wasm,vendor/**/bin/*}"
  });
  const packagedChromiumExecutable = join(resourcesPath, resources.chromium.resourceName, chromiumExecutable);
  await mkdir(dirname(join(chromiumSource, chromiumExecutable)), { recursive: true });
  await writeFile(join(chromiumSource, chromiumExecutable), "binary", { mode: 0o755 });
  await mkdir(dirname(packagedChromiumExecutable), { recursive: true });
  await writeFile(packagedChromiumExecutable, "binary", { mode: 0o755 });
  return { appPath, archivePath, resources, resourcesPath, cleanup: temporary.cleanup };
}

describe("packaged desktop runtime", () => {
  it("declares every Desktop direct runtime import and the ASAR inspection API", async () => {
    const manifest = JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const imported = await desktopSourceAndBuildImports();
    const declared = new Set([
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.devDependencies)
    ]);

    expect(Object.keys(manifest.dependencies).filter((dependency) => !imported.has(dependency))).toEqual([]);
    expect([...imported].filter((dependency) => !declared.has(dependency))).toEqual([]);
    expect([...imported]).toEqual(expect.arrayContaining([
      "@openai/codex-sdk",
      "mediainfo.js",
      "@electron/asar"
    ]));
    expect(manifest.devDependencies["@electron/asar"]).toBe("3.4.1");
  });

  it("uses source-relative workspace entry points and package-owned runtime assets", () => {
    expect(desktopBuildLayout).toEqual({
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
      wasmMemoryCap: ".vite/build/node_modules/@oh-my-bug/storage/src/evidence/wasm-memory-cap.mjs",
    });
  });

  it("discovers the complete workspace graph from Runtime dependencies", async () => {
    const workspaces = await discoverRuntimeWorkspaces(resolve(desktopRoot, "../.."));
    expect(workspaces.map((workspace) => workspace.name)).toEqual([
      "@oh-my-bug/agent-codex",
      "@oh-my-bug/core",
      "@oh-my-bug/integration-dingtalk",
      "@oh-my-bug/integration-manual",
      "@oh-my-bug/integration-sentry",
      "@oh-my-bug/module-api",
      "@oh-my-bug/runtime",
      "@oh-my-bug/storage",
      "@oh-my-bug/workspace-git",
      "@oh-my-bug/workspace-local",
    ]);
  });

  it("resolves installed Codex, MediaInfo, and Chromium runtime assets", async () => {
    const resources = resolveRuntimeResources();

    await expect(access(resources.codexBinary)).resolves.toBeUndefined();
    await expect(access(resources.mediaInfoWasm)).resolves.toBeUndefined();
    await expect(access(resources.chromium.source)).resolves.toBeUndefined();
    expect(resources.chromium.resourceName).toMatch(/^chromium_headless_shell-\d+$/);
  });

  it("fails closed until every compiled entry and copied runtime asset exists", async () => {
    const temporary = await createTempDir("oh-my-bug-package-layout-");
    await expect(verifyDesktopBuild(temporary.path)).rejects.toThrow("PACKAGED_RUNTIME_MISSING");

    try {
      for (const relativePath of requiredDesktopBuildPaths()) {
        const path = join(temporary.path, relativePath);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, relativePath.endsWith(".sql") ? "select 1;" : "export {};\n");
      }

      await expect(verifyDesktopBuild(temporary.path)).resolves.toEqual(
        Object.values(desktopBuildLayout).map((relativePath) => join(temporary.path, relativePath))
      );
    } finally {
      await temporary.cleanup();
    }
  });

  it("deeply verifies exact archive entries and intentionally unpacked runtime resources", async () => {
    expect("verifyPackagedArchive" in packagedRuntimeVerifier).toBe(true);
    const verifyPackagedArchive = packagedRuntimeVerifier.verifyPackagedArchive as VerifyPackagedArchive;
    const fixture = await createArchiveFixture();

    try {
      await expect(verifyPackagedArchive(fixture.appPath, fixture.resources)).resolves.toEqual(
        expect.arrayContaining([
          fixture.archivePath,
          join(fixture.resourcesPath, "app.asar.unpacked", "node_modules", `@openai/codex-${process.platform}-${process.arch}`, "vendor", "fixture", "bin", process.platform === "win32" ? "codex.exe" : "codex"),
          join(fixture.resourcesPath, "app.asar.unpacked", "node_modules", "mediainfo.js", "dist", "MediaInfoModule.wasm"),
          join(fixture.resourcesPath, fixture.resources.chromium.resourceName, "fixture", process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell")
        ])
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects prefix decoys and lists every missing archive entry", async () => {
    expect("verifyPackagedArchive" in packagedRuntimeVerifier).toBe(true);
    const verifyPackagedArchive = packagedRuntimeVerifier.verifyPackagedArchive as VerifyPackagedArchive;
    const omitted = [desktopBuildLayout.runtimeProtocol, desktopBuildLayout.storage];
    const fixture = await createArchiveFixture({ omit: omitted });

    try {
      await expect(verifyPackagedArchive(fixture.appPath, fixture.resources)).rejects.toThrow(
        `PACKAGED_RUNTIME_ARCHIVE_MISSING:${omitted.join(",")}`
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed with a stable code when app.asar is corrupt", async () => {
    expect("verifyPackagedArchive" in packagedRuntimeVerifier).toBe(true);
    const verifyPackagedArchive = packagedRuntimeVerifier.verifyPackagedArchive as VerifyPackagedArchive;
    const fixture = await createArchiveFixture();

    try {
      await writeFile(fixture.archivePath, "not an asar archive");
      await expect(verifyPackagedArchive(fixture.appPath, fixture.resources)).rejects.toThrow(
        "PACKAGED_RUNTIME_ARCHIVE_INVALID"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("lists missing physical files for intentionally unpacked resources", async () => {
    expect("verifyPackagedArchive" in packagedRuntimeVerifier).toBe(true);
    const verifyPackagedArchive = packagedRuntimeVerifier.verifyPackagedArchive as VerifyPackagedArchive;
    const fixture = await createArchiveFixture();
    const unpackedMedia = join(
      fixture.resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      "mediainfo.js",
      "dist",
      "MediaInfoModule.wasm"
    );

    try {
      await rm(unpackedMedia);
      await expect(verifyPackagedArchive(fixture.appPath, fixture.resources)).rejects.toThrow(
        "PACKAGED_RUNTIME_RESOURCE_MISSING:app.asar.unpacked/node_modules/mediainfo.js/dist/MediaInfoModule.wasm"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it.skipIf(process.platform === "win32")("rejects packaged runtime binaries without execute permission", async () => {
    expect("verifyPackagedArchive" in packagedRuntimeVerifier).toBe(true);
    const verifyPackagedArchive = packagedRuntimeVerifier.verifyPackagedArchive as VerifyPackagedArchive;
    const fixture = await createArchiveFixture();
    const unpackedCodex = join(
      fixture.resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      `@openai/codex-${process.platform}-${process.arch}`,
      "vendor",
      "fixture",
      "bin",
      "codex"
    );
    const packagedChromium = join(
      fixture.resourcesPath,
      fixture.resources.chromium.resourceName,
      "fixture",
      "chrome-headless-shell"
    );

    try {
      await chmod(unpackedCodex, 0o600);
      await chmod(packagedChromium, 0o600);
      await expect(verifyPackagedArchive(fixture.appPath, fixture.resources)).rejects.toThrow(
        "PACKAGED_RUNTIME_EXECUTABLE_INVALID:app.asar.unpacked/node_modules/" +
        `@openai/codex-${process.platform}-${process.arch}/vendor/fixture/bin/codex,` +
        `${fixture.resources.chromium.resourceName}/fixture/chrome-headless-shell`
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not accept a Chromium executable decoy at the wrong relative path", async () => {
    expect("verifyPackagedArchive" in packagedRuntimeVerifier).toBe(true);
    const verifyPackagedArchive = packagedRuntimeVerifier.verifyPackagedArchive as VerifyPackagedArchive;
    const fixture = await createArchiveFixture();
    const expectedChromium = join(
      fixture.resourcesPath,
      fixture.resources.chromium.resourceName,
      "fixture",
      process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell"
    );
    const decoyChromium = join(
      fixture.resourcesPath,
      fixture.resources.chromium.resourceName,
      "aaa-decoy",
      process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell"
    );

    try {
      await rm(expectedChromium);
      await mkdir(dirname(decoyChromium), { recursive: true });
      await writeFile(decoyChromium, "decoy", { mode: 0o755 });
      await expect(verifyPackagedArchive(fixture.appPath, fixture.resources)).rejects.toThrow(
        `PACKAGED_RUNTIME_RESOURCE_MISSING:${fixture.resources.chromium.resourceName}/fixture/` +
        (process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell")
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
