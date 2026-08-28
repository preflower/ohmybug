import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const concretePackages = [
  "@oh-my-bug/agent-codex",
  "@oh-my-bug/integration-dingtalk",
  "@oh-my-bug/integration-manual",
  "@oh-my-bug/integration-sentry",
  "@oh-my-bug/storage",
] as const;

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".vite", "dist", "coverage", "out"].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe("final monorepo layout", () => {
  it("contains exactly the current application and package workspaces", () => {
    const directories = (path: string) => readdirSync(resolve(root, path), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(directories("apps")).toEqual(["desktop", "runtime"]);
    expect(directories("packages")).toEqual([
      "agent-codex",
      "core",
      "integration-dingtalk",
      "integration-manual",
      "integration-sentry",
      "module-api",
      "storage",
      "workspace-git",
      "workspace-local",
    ]);
  });

  it("exposes exactly the supported root developer commands", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(Object.keys(manifest.scripts ?? {}).sort()).toEqual([
      "build",
      "build:desktop",
      "build:electron",
      "build:web",
      "dev",
      "dev:web",
      "doctor",
      "doctor:package",
      "generate:codex-protocol",
      "lint",
      "make",
      "package",
      "test",
      "test:codex-app-server",
      "test:e2e",
      "test:e2e:electron",
      "test:e2e:electron:release",
      "test:repository",
      "test:workspaces",
      "typecheck",
      "typecheck:repository",
      "typecheck:workspaces",
    ]);
  });

  it("routes dev:web directly to the browser renderer", () => {
    const rootManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const desktopManifest = JSON.parse(
      readFileSync(resolve(root, "apps/desktop/package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(rootManifest.scripts?.["dev:web"]).toBe("pnpm --filter @oh-my-bug/desktop dev:web");
    expect(desktopManifest.scripts?.["dev:web"]).toBe("pnpm dev:renderer");
    expect(desktopManifest.scripts?.["dev:renderer"]).toBe("vite --config vite.config.ts");
  });

  it("keeps every concrete adapter import inside Runtime composition", () => {
    const files = [
      ...sourceFiles(resolve(root, "apps/runtime/src")),
      ...sourceFiles(resolve(root, "apps/desktop/src")),
      ...readdirSync(resolve(root, "packages"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => sourceFiles(resolve(root, "packages", entry.name, "src"))),
    ];
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return concretePackages
        .filter((packageName) => source.includes(`from "${packageName}"`) || source.includes(`from '${packageName}'`))
        .filter(() => file !== resolve(root, "apps/runtime/src/composition.ts"))
        .map((packageName) => `${relative(root, file)} -> ${packageName}`);
    });

    expect(violations).toEqual([]);
  });

  it("lets Desktop depend on Runtime but no concrete backend package", () => {
    const sources = sourceFiles(resolve(root, "apps/desktop/src"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(sources).toContain("@oh-my-bug/runtime");
    for (const packageName of concretePackages) expect(sources).not.toContain(packageName);
    expect(sources).not.toMatch(/src\/(agent|control|domain|server|storage|triggers)/);
  });

});
