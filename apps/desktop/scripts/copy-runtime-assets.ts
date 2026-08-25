import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { verifyElectronBuild, verifyRuntimeResources } from "./packaged-runtime.js";

const projectRoot = resolve(import.meta.dirname, "../../..");

interface WorkspaceManifest {
  name: string;
  version: string;
  type?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  ohMyBug?: { runtimeAssets?: string[] };
}

export interface RuntimeWorkspace {
  name: string;
  directory: string;
  compiledDirectory: string;
  manifest: WorkspaceManifest;
}

export async function cleanElectronBuild(root = projectRoot): Promise<void> {
  await rm(resolve(root, ".vite/build"), { recursive: true, force: true });
}

export async function discoverRuntimeWorkspaces(root = projectRoot): Promise<RuntimeWorkspace[]> {
  const workspaces = new Map<string, RuntimeWorkspace>();
  for (const parent of ["apps", "packages"]) {
    for (const entry of await readdir(resolve(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = resolve(root, parent, entry.name);
      let manifest: WorkspaceManifest;
      try {
        manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8")) as WorkspaceManifest;
      } catch {
        continue;
      }
      if (!manifest.name?.startsWith("@oh-my-bug/")) continue;
      workspaces.set(manifest.name, {
        name: manifest.name,
        directory,
        compiledDirectory: resolve(root, ".vite/build", relative(root, directory)),
        manifest,
      });
    }
  }

  const discovered = new Map<string, RuntimeWorkspace>();
  const visit = (name: string) => {
    if (discovered.has(name)) return;
    const workspace = workspaces.get(name);
    if (!workspace) throw new Error(`RUNTIME_WORKSPACE_NOT_FOUND:${name}`);
    discovered.set(name, workspace);
    for (const [dependency, version] of Object.entries(workspace.manifest.dependencies ?? {})) {
      if (version.startsWith("workspace:")) visit(dependency);
    }
  };
  visit("@oh-my-bug/runtime");
  return [...discovered.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function copyRuntimeAssets(root = projectRoot): Promise<void> {
  const workspaces = await discoverRuntimeWorkspaces(root);
  for (const workspace of workspaces) {
    const destination = resolve(root, ".vite/build/node_modules", workspace.name);
    await mkdir(destination, { recursive: true });
    await cp(resolve(workspace.compiledDirectory, "src"), resolve(destination, "src"), {
      recursive: true,
    });
    await writeFile(resolve(destination, "package.json"), `${JSON.stringify({
      name: workspace.manifest.name,
      version: workspace.manifest.version,
      type: workspace.manifest.type ?? "module",
      exports: compiledExports(workspace.manifest.exports ?? { ".": "./src/index.ts" }),
      dependencies: workspace.manifest.dependencies ?? {},
    }, null, 2)}\n`);

    for (const asset of workspace.manifest.ohMyBug?.runtimeAssets ?? []) {
      const target = resolve(destination, asset);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolve(workspace.directory, asset), target);
    }
  }
  await rm(resolve(root, ".vite/build/apps/runtime"), { recursive: true, force: true });
  await rm(resolve(root, ".vite/build/packages"), { recursive: true, force: true });
  await copyDesktopAssets(root);
  await verifyRuntimeResources();
  await verifyElectronBuild(root);
}

export async function copyDesktopAssets(root = projectRoot): Promise<void> {
  const source = resolve(root, "apps/desktop/assets/icons");
  const destination = resolve(root, ".vite/build/apps/desktop/assets/icons");
  await mkdir(destination, { recursive: true });
  for (const name of [
    "oh-my-bug-trayTemplate.png",
    "oh-my-bug-trayTemplate@2x.png",
    "tray-status-failure.png",
    "tray-status-failure@2x.png",
    "tray-status-review.png",
    "tray-status-review@2x.png",
    "tray-status-processing.png",
    "tray-status-processing@2x.png",
  ]) {
    await copyFile(resolve(source, name), resolve(destination, name));
  }
}

function compiledExports(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\.ts$/, ".js");
  if (Array.isArray(value)) return value.map(compiledExports);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, compiledExports(entry)]));
  }
  return value;
}

async function main(): Promise<void> {
  if (process.argv.includes("--clean")) {
    await cleanElectronBuild();
    return;
  }
  await copyRuntimeAssets();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
