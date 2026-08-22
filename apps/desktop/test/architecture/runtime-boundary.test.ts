import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const desktopRoot = resolve(import.meta.dirname, "../..");
const sourceRoot = resolve(desktopRoot, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function resolvesToSource(importer: string, specifier: string): boolean {
  const target = resolve(dirname(importer), specifier);
  const candidates = [target, target.replace(/\.js$/, ".ts"), target.replace(/\.js$/, ".tsx")];
  return candidates.some((candidate) => existsSync(candidate));
}

describe("Desktop Runtime boundary", () => {
  it("keeps the Runtime package surface limited to its root API and public protocol", () => {
    const manifest = JSON.parse(readFileSync(resolve(desktopRoot, "../runtime/package.json"), "utf8")) as {
      exports?: Record<string, string>;
    };

    expect(manifest.exports).toEqual({
      ".": "./src/index.ts",
      "./protocol": "./src/protocol/index.ts",
    });
  });

  it("keeps Desktop self-contained and depends on Runtime through its package API", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
      const source = readFileSync(file, "utf8");
      const specifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]!);
      for (const specifier of specifiers) {
        if (!specifier.startsWith(".")) continue;
        const target = resolve(dirname(file), specifier);
        if (!target.startsWith(`${desktopRoot}/`) || !resolvesToSource(file, specifier)) {
          violations.push(`${relative(desktopRoot, file)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
    for (const file of sourceFiles(sourceRoot)) {
      const source = readFileSync(file, "utf8");
      const specifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
        .map((match) => match[1]!);
      for (const specifier of specifiers.filter((entry) => entry.startsWith("@oh-my-bug/runtime"))) {
        expect(specifier).toBe("@oh-my-bug/runtime/protocol");
      }
    }
    expect(existsSync(resolve(sourceRoot, "electron/utility.ts"))).toBe(false);
  });
});
