import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const productName = ["Oh", "My", "Bug", "?!"].join(" ");
const bareProductName = ["Oh", "My", "Bug"].join(" ");

function isHumanFacingPath(path: string): boolean {
  return path.endsWith(".md")
    || path === ".env.example"
    || path === "apps/desktop/index.html"
    || path.startsWith("apps/desktop/src/")
    || path === "packages/agent-codex/src/app-server/rpc-client.ts"
    || path === "packages/integration-sentry/src/plugin.ts";
}

describe("product brand", () => {
  it("uses the complete product name in metadata and human-facing text", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      productName?: string;
    };
    expect(manifest.productName).toBe(productName);

    const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
    }).split("\0").filter(isHumanFacingPath);
    const incompleteMentions: string[] = [];

    for (const path of trackedFiles) {
      const contents = readFileSync(resolve(root, path));
      if (contents.includes(0)) continue;

      const matcher = new RegExp(`${bareProductName}(?! \\?!)`);
      contents.toString("utf8").split("\n").forEach((line, index) => {
        if (matcher.test(line)) incompleteMentions.push(`${path}:${index + 1}`);
      });
    }

    expect(incompleteMentions).toEqual([]);
  });
});
