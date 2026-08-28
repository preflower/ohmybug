import { resolve } from "node:path";
import type { ForgeConfig } from "@electron-forge/shared-types";

import {
  desktopAsarUnpackPattern,
  resolveRuntimeResources,
  type RuntimeResources,
} from "./scripts/packaged-runtime.js";

interface ForgeConfigOptions {
  development?: boolean;
}

const macSigningEnvironmentVariables = [
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
] as const;

export function resolveMacSigningConfig(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.OMB_MACOS_SIGN !== "1") return {};

  const missing = macSigningEnvironmentVariables.filter((name) => !environment[name]);
  if (missing.length > 0) {
    throw new Error(`OMB_MACOS_SIGN_REQUIRES:${missing.join(",")}`);
  }

  return {
    osxSign: {},
    osxNotarize: {
      appleApiKey: environment.APPLE_API_KEY as string,
      appleApiKeyId: environment.APPLE_API_KEY_ID as string,
      appleApiIssuer: environment.APPLE_API_ISSUER as string,
    },
  };
}

export function createForgeConfig(
  resources: RuntimeResources,
  options: ForgeConfigOptions = {}
): ForgeConfig {
  return {
    packagerConfig: {
      name: "Oh My Bug",
      executableName: "Oh My Bug",
      icon: resolve(import.meta.dirname, "assets/icons/oh-my-bug.icns"),
      appBundleId: "com.ohmybug.desktop",
      appCategoryType: "public.app-category.developer-tools",
      ...resolveMacSigningConfig(),
      asar: {
        unpack: desktopAsarUnpackPattern
      },
      extraResource: [resources.chromium.source],
      ignore: [
        /^\/(?:apps|packages|src|test|docs|scripts)(?:\/|$)/,
        /^\/(?:dist|coverage|playwright-report|test-results|\.acceptance|\.pnpm-store|output)(?:\/|$)/,
        /^\/(?:tsconfig(?:\.[^/]+)?\.json|vite\.config\.ts|vitest\.config\.ts|playwright\.config\.ts|\.oxlintrc\.json|forge\.config\.ts)$/
      ],
      overwrite: true
    },
    rebuildConfig: { force: true },
    makers: [
      { name: "@electron-forge/maker-zip", platforms: ["darwin"], config: {} },
      { name: "@electron-forge/maker-dmg", platforms: ["darwin"], config: { format: "ULFO" } }
    ],
    ...(options.development ? {
      plugins: [{
        name: "@electron-forge/plugin-vite",
        config: {
          build: [{
            entry: "apps/desktop/scripts/dev-electron-bootstrap.ts",
            config: "apps/desktop/vite.electron-bootstrap.config.ts"
          }],
          renderer: [{ name: "main_window", config: "apps/desktop/vite.config.ts" }]
        }
      }]
    } : {})
  };
}

const forgeConfig = createForgeConfig(resolveRuntimeResources(), {
  development: process.env.OMB_VITE_DEV === "1"
});

export default forgeConfig;
