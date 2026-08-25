import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

let styles = "";

beforeAll(async () => {
  styles = await readFile(resolve(process.cwd(), "src/web/styles/global.css"), "utf8");
});

describe("sidebar layout", () => {
  it("keeps the New Issue label left and icon right until the sidebar collapses", () => {
    expect(styles).toMatch(/\.new-issue\s*\{[^}]*justify-content:\s*space-between;/s);
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*980px\)[\s\S]*?\.new-issue\s*\{[^}]*justify-content:\s*center;/,
    );
  });
});
