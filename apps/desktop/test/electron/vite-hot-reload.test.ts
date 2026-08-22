import { describe, expect, it } from "vitest";

import * as viteConfig from "../../vite.config.js";
import {
  createDevelopmentSnapshotPlugin,
  createElectronBootstrapPlugin,
  createElectronHotReloadPlugin,
  createElectronSourceReloader,
  createRendererViteConfig,
} from "../../vite.config.js";

describe("Electron source hot reload", () => {
  it("preserves persisted Projects and Issues in the browser snapshot", async () => {
    const persisted = {
      integrationPlugins: [],
      projects: [{
        id: "persisted-project",
        key: "REAL",
        path: "/work/real",
        revision: 2,
        createdAt: "2026-08-20T08:00:00.000Z",
        updatedAt: "2026-08-21T08:00:00.000Z",
      }],
      issues: [{ id: "persisted-issue", identifier: "REAL-1" }],
      integrationHealth: {},
    };
    const createDevelopmentSnapshotLoader = (
      viteConfig as typeof viteConfig & {
        createDevelopmentSnapshotLoader?: (options: {
          dataRoot: string;
          inspect: () => Promise<typeof persisted>;
        }) => () => Promise<unknown>;
      }
    ).createDevelopmentSnapshotLoader;
    const load = createDevelopmentSnapshotLoader?.({
      dataRoot: "/tmp/oh-my-bug-real-data",
      inspect: async () => persisted,
    });

    expect(await load?.()).toEqual(persisted);
  });

  it("falls back to representative styling data when the persisted Runtime is empty", async () => {
    const createDevelopmentSnapshotLoader = (
      viteConfig as typeof viteConfig & {
        createDevelopmentSnapshotLoader?: (options: {
          dataRoot: string;
          inspect: (options: { dataRoot: string }) => Promise<{
            integrationPlugins: unknown[];
            projects: unknown[];
            issues: unknown[];
            integrationHealth: Record<string, unknown>;
          }>;
          now: () => string;
        }) => () => Promise<unknown>;
      }
    ).createDevelopmentSnapshotLoader;
    const load = createDevelopmentSnapshotLoader?.({
      dataRoot: "/tmp/oh-my-bug-style-data",
      inspect: async (options) => {
        if (options.dataRoot !== "/tmp/oh-my-bug-style-data") {
          throw new Error("WRONG_DATA_ROOT");
        }
        return {
          integrationPlugins: [{ id: "sentry", name: "Sentry", configFields: [], secretFields: [] }],
          projects: [],
          issues: [],
          integrationHealth: {},
        };
      },
      now: () => "2026-08-21T08:00:00.000Z",
    });

    const snapshot = await load?.() as {
      integrationPlugins: Array<{ id: string }>;
      projects: Array<{ id: string; key: string }>;
      issues: Array<{ projectId: string; identifier: string; status: string }>;
    } | undefined;

    expect(snapshot).toMatchObject({
      integrationPlugins: [{ id: "sentry" }],
      projects: [
        { id: "dev-style-ohmybug", key: "OHMYBUG" },
        { id: "dev-style-logistics", key: "LOGISTICS" },
        { id: "dev-style-storefront", key: "STOREFRONT" },
      ],
      issues: [
        { projectId: "dev-style-ohmybug", identifier: "OHMYBUG-1", status: "ASSESSMENT_REVIEW" },
        { projectId: "dev-style-ohmybug", identifier: "OHMYBUG-2", status: "ACCEPTANCE_REVIEW" },
      ],
      issueEvents: {
        "dev-style-issue-assessment": expect.arrayContaining([
          expect.objectContaining({ type: "ISSUE_CREATED", sequence: 1 }),
        ]),
        "dev-style-issue-acceptance": expect.arrayContaining([
          expect.objectContaining({ type: "DELIVERY_READY", sequence: 1 }),
        ]),
      },
    });
  });

  it("serves the browser snapshot only from the development API route", async () => {
    const snapshot = {
      integrationPlugins: [],
      projects: [{ id: "project-1", key: "OMB" }],
      issues: [{ id: "issue-1", identifier: "OMB-1" }],
      integrationHealth: {},
    };
    let middleware: ((
      request: { method?: string; url?: string },
      response: {
        statusCode: number;
        setHeader(name: string, value: string): void;
        end(body?: string): void;
      },
      next: () => void,
    ) => Promise<void>) | undefined;
    const plugin = createDevelopmentSnapshotPlugin({ load: async () => snapshot });
    const configureServer = plugin.configureServer as ((server: {
      middlewares: { use(handler: typeof middleware): void };
    }) => void) | undefined;
    configureServer?.({
      middlewares: {
        use(handler: typeof middleware) { middleware = handler; },
      },
    });
    expect(middleware).toBeTypeOf("function");

    const headers = new Map<string, string>();
    let body = "";
    let nextCalled = false;
    const response = {
      statusCode: 0,
      setHeader: (name: string, value: string) => headers.set(name, value),
      end: (value = "") => { body = value; },
    };
    await middleware?.(
      { method: "GET", url: "/api/dev/snapshot" },
      response,
      () => { nextCalled = true; },
    );

    expect(response.statusCode).toBe(200);
    expect(headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.parse(body)).toEqual(snapshot);
    expect(nextCalled).toBe(false);
  });

  it("reports snapshot read failures without leaving the Vite request hanging", async () => {
    const plugin = createDevelopmentSnapshotPlugin({
      load: async () => { throw new Error("SQLITE_BUSY"); },
    });
    let middleware: ((
      request: { method?: string; url?: string },
      response: {
        statusCode: number;
        setHeader(name: string, value: string): void;
        end(body?: string): void;
      },
      next: () => void,
    ) => Promise<void>) | undefined;
    const configureServer = plugin.configureServer as ((server: {
      middlewares: { use(handler: typeof middleware): void };
    }) => void) | undefined;
    configureServer?.({ middlewares: { use: (handler) => { middleware = handler; } } });
    const headers = new Map<string, string>();
    let body = "";
    const response = {
      statusCode: 0,
      setHeader: (name: string, value: string) => headers.set(name, value),
      end: (value = "") => { body = value; },
    };

    await expect(middleware?.(
      { method: "GET", url: "/api/dev/snapshot" },
      response,
      () => undefined,
    )).resolves.toBeUndefined();

    expect(response.statusCode).toBe(500);
    expect(headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(JSON.parse(body)).toEqual({ error: "DEV_SNAPSHOT_UNAVAILABLE" });
  });

  it("coalesces source changes and restarts Electron only after the rebuild succeeds", async () => {
    const events: string[] = [];
    let finishBuild!: () => void;
    let markBuildStarted!: () => void;
    let markRestarted!: () => void;
    const buildStarted = new Promise<void>((resolve) => { markBuildStarted = resolve; });
    const buildFinished = new Promise<void>((resolve) => { finishBuild = resolve; });
    const restarted = new Promise<void>((resolve) => { markRestarted = resolve; });

    const reloader = createElectronSourceReloader({
      debounceMs: 0,
      build: async () => {
        events.push("build:start");
        markBuildStarted();
        await buildFinished;
        events.push("build:complete");
        return true;
      },
      restart: () => {
        events.push("restart");
        markRestarted();
      },
    });

    reloader.notify();
    reloader.notify();
    await buildStarted;
    expect(events).toEqual(["build:start"]);

    finishBuild();
    await restarted;
    expect(events).toEqual(["build:start", "build:complete", "restart"]);
    reloader.dispose();
  });

  it("keeps the current Electron process running when a rebuild fails", async () => {
    const events: string[] = [];
    let markBuildAttempted!: () => void;
    const buildAttempted = new Promise<void>((resolve) => { markBuildAttempted = resolve; });
    const reloader = createElectronSourceReloader({
      debounceMs: 0,
      build: async () => {
        events.push("build:failed");
        markBuildAttempted();
        return false;
      },
      restart: () => events.push("restart"),
    });

    reloader.notify();
    await buildAttempted;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toEqual(["build:failed"]);
    reloader.dispose();
  });

  it("reports a rejected rebuild without leaving an unhandled rejection", async () => {
    const failure = new Error("build crashed");
    const errors: unknown[] = [];
    let markBuildAttempted!: () => void;
    const buildAttempted = new Promise<void>((resolve) => { markBuildAttempted = resolve; });
    const reloader = createElectronSourceReloader({
      debounceMs: 0,
      build: async () => {
        markBuildAttempted();
        throw failure;
      },
      restart: () => errors.push("restart"),
      onBuildError: (error) => errors.push(error),
    });

    reloader.notify();
    await buildAttempted;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors).toEqual([failure]);
    reloader.dispose();
  });

  it("watches Electron and Runtime sources without turning renderer edits into full restarts", async () => {
    const events: string[] = [];
    const watchedPaths: string[] = [];
    const sourceEvents: Partial<Record<"add" | "change" | "unlink", (path: string) => void>> = {};
    let markRestarted!: () => void;
    const restarted = new Promise<void>((resolve) => { markRestarted = resolve; });
    const plugin = createElectronHotReloadPlugin({
      repositoryRoot: "/repo",
      debounceMs: 0,
      build: async () => {
        events.push("build");
        return true;
      },
      restart: () => {
        events.push("restart");
        markRestarted();
      },
    });

    const configureServer = plugin.configureServer as ((server: {
      watcher: {
        add(paths: string[]): void;
        on(event: "add" | "change" | "unlink", listener: (path: string) => void): void;
        off(event: "add" | "change" | "unlink", listener: (path: string) => void): void;
      };
      httpServer: { once(event: "close", listener: () => void): void };
    }) => void) | undefined;
    configureServer?.({
      watcher: {
        add: (paths: string[]) => { watchedPaths.push(...paths); },
        on: (event: "add" | "change" | "unlink", listener: (path: string) => void) => {
          sourceEvents[event] = listener;
        },
        off: () => undefined,
      },
      httpServer: { once: () => undefined },
    });
    expect(watchedPaths).toEqual([
      "/repo/apps/desktop/src/electron",
      "/repo/apps/runtime/src",
      "/repo/packages",
    ]);

    expect(Object.keys(sourceEvents).sort()).toEqual(["add", "change", "unlink"]);

    sourceEvents.change?.("/repo/apps/desktop/src/web/app.tsx");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([]);

    sourceEvents.add?.("/repo/apps/runtime/src/new-service.ts");
    await restarted;
    expect(events).toEqual(["build", "restart"]);
  });

  it("stops the Forge bootstrap when the initial Electron build fails", async () => {
    const plugin = createElectronBootstrapPlugin({ build: async () => false });
    const buildStart = plugin.buildStart as (() => Promise<void>) | undefined;

    await expect(buildStart?.()).rejects.toThrow("ELECTRON_DEV_BUILD_FAILED");
  });

  it("passes the renderer server's actual port to the Electron bootstrap build", async () => {
    const events: string[] = [];
    const plugin = createElectronBootstrapPlugin({
      build: async () => {
        events.push("build");
        return true;
      },
      rendererUrl: (url) => events.push(`renderer:${url}`),
    });
    const configResolved = plugin.configResolved as ((config: {
      define?: Record<string, string>;
    }) => void) | undefined;
    const buildStart = plugin.buildStart as (() => Promise<void>) | undefined;

    configResolved?.({
      define: { MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify("http://127.0.0.1:5174") },
    });
    await buildStart?.();

    expect(events).toEqual(["renderer:http://127.0.0.1:5174", "build"]);
  });

  it("installs the Electron source watcher only in the Forge development server", () => {
    const dependencies = {
      repositoryRoot: "/repo",
      build: async () => true,
      restart: () => undefined,
    };
    const development = createRendererViteConfig({ ...dependencies, electronHotReload: true });
    const production = createRendererViteConfig({ ...dependencies, electronHotReload: false });
    const pluginNames = (config: { plugins?: unknown }): string[] => {
      const names: string[] = [];
      const visit = (value: unknown) => {
        if (Array.isArray(value)) {
          value.forEach(visit);
        } else if (value && typeof value === "object" && "name" in value) {
          const name = (value as { name?: unknown }).name;
          if (typeof name === "string") names.push(name);
        }
      };
      visit(config.plugins);
      return names;
    };

    expect(pluginNames(development)).toContain("oh-my-bug:electron-hot-reload");
    expect(pluginNames(production)).not.toContain("oh-my-bug:electron-hot-reload");
  });

  it("deduplicates React for Base UI dependency pre-bundling", () => {
    const config = createRendererViteConfig({
      electronHotReload: false,
      repositoryRoot: "/repo",
      build: async () => true,
      restart: () => undefined,
    });

    expect(config.resolve?.dedupe).toEqual(["react", "react-dom"]);
  });

  it("installs the browser snapshot route when a development snapshot loader is configured", () => {
    const config = (createRendererViteConfig as typeof createRendererViteConfig & ((options: {
      electronHotReload: boolean;
      repositoryRoot: string;
      build: () => Promise<boolean>;
      restart: () => void;
      developmentSnapshot: () => Promise<unknown>;
    }) => ReturnType<typeof createRendererViteConfig>))({
      electronHotReload: false,
      repositoryRoot: "/repo",
      build: async () => true,
      restart: () => undefined,
      developmentSnapshot: async () => ({ projects: [], issues: [] }),
    });
    const pluginNames: string[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object" && "name" in value) {
        const name = (value as { name?: unknown }).name;
        if (typeof name === "string") pluginNames.push(name);
      }
    };
    visit(config.plugins);

    expect(pluginNames).toContain("oh-my-bug:development-snapshot");
  });
});
