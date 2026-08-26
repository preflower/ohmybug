import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractFile, listPackage, statFile } from "@electron/asar";

import {
  desktopBuildLayout,
  resolveRuntimeResources,
  type RuntimeResources,
  verifyDesktopBuild,
  verifyRuntimeResources
} from "./packaged-runtime.js";

function resourcesPathForApp(appPath: string): string {
  return process.platform === "darwin"
    ? join(resolve(appPath), "Contents", "Resources")
    : join(resolve(appPath), "resources");
}

function archiveEntry(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

function packagedModuleEntry(sourcePath: string, packageName: string): string {
  const normalized = sourcePath.replaceAll("\\", "/");
  const marker = `/node_modules/${packageName}/`;
  const packageIndex = normalized.lastIndexOf(marker);
  if (packageIndex < 0) {
    throw new Error(`PACKAGED_RUNTIME_RESOURCE_PATH_INVALID:${packageName}`);
  }
  return `node_modules/${packageName}/${normalized.slice(packageIndex + marker.length)}`;
}

async function findFileByBasename(root: string, expected: string): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === expected) return path;
    if (entry.isDirectory()) {
      const nested = await findFileByBasename(path, expected);
      if (nested) return nested;
    }
  }
  return undefined;
}

export async function verifyPackagedArchive(
  appPath: string,
  resources: RuntimeResources = resolveRuntimeResources(),
): Promise<string[]> {
  const resourcesPath = resourcesPathForApp(appPath);
  const archivePath = join(resourcesPath, "app.asar");
  const codexPackage = `@openai/codex-${process.platform}-${process.arch}`;
  const codexEntry = packagedModuleEntry(resources.codexBinary, codexPackage);
  const mediaInfoEntry = packagedModuleEntry(resources.mediaInfoWasm, "mediainfo.js");
  const unpackedEntries = [
    codexEntry,
    mediaInfoEntry
  ];
  let entries: Set<string>;
  try {
    entries = new Set(listPackage(archivePath, { isPack: false }).map(archiveEntry));
  } catch {
    throw new Error("PACKAGED_RUNTIME_ARCHIVE_INVALID");
  }
  const requiredArchiveEntries = [
    ...Object.values(desktopBuildLayout).map(archiveEntry),
    ...unpackedEntries
  ];
  const missingArchiveEntries = requiredArchiveEntries.filter((entry) => !entries.has(entry));
  if (missingArchiveEntries.length > 0) {
    throw new Error(`PACKAGED_RUNTIME_ARCHIVE_MISSING:${missingArchiveEntries.join(",")}`);
  }
  let packagedProtocolVersion: { codexCliVersion?: unknown; schemaFile?: unknown };
  try {
    packagedProtocolVersion = JSON.parse(extractFile(
      archivePath,
      archiveEntry(desktopBuildLayout.codexProtocolVersion),
    ).toString("utf8")) as { codexCliVersion?: unknown; schemaFile?: unknown };
  } catch {
    throw new Error("CODEX_PROTOCOL_VERSION_MISMATCH");
  }
  if (
    packagedProtocolVersion.codexCliVersion !== resources.codexPackageVersion ||
    packagedProtocolVersion.schemaFile !== "codex_app_server_protocol.schemas.json"
  ) {
    throw new Error("CODEX_PROTOCOL_VERSION_MISMATCH");
  }

  const notMarkedUnpacked: string[] = [];
  try {
    for (const entry of unpackedEntries) {
      const metadata = statFile(archivePath, entry);
      if (!("unpacked" in metadata) || !metadata.unpacked) {
        notMarkedUnpacked.push(entry);
      }
    }
  } catch {
    throw new Error("PACKAGED_RUNTIME_ARCHIVE_INVALID");
  }
  if (notMarkedUnpacked.length > 0) {
    throw new Error(`PACKAGED_RUNTIME_ARCHIVE_UNPACKED_REQUIRED:${notMarkedUnpacked.join(",")}`);
  }

  const unpackedCodexPath = join(resourcesPath, "app.asar.unpacked", codexEntry);
  const unpackedMediaInfoPath = join(resourcesPath, "app.asar.unpacked", mediaInfoEntry);
  const unpackedPaths = [unpackedCodexPath, unpackedMediaInfoPath];
  const missingResources: string[] = [];
  for (const path of unpackedPaths) {
    try {
      await access(path);
    } catch {
      missingResources.push(archiveEntry(relative(resourcesPath, path)));
    }
  }
  const chromiumExecutableName = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const chromiumSourceExecutable = await findFileByBasename(resources.chromium.source, chromiumExecutableName);
  if (!chromiumSourceExecutable) {
    throw new Error(
      `PACKAGED_RUNTIME_RESOURCE_PATH_INVALID:${resources.chromium.resourceName}/**/${chromiumExecutableName}`
    );
  }
  const packagedChromiumRoot = join(resourcesPath, resources.chromium.resourceName);
  const chromiumRelativeExecutable = relative(resources.chromium.source, chromiumSourceExecutable);
  const packagedChromiumExecutable = join(packagedChromiumRoot, chromiumRelativeExecutable);
  try {
    await access(packagedChromiumExecutable);
  } catch {
    missingResources.push(archiveEntry(relative(resourcesPath, packagedChromiumExecutable)));
  }
  if (missingResources.length > 0) {
    throw new Error(`PACKAGED_RUNTIME_RESOURCE_MISSING:${missingResources.join(",")}`);
  }
  if (process.platform !== "win32") {
    const invalidExecutables: string[] = [];
    for (const path of [unpackedCodexPath, packagedChromiumExecutable]) {
      try {
        await access(path, constants.X_OK);
      } catch {
        invalidExecutables.push(archiveEntry(relative(resourcesPath, path)));
      }
    }
    if (invalidExecutables.length > 0) {
      throw new Error(`PACKAGED_RUNTIME_EXECUTABLE_INVALID:${invalidExecutables.join(",")}`);
    }
  }
  return [archivePath, ...unpackedPaths, packagedChromiumExecutable];
}

export async function verifyPackagedRuntime(
  projectRoot = resolve(import.meta.dirname, "../../.."),
  appPath?: string,
): Promise<string[]> {
  const buildPaths = await verifyDesktopBuild(projectRoot);
  const resources = await verifyRuntimeResources();
  const verified = [
    ...buildPaths,
    resources.codexBinary,
    resources.codexProtocolSchema,
    resources.codexProtocolVersion,
    resources.mediaInfoWasm,
    resources.chromium.source,
  ];
  if (appPath) {
    verified.push(...await verifyPackagedArchive(appPath, resources));
  }
  return verified;
}

async function main(): Promise<void> {
  const appArgument = process.argv.find((argument) => argument.startsWith("--app="));
  const paths = await verifyPackagedRuntime(undefined, appArgument?.slice("--app=".length));
  process.stdout.write(`PASS packaged runtime (${paths.length} paths verified)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
