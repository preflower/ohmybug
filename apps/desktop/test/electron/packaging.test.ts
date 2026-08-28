import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import forgeConfig, {
  createForgeConfig,
  resolveMacSigningConfig,
} from "../../forge.config.js";
import {
  desktopAsarUnpackPattern,
  desktopBuildLayout,
  resolveRuntimeResources,
} from "../../scripts/packaged-runtime.js";
import { createTempDir } from "../../../../test/helpers/temp-dir.js";

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
    const agentManifest = JSON.parse(readFileSync(
      resolve(repositoryRoot, "packages/agent-codex/package.json"),
      "utf8",
    )) as { dependencies?: Record<string, string> };
    const legacySdk = ["@openai", "codex-sdk"].join("/");
    expect(manifest).not.toHaveProperty(`dependencies.${legacySdk}`);
    expect(agentManifest).not.toHaveProperty(`dependencies.${legacySdk}`);
  });

  it("packages only compiled desktop entry points and the local renderer", () => {
    expect(desktopBuildLayout).toMatchObject({
      main: ".vite/build/apps/desktop/src/electron/main.js",
      preload: ".vite/build/apps/desktop/src/electron/preload.cjs",
      runtimeEntry: ".vite/build/node_modules/@oh-my-bug/runtime/src/entry.js",
      codexProtocolSchema: ".vite/build/node_modules/@oh-my-bug/agent-codex/protocol/codex_app_server_protocol.schemas.json",
      codexProtocolVersion: ".vite/build/node_modules/@oh-my-bug/agent-codex/protocol/version.json",
      renderer: ".vite/renderer/index.html",
      trayIcon: ".vite/build/apps/desktop/assets/icons/oh-my-bug-trayTemplate.png",
      trayIcon2x: ".vite/build/apps/desktop/assets/icons/oh-my-bug-trayTemplate@2x.png",
      trayStatusFailure: ".vite/build/apps/desktop/assets/icons/tray-status-failure.png",
      trayStatusFailure2x: ".vite/build/apps/desktop/assets/icons/tray-status-failure@2x.png",
      trayStatusReview: ".vite/build/apps/desktop/assets/icons/tray-status-review.png",
      trayStatusReview2x: ".vite/build/apps/desktop/assets/icons/tray-status-review@2x.png",
      trayStatusProcessing: ".vite/build/apps/desktop/assets/icons/tray-status-processing.png",
      trayStatusProcessing2x: ".vite/build/apps/desktop/assets/icons/tray-status-processing@2x.png",
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

    expect(asar).toEqual({ unpack: desktopAsarUnpackPattern });
    expect(desktopAsarUnpackPattern).toContain("*.node");
    expect(desktopAsarUnpackPattern).toContain("codex");
    expect(desktopAsarUnpackPattern).not.toContain("/");
    expect(config.packagerConfig?.extraResource).toContain(resources.chromium.source);
    expect(basename(resources.chromium.source)).toBe(resources.chromium.resourceName);
    expect(basename(resources.codexProtocolSchema)).toBe("codex_app_server_protocol.schemas.json");
    expect(basename(resources.codexProtocolVersion)).toBe("version.json");
    expect(config.makers?.map((maker) => "name" in maker ? maker.name : maker.constructor.name)).toEqual([
      "@electron-forge/maker-zip",
      "@electron-forge/maker-dmg"
    ]);
    expect(forgeConfig.packagerConfig?.asar).toEqual(asar);
  });

  it("preserves internal package and executable names", () => {
    const config = createForgeConfig(resolveRuntimeResources());

    expect(config.packagerConfig?.name).toBe("Oh My Bug");
    expect(config.packagerConfig?.executableName).toBe("Oh My Bug");
    expect(config.packagerConfig?.afterCopyExtraResources).toHaveLength(1);
  });

  it.skipIf(process.platform !== "darwin")(
    "sets the complete macOS display name before signing",
    async () => {
      const config = createForgeConfig(resolveRuntimeResources());
      const temporary = await createTempDir("oh-my-bug-packaging-brand-");
      const infoPath = join(temporary.path, "Oh My Bug.app", "Contents", "Info.plist");

      try {
        await mkdir(join(temporary.path, "Oh My Bug.app", "Contents"), { recursive: true });
        await writeFile(infoPath, [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
          '<plist version="1.0"><dict>',
          '<key>CFBundleDisplayName</key><string>Oh My Bug</string>',
          '</dict></plist>',
        ].join("\n"));

        const hooks = config.packagerConfig?.afterCopyExtraResources;
        if (!hooks?.[0]) return;

        await new Promise<void>((resolvePromise, rejectPromise) => {
          hooks[0]?.(
            temporary.path,
            "43.4.1",
            "darwin",
            "arm64",
            (error) => {
              if (error) rejectPromise(error);
              else resolvePromise();
            },
          );
        });
        expect(await readFile(infoPath, "utf8")).toContain(
          '<string>Oh My Bug ?!</string>',
        );
      } finally {
        await temporary.cleanup();
      }
    },
  );

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

  it("enables macOS signing and notarization only for an explicit release build", () => {
    expect(resolveMacSigningConfig({})).toEqual({});
    expect(resolveMacSigningConfig({
      OMB_MACOS_SIGN: "1",
      APPLE_API_KEY: "/private/tmp/AuthKey.p8",
      APPLE_API_KEY_ID: "ABCDEFGHIJ",
      APPLE_API_ISSUER: "12345678-1234-1234-1234-123456789012",
    })).toEqual({
      osxSign: {},
      osxNotarize: {
        appleApiKey: "/private/tmp/AuthKey.p8",
        appleApiKeyId: "ABCDEFGHIJ",
        appleApiIssuer: "12345678-1234-1234-1234-123456789012",
      },
    });
    expect(() => resolveMacSigningConfig({ OMB_MACOS_SIGN: "1" })).toThrow(
      "OMB_MACOS_SIGN_REQUIRES:APPLE_API_KEY,APPLE_API_KEY_ID,APPLE_API_ISSUER",
    );
  });
});
