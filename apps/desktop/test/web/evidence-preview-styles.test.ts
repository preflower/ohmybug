import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

let styles = "";

beforeAll(async () => {
  styles = await readFile(resolve(process.cwd(), "src/web/styles/global.css"), "utf8");
});

describe("evidence preview interaction styles", () => {
  it("keeps the close button hover state legible over light evidence", () => {
    expect(styles).toMatch(/\.evidence-preview-toolbar button:hover:not\(:disabled\)\s*\{[^}]*background:\s*rgb\(255 255 255 \/ 12%\);[^}]*color:\s*#fff;/s);
    expect(styles).toMatch(/\.evidence-preview-close:hover\s*\{[^}]*background:\s*rgb\(12 13 16 \/ 96%\);[^}]*color:\s*#f5f5f6;/s);
  });

  it("owns the remaining interactive states of the close button", () => {
    expect(styles).toMatch(/\.evidence-preview-close:focus-visible\s*\{[^}]*border-color:\s*var\(--focus\);[^}]*outline:\s*2px solid var\(--focus\);/s);
    expect(styles).toMatch(/\.evidence-preview-close:active\s*\{[^}]*background:\s*rgb\(255 255 255 \/ 18%\);[^}]*transform:\s*none;[^}]*translate:\s*0 !important;/s);
    expect(styles).toMatch(/\.evidence-preview-close\s*\{[^}]*transition:\s*background-color 120ms ease, border-color 120ms ease, color 120ms ease;/s);
  });

  it("keeps the preview surface stable while the dialog closes", () => {
    expect(styles).toMatch(/\.evidence-preview-dialog\[data-closed\]\s*\{[^}]*animation:\s*none !important;[^}]*transition:\s*none !important;/s);
  });
});
