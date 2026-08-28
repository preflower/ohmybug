import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function requiredText(path: string): string {
  const absolutePath = resolve(root, path);
  expect(existsSync(absolutePath), `${path} must exist`).toBe(true);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

describe("release automation", () => {
  it("versions the root Electron application with Release Please", () => {
    const manifest = JSON.parse(requiredText("package.json")) as {
      version: string;
    };
    const releaseConfig = JSON.parse(requiredText("release-please-config.json")) as {
      packages?: Record<string, {
        "release-type"?: string;
        "package-name"?: string;
      }>;
      "include-component-in-tag"?: boolean;
      "include-v-in-tag"?: boolean;
    };
    const releaseManifest = JSON.parse(requiredText(".release-please-manifest.json")) as {
      "."?: string;
    };

    expect(releaseConfig.packages?.["."]).toMatchObject({
      "release-type": "node",
      "package-name": "oh-my-bug",
    });
    expect(releaseConfig["include-component-in-tag"]).toBe(true);
    expect(releaseConfig["include-v-in-tag"]).toBe(true);
    expect(releaseManifest["."]).toBe(manifest.version);
    expect(requiredText("CHANGELOG.md")).toContain("# Changelog");
  });

  it("runs the repository gates for pull requests and main", () => {
    const workflow = requiredText(".github/workflows/ci.yml");

    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toMatch(/branches:\s*\[main\]/);
    expect(workflow).toContain("runs-on: macos-15");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm exec playwright install chromium");
    for (const command of [
      "pnpm typecheck",
      "pnpm lint",
      "pnpm test",
      "pnpm build:desktop",
    ]) {
      expect(workflow).toContain(command);
    }
  });

  it("installs workflow dependencies from the npm registry", () => {
    const lockfile = requiredText("pnpm-lock.yaml");

    expect(lockfile).not.toContain("cnpmjs.org");
    for (const path of [
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
    ]) {
      expect(requiredText(path)).toContain(
        "registry-url: https://registry.npmjs.org",
      );
    }
  });

  it("packages a signed macOS arm64 release after Release Please publishes", () => {
    const manifest = JSON.parse(requiredText("package.json")) as {
      scripts?: Record<string, string>;
    };
    const workflow = requiredText(".github/workflows/release.yml");
    const packageJob = workflow.split("  package-macos:")[1] ?? "";
    const packageJobEnvironment = packageJob.split("    steps:")[0] ?? "";

    expect(workflow).toContain("actions/create-github-app-token@");
    expect(workflow).toContain("RELEASE_APP_ID");
    expect(workflow).toContain("RELEASE_APP_PRIVATE_KEY");
    expect(workflow).toContain("googleapis/release-please-action@");
    expect(workflow).toContain("token: ${{ steps.app-token.outputs.token }}");
    expect(workflow).toContain("release_created");
    expect(workflow).toContain("tag_name");
    expect(workflow).toContain("runs-on: macos-15");
    expect(workflow).toContain("apple-actions/import-codesign-certs@");
    expect(workflow).toContain("OMB_MACOS_SIGN: \"1\"");
    expect(workflow).toContain("pnpm make");
    expect(workflow).toContain("codesign --verify --deep --strict");
    expect(workflow).toContain("spctl --assess --type execute");
    expect(workflow).toContain("xcrun stapler validate");
    expect(workflow).toContain("pnpm doctor:package");
    expect(workflow).toContain("pnpm test:e2e:electron:release");
    expect(workflow).toContain("SHA256SUMS.txt");
    expect(workflow).toContain('dmgs=()');
    expect(workflow).toContain('zips=()');
    expect(workflow).toContain('name "*.dmg"');
    expect(workflow).toContain('name "*.zip"');
    expect(workflow).toContain('release-assets');
    expect(workflow).toContain('basename "$artifact"');
    expect(workflow).toContain("shasum -a 256 *.dmg *.zip > SHA256SUMS.txt");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain('const expectedTag = `oh-my-bug-v${version}`;');
    expect(manifest.scripts?.["test:e2e:electron:release"]).toContain(
      "first-project.spec.ts",
    );
    expect(manifest.scripts?.["test:e2e:electron:release"]).toContain(
      "lifecycle.spec.ts",
    );
    expect(packageJobEnvironment).not.toContain("GH_TOKEN");
    expect(packageJobEnvironment).not.toContain("APPLE_API_KEY_ID");
    expect(workflow.indexOf("- name: Test")).toBeLessThan(
      workflow.indexOf("- name: Import Developer ID certificate"),
    );
  });

  it("pins every third-party action to an immutable commit", () => {
    for (const path of [
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
    ]) {
      const workflow = requiredText(path);
      const actionRefs = [...workflow.matchAll(/^\s*uses:\s+\S+@([^\s#]+)/gm)]
        .map((match) => match[1]);

      expect(actionRefs.length).toBeGreaterThan(0);
      for (const ref of actionRefs) {
        expect(ref, `${path} action ref ${ref}`).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });

  it("keeps release operations out of the product README", () => {
    const readme = requiredText("README.md");

    expect(readme).not.toContain("## 自动发版");
    expect(readme).not.toContain("test:e2e:electron:release");
    for (const secret of [
      "MACOS_CERTIFICATE_P12_BASE64",
      "MACOS_CERTIFICATE_PASSWORD",
      "APPLE_API_KEY_P8_BASE64",
      "APPLE_API_KEY_ID",
      "APPLE_API_ISSUER",
      "RELEASE_APP_ID",
      "RELEASE_APP_PRIVATE_KEY",
    ]) {
      expect(readme).not.toContain(secret);
    }
  });
});
