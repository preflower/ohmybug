import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tsImport } from "tsx/esm/api";
import { defineConfig, type Plugin, type UserConfig, type ViteDevServer } from "vite";

import { createDevelopmentSnapshotLoader } from "./scripts/dev-browser-snapshot.js";

export { createDevelopmentSnapshotLoader };

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
export const ELECTRON_RESTART_EVENT = "oh-my-bug:restart-electron";

async function inspectDevelopmentRuntimeSnapshot(options: { dataRoot: string }) {
  const runtime = await tsImport("@oh-my-bug/runtime", import.meta.url) as typeof import("@oh-my-bug/runtime");
  return runtime.inspectDesktopRuntimeSnapshot(options);
}

interface ElectronSourceReloaderOptions {
  build: () => Promise<boolean>;
  restart: () => void;
  debounceMs?: number;
  onBuildError?: (error: unknown) => void;
}

export function createElectronSourceReloader(options: ElectronSourceReloaderOptions): {
  notify(): void;
  dispose(): void;
} {
  let timer: NodeJS.Timeout | undefined;
  let disposed = false;
  let rebuilding = false;
  let queued = false;

  const schedule = () => {
    if (disposed || rebuilding) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void rebuild();
    }, options.debounceMs ?? 150);
  };
  const rebuild = async () => {
    if (disposed || rebuilding) return;
    rebuilding = true;
    queued = false;
    try {
      const succeeded = await options.build();
      if (succeeded && !disposed) options.restart();
    } catch (error) {
      if (options.onBuildError) {
        options.onBuildError(error);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`ELECTRON_DEV_BUILD_FAILED:${message}\n`);
      }
    } finally {
      rebuilding = false;
      if (queued) schedule();
    }
  };

  return {
    notify() {
      if (disposed) return;
      queued = true;
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
}

interface ElectronHotReloadPluginOptions extends ElectronSourceReloaderOptions {
  repositoryRoot: string;
}

export function createDevelopmentSnapshotPlugin(options: {
  load: () => Promise<unknown>;
}): Plugin {
  return {
    name: "oh-my-bug:development-snapshot",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "GET" || request.url !== "/api/dev/snapshot") {
          next();
          return;
        }
        try {
          const snapshot = await options.load();
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify(snapshot));
        } catch {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: "DEV_SNAPSHOT_UNAVAILABLE" }));
        }
      });
    },
  };
}

export function createElectronHotReloadPlugin(options: ElectronHotReloadPluginOptions): Plugin {
  const electronSource = path.resolve(options.repositoryRoot, "apps/desktop/src/electron");
  const runtimeSource = path.resolve(options.repositoryRoot, "apps/runtime/src");
  const packages = path.resolve(options.repositoryRoot, "packages");
  const watchedPaths = [electronSource, runtimeSource, packages];

  return {
    name: "oh-my-bug:electron-hot-reload",
    configureServer(server: ViteDevServer) {
      const reloader = createElectronSourceReloader(options);
      const onChange = (changedPath: string) => {
        if (
          isWithin(changedPath, electronSource) ||
          isWithin(changedPath, runtimeSource) ||
          isWorkspaceSource(changedPath, packages)
        ) {
          reloader.notify();
        }
      };
      server.watcher.add(watchedPaths);
      const sourceEvents = ["add", "change", "unlink"] as const;
      for (const event of sourceEvents) server.watcher.on(event, onChange);
      server.httpServer?.once("close", () => {
        for (const event of sourceEvents) server.watcher.off(event, onChange);
        reloader.dispose();
      });
    },
  };
}

export function createElectronBootstrapPlugin(options: {
  build: () => Promise<boolean>;
  rendererUrl?: (url: string) => void;
}): Plugin {
  return {
    name: "oh-my-bug:electron-bootstrap",
    configResolved(config) {
      const definedUrl = config.define?.MAIN_WINDOW_VITE_DEV_SERVER_URL;
      if (typeof definedUrl !== "string") return;
      try {
        const url = JSON.parse(definedUrl) as unknown;
        if (typeof url === "string") options.rendererUrl?.(url);
      } catch {
        // Vite define values are normally JSON strings; an invalid override is ignored.
      }
    },
    async buildStart() {
      if (!await options.build()) throw new Error("ELECTRON_DEV_BUILD_FAILED");
    },
  };
}

function isWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isWorkspaceSource(candidate: string, packagesRoot: string): boolean {
  const relative = path.relative(packagesRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const segments = relative.split(path.sep);
  return segments.length >= 3 && segments[1] === "src";
}

export async function buildElectronSources(root = repositoryRoot): Promise<boolean> {
  return new Promise((resolve) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(command, ["build:electron"], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      process.stderr.write(`ELECTRON_DEV_BUILD_START_FAILED:${error.message}\n`);
      resolve(false);
    });
    child.once("exit", (code) => resolve(code === 0));
  });
}

export function createRendererViteConfig(options: {
  electronHotReload: boolean;
  repositoryRoot: string;
  build: () => Promise<boolean>;
  restart: () => void;
  developmentSnapshot?: () => Promise<unknown>;
}): UserConfig {
  return {
    root: import.meta.dirname,
    base: "./",
    plugins: [
      react(),
      tailwindcss(),
      ...(options.electronHotReload ? [createElectronHotReloadPlugin({
        repositoryRoot: options.repositoryRoot,
        build: options.build,
        restart: options.restart,
      })] : []),
      ...(options.developmentSnapshot
        ? [createDevelopmentSnapshotPlugin({ load: options.developmentSnapshot })]
        : []),
    ],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@": path.resolve(import.meta.dirname, "./src")
      }
    },
    build: {
      outDir: path.resolve(options.repositoryRoot, ".vite/renderer"),
      emptyOutDir: true
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": "http://127.0.0.1:3210"
      }
    }
  };
}

export default defineConfig(createRendererViteConfig({
  electronHotReload: process.env.OMB_VITE_DEV === "1",
  repositoryRoot,
  build: () => buildElectronSources(repositoryRoot),
  restart: () => process.emit(ELECTRON_RESTART_EVENT),
  developmentSnapshot: createDevelopmentSnapshotLoader({
    dataRoot: process.env.OH_MY_BUG_HOME ?? path.join(homedir(), ".oh-my-bug"),
    inspect: inspectDevelopmentRuntimeSnapshot,
  }),
}));
