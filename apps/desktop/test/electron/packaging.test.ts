import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import forgeConfig, { createForgeConfig } from "../../forge.config.js";
import { desktopBuildLayout, resolveRuntimeResources } from "../../scripts/packaged-runtime.js";

const desktopRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(desktopRoot, "../..");

describe("Electron packaging", () => {
  it("allows the native packages required by the app and DMG maker to build", () => {
    const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
      config?: { forge?: string };
    };
    const workspace = readFileSync(resolve(repositoryRoot, "pnpm-workspace.yaml"), "utf8");

    expect(manifest.config?.forge).toBe("apps/desktop/forge.config.ts");
    for (const packageName of ["better-sqlite3", "esbuild", "fs-xattr", "macos-alias"]) {
      expect(workspace).toMatch(new RegExp(`^  ${packageName}: true$`, "m"));
    }
  });

  it("packages only compiled desktop entry points and the local renderer", () => {
    expect(desktopBuildLayout).toMatchObject({
      main: ".vite/build/apps/desktop/src/electron/main.js",
      preload: ".vite/build/apps/desktop/src/electron/preload.cjs",
      runtimeEntry: ".vite/build/node_modules/@oh-my-bug/runtime/src/entry.js",
      renderer: ".vite/renderer/index.html",
      trayIcon: ".vite/build/apps/desktop/assets/icons/oh-my-bug-trayTemplate.png",
      trayIcon2x: ".vite/build/apps/desktop/assets/icons/oh-my-bug-trayTemplate@2x.png",
    });
    expect(Object.values(desktopBuildLayout).join(" ")).not.toContain("localhost");
    const mainUrl = pathToFileURL(resolve(repositoryRoot, desktopBuildLayout.main));
    expect(new URL("../../../../../renderer/index.html", mainUrl).pathname).toBe(
      pathToFileURL(resolve(repositoryRoot, desktopBuildLayout.renderer)).pathname
    );
  });

  it("uses ASAR with explicit native and executable unpack rules", () => {
    const resources = resolveRuntimeResources();
    const config = createForgeConfig(resources);
    const asar = config.packagerConfig?.asar;

    expect(asar).toEqual(expect.objectContaining({
      unpack: expect.stringContaining("*.node")
    }));
    expect(JSON.stringify(asar)).toContain("vendor/**/bin/*");
    expect(config.packagerConfig?.extraResource).toContain(resources.chromium.source);
    expect(basename(resources.chromium.source)).toBe(resources.chromium.resourceName);
    expect(config.makers?.map((maker) => "name" in maker ? maker.name : maker.constructor.name)).toEqual([
      "@electron-forge/maker-zip",
      "@electron-forge/maker-dmg"
    ]);
    expect(forgeConfig.packagerConfig?.asar).toEqual(asar);
  });

  it("enables the official Vite renderer dev server only for Desktop development", () => {
    const resources = resolveRuntimeResources();
    const development = createForgeConfig(resources, { development: true });
    const production = createForgeConfig(resources, { development: false });

    expect(development.plugins).toEqual([{
      name: "@electron-forge/plugin-vite",
      config: {
        build: [{
          entry: "apps/desktop/scripts/dev-electron-bootstrap.ts",
          config: "apps/desktop/vite.electron-bootstrap.config.ts",
        }],
        renderer: [{
          name: "main_window",
          config: "apps/desktop/vite.config.ts",
        }],
      },
    }]);
    expect(production.plugins).toBeUndefined();
  });

  it("excludes source workspaces and generated local stores from the application bundle", () => {
    const ignore = createForgeConfig(resolveRuntimeResources()).packagerConfig?.ignore;
    expect(ignore).toBeInstanceOf(Array);
    const patterns = ignore as RegExp[];
    for (const path of [
      "/apps/desktop/src",
      "/packages/core/src",
      "/.oxlintrc.json",
      "/.pnpm-store/v10",
      "/output/imagegen",
    ]) {
      expect(patterns.some((pattern) => pattern.test(path)), path).toBe(true);
    }
  });

  it("packages the branded macOS application icon", () => {
    const resources = resolveRuntimeResources();
    const config = createForgeConfig(resources);
    const iconPath = resolve(desktopRoot, "assets/icons/oh-my-bug.icns");

    expect(config.packagerConfig?.icon).toBe(iconPath);
    expect(existsSync(iconPath)).toBe(true);

    const icon = readFileSync(iconPath);
    expect(icon.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(icon.readUInt32BE(4)).toBe(icon.length);

    const iconTypes: string[] = [];
    for (let offset = 8; offset < icon.length;) {
      iconTypes.push(icon.subarray(offset, offset + 4).toString("ascii"));
      const chunkLength = icon.readUInt32BE(offset + 4);
      expect(chunkLength).toBeGreaterThan(8);
      offset += chunkLength;
      expect(offset).toBeLessThanOrEqual(icon.length);
    }
    expect(iconTypes).toEqual(expect.arrayContaining(["icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10"]));
  });
});
