import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

let styles = "";

function extractBalancedBlock(source: string, header: RegExp): string {
  const match = header.exec(source);
  if (!match) throw new Error(`CSS block not found: ${header.source}`);

  const openingBrace = source.indexOf("{", match.index + match[0].length);
  if (openingBrace === -1) throw new Error(`CSS block has no opening brace: ${header.source}`);

  let depth = 1;
  for (let index = openingBrace + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;

    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`CSS block has no closing brace: ${header.source}`);
}

beforeAll(async () => {
  styles = await readFile(resolve(process.cwd(), "src/web/styles/global.css"), "utf8");
});

describe("sidebar layout", () => {
  it("keeps the New Issue label left and icon right until the sidebar collapses", () => {
    expect(styles).toMatch(/\.new-issue\s*\{[^}]*justify-content:\s*space-between;/s);
    const collapsedMedia = extractBalancedBlock(
      styles,
      /@media\s*\(max-width:\s*980px\)/,
    );
    expect(collapsedMedia).toMatch(/\.new-issue\s*\{[^}]*justify-content:\s*center;/s);
  });
});
