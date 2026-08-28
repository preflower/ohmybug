import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const require = createRequire(import.meta.url);
const {
  ELECTRON_RESTART_EVENT,
  runDesktopDevelopment,
  startDesktopDevelopment,
} = require("../../scripts/dev.cjs") as {
  ELECTRON_RESTART_EVENT: string;
  runDesktopDevelopment(options: {
    errorOutput: { write: (message: string) => unknown };
    exit: (code: number) => void;
    startDesktopDevelopment: () => Promise<unknown>;
  }): Promise<void>;
  startDesktopDevelopment(options: {
    args: string[];
    environment: NodeJS.ProcessEnv;
    events: EventEmitter;
    exit: (code: number) => void;
    output: { write: (message: string) => unknown };
    spawnElectron: (...args: unknown[]) => EventEmitter;
    start: (options: unknown) => Promise<EventEmitter>;
  }): Promise<{ dispose(): void }>;
};

describe("Desktop development entry", () => {
  it("owns Electron restarts without relying on interactive stdin", async () => {
    const environment: NodeJS.ProcessEnv = {
      npm_config__jsr_registry: "https://npm.jsr.io/",
    };
    const events = new EventEmitter();
    const initial = Object.assign(new EventEmitter(), {
      kill: vi.fn(),
      spawnargs: ["/electron", ".", "--user-data-dir=/tmp/oh-my-bug-dev"],
      spawnfile: "/electron",
    });
    const replacement = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const start = vi.fn(async () => initial);
    const spawnElectron = vi.fn(() => replacement);
    const exit = vi.fn();

    const controller = await startDesktopDevelopment({
      args: ["--run-as-node", "--", "--user-data-dir=/tmp/oh-my-bug-dev"],
      environment,
      events,
      exit,
      output: { write: vi.fn() },
      spawnElectron,
      start,
    });

    expect(environment.OMB_VITE_DEV).toBe("1");
    expect(environment.npm_config__jsr_registry).toBeUndefined();
    expect(start).toHaveBeenCalledWith({
      args: ["--user-data-dir=/tmp/oh-my-bug-dev"],
      dir: repositoryRoot,
      interactive: false,
      runAsNode: true,
    });

    events.emit(ELECTRON_RESTART_EVENT);
    expect(initial.kill).toHaveBeenCalledWith("SIGTERM");
    initial.emit("exit", 0, "SIGTERM");
    expect(spawnElectron).toHaveBeenCalledWith(
      "/electron",
      [".", "--user-data-dir=/tmp/oh-my-bug-dev"],
      expect.objectContaining({
        cwd: repositoryRoot,
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "true" }),
        stdio: "inherit",
      }),
    );

    replacement.emit("exit", 0, null);
    expect(exit).toHaveBeenCalledWith(0);

    controller.dispose();
  });

  it("uses the cross-platform development entry from the root command", () => {
    const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(manifest.scripts?.dev).toBe("node apps/desktop/scripts/dev.cjs");
  });

  it("terminates the launcher when Forge startup rejects", async () => {
    const failure = new Error("initial build failed");
    const errorOutput = { write: vi.fn() };
    const exit = vi.fn();

    await runDesktopDevelopment({
      errorOutput,
      exit,
      startDesktopDevelopment: async () => { throw failure; },
    });

    expect(errorOutput.write).toHaveBeenCalledWith(expect.stringContaining("initial build failed"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("refuses to start Electron inside the Codex sandbox", async () => {
    const start = vi.fn();

    await expect(startDesktopDevelopment({
      args: [],
      environment: { CODEX_SANDBOX: "seatbelt" },
      events: new EventEmitter(),
      exit: vi.fn(),
      output: { write: vi.fn() },
      spawnElectron: vi.fn(),
      start,
    })).rejects.toThrow("ELECTRON_HOST_PERMISSION_REQUIRED");

    expect(start).not.toHaveBeenCalled();
  });
});
