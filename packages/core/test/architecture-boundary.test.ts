import {
  readdirSync,
  readFileSync,
} from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const workspaceSourceRoots = [
  "packages/core/src",
  "packages/agent-codex/src",
  "packages/integration-dingtalk/src",
  "packages/integration-manual/src",
  "packages/integration-sentry/src",
  "packages/storage/src",
  "apps/runtime/src",
] as const;
const packageJsonPath = fileURLToPath(
  new URL("../package.json", import.meta.url),
);
const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : sourceExtensions.has(extname(path))
        ? [path]
        : [];
  });
}

function importSpecifiers(source: string): string[] {
  const staticImports = [
    ...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g),
  ];
  const dynamicImports = [
    ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
  ];
  return [...staticImports, ...dynamicImports]
    .map((match) => match[1])
    .filter((specifier): specifier is string => Boolean(specifier));
}

function workspaceExternalImports(relativeSourceRoot: string): string[] {
  const directory = resolve(workspaceRoot, relativeSourceRoot);
  const imports = sourceFiles(directory)
    .flatMap((path) => importSpecifiers(readFileSync(path, "utf8")))
    .filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("node:"));
  return [...new Set(imports)].sort();
}

function workspaceRelativeEscapes(): Array<{ path: string; specifier: string }> {
  return workspaceSourceRoots.flatMap((relativeSourceRoot) => {
    const directory = resolve(workspaceRoot, relativeSourceRoot);
    return sourceFiles(directory).flatMap((path) =>
      importSpecifiers(readFileSync(path, "utf8"))
        .filter((specifier) => specifier.startsWith("."))
        .filter((specifier) => {
          const target = resolve(dirname(path), specifier);
          const fromPackage = relative(directory, target);
          return fromPackage === ".." || fromPackage.startsWith("../") || isAbsolute(fromPackage);
        })
        .map((specifier) => ({ path: relative(workspaceRoot, path), specifier })),
    );
  });
}

describe("Core architecture boundary", () => {
  it("has zod as its only runtime dependency", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual(["zod"]);
  });

  it("imports only zod or Node built-ins outside its own files", () => {
    const imports = sourceFiles(sourceRoot)
      .flatMap((path) => importSpecifiers(readFileSync(path, "utf8")))
      .filter(
        (specifier) =>
          !specifier.startsWith(".") && !specifier.startsWith("node:"),
      );

    expect([...new Set(imports)].sort()).toEqual(["zod"]);
  });

  it("keeps every relative import inside the Core source tree", () => {
    const escapes = sourceFiles(sourceRoot).flatMap((path) =>
      importSpecifiers(readFileSync(path, "utf8"))
        .filter((specifier) => specifier.startsWith("."))
        .filter((specifier) => {
          const target = resolve(dirname(path), specifier);
          const fromCore = relative(sourceRoot, target);
          return (
            fromCore === ".." ||
            fromCore.startsWith("../") ||
            isAbsolute(fromCore)
          );
        })
        .map((specifier) => ({ path, specifier })),
    );

    expect(escapes).toEqual([]);
  });
});

describe("workspace architecture boundaries", () => {
  it("keeps the approved one-way external imports", () => {
    expect(workspaceExternalImports("packages/core/src")).toEqual(["zod"]);
    expect(workspaceExternalImports("packages/integration-manual/src")).toEqual([
      "@oh-my-bug/core",
    ]);
    expect(workspaceExternalImports("packages/agent-codex/src")).toEqual([
      "@oh-my-bug/core",
      "@openai/codex-sdk",
    ]);
    expect(workspaceExternalImports("packages/integration-sentry/src")).toEqual([
      "@oh-my-bug/core",
    ]);
    expect(workspaceExternalImports("packages/integration-dingtalk/src")).toEqual([
      "@oh-my-bug/core",
      "dingtalk-stream",
    ]);
    expect(workspaceExternalImports("packages/storage/src")).toEqual([
      "@oh-my-bug/core",
      "better-sqlite3",
      "cross-keychain",
      "mediainfo.js",
      "playwright",
      "sharp",
    ]);
    expect(workspaceExternalImports("apps/runtime/src")).toEqual([
      "@oh-my-bug/agent-codex",
      "@oh-my-bug/core",
      "@oh-my-bug/integration-dingtalk",
      "@oh-my-bug/integration-manual",
      "@oh-my-bug/integration-sentry",
      "@oh-my-bug/storage",
      "sharp",
      "zod",
    ]);
  });

  it("keeps every relative source import inside its own package", () => {
    expect(workspaceRelativeEscapes()).toEqual([]);
  });
});
