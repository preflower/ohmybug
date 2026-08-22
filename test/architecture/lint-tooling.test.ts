import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("repository lint tooling", () => {
  it("uses Oxlint as the only repository linter", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const developmentDependencies = Object.keys(manifest.devDependencies ?? {});
    const eslintDependencies = developmentDependencies.filter((name) =>
      name === "eslint"
      || name === "typescript-eslint"
      || name.startsWith("eslint-")
      || name.startsWith("@eslint/"),
    );

    expect(manifest.scripts?.lint).toBe("oxlint .");
    expect(manifest.devDependencies?.oxlint).toBeDefined();
    expect(eslintDependencies).toEqual([]);
    expect(existsSync(resolve(root, ".oxlintrc.json"))).toBe(true);
    expect(existsSync(resolve(root, "eslint.config.js"))).toBe(false);
  });

  it("ignores generated private agent temp directories", () => {
    const config = JSON.parse(
      readFileSync(resolve(root, ".oxlintrc.json"), "utf8"),
    ) as { ignorePatterns?: string[] };

    expect(config.ignorePatterns).toContain(".oh-my-bug-tmp-*");
  });
});
