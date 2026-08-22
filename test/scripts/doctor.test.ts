import { spawn } from "node:child_process";
import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { collectDiagnostics } from "../../scripts/doctor.js";
import { createTempDir } from "../helpers/temp-dir.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("doctor", () => {
  it("reports required local dependencies without printing auth output", async () => {
    const temporary = await createTempDir("oh-my-bug-doctor-");
    cleanups.push(temporary.cleanup);
    const diagnostics = await collectDiagnostics({
      dataRoot: temporary.path,
      execute: async (command) => ({ stdout: command === "codex" ? "secret-auth-token" : "1.0.0" }),
      checkChromium: async () => "Chromium test",
      checkDesktopBuild: async () => ["main", "preload", "utility", "renderer"],
      checkDesktopRuntime: async () => ["codex", "mediainfo", "chromium"],
      checkProductRuntime: async () => ({ projects: 0, integrations: 0 }),
    });
    const text = JSON.stringify(diagnostics);

    expect(diagnostics.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      "Node.js", "pnpm", "Codex", "Codex auth", "Chromium", "Desktop build", "Desktop runtime",
      "App data", "Git", "Runtime database", "Integrations"
    ]));
    expect(diagnostics.find((entry) => entry.name === "Desktop build")?.status).toBe("PASS");
    expect(diagnostics.find((entry) => entry.name === "Desktop runtime")?.status).toBe("PASS");
    expect(text).not.toContain("secret-auth-token");
  });

  it("prints diagnostics when invoked through the package script runtime", async () => {
    const temporary = await createTempDir("oh-my-bug-doctor-cli-");
    cleanups.push(temporary.cleanup);
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/doctor.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, OH_MY_BUG_HOME: temporary.path },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    await once(child, "close");

    expect(stdout).toContain("Node.js:");
    expect(stdout).toContain("Runtime database:");
    expect(stdout).toContain("Desktop build:");
    expect(stdout).toContain("Desktop runtime:");
  }, 20_000);
});
