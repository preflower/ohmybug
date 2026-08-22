import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const desktopRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(desktopRoot, "../..");

describe("Desktop workspace layout", () => {
  it("is independently addressable as the Desktop workspace", () => {
    const manifest = JSON.parse(readFileSync(resolve(desktopRoot, "package.json"), "utf8")) as {
      name?: string;
      scripts?: Record<string, string>;
    };

    expect(manifest.name).toBe("@oh-my-bug/desktop");
    expect(manifest.scripts).toMatchObject({
      "build:web": "vite build --config vite.config.ts",
      test: "vitest run --config vitest.config.ts",
      typecheck: "tsc --noEmit -p tsconfig.json",
    });
  });

  it("has no duplicate Desktop ownership at the repository root", () => {
    const oldPaths = [
      "src/electron",
      "src/web",
      "src/vite-env.d.ts",
      "test/electron",
      "test/web",
      "index.html",
      "vite.config.ts",
      "forge.config.ts",
      "playwright.electron.config.ts",
      "tsconfig.electron.json",
      "assets/icons",
      "public",
    ];

    expect(oldPaths.filter((path) => existsSync(resolve(repositoryRoot, path)))).toEqual([]);
  });

  it("runs Desktop exactly once in root workspace verification", () => {
    const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    for (const scriptName of ["test:workspaces", "typecheck:workspaces"]) {
      const script = manifest.scripts?.[scriptName] ?? "";
      expect(script.match(/--filter @oh-my-bug\/desktop/g) ?? []).toHaveLength(1);
    }
  });
});
