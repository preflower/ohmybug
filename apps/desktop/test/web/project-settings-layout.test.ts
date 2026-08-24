// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

let styles = "";

beforeAll(async () => {
  styles = await readFile(resolve(process.cwd(), "src/web/styles/global.css"), "utf8");
  document.head.innerHTML = `<style>${styles}</style>`;
  document.body.style.setProperty("--surface", "rgb(24, 25, 28)");
  document.body.innerHTML = `
    <section class="page-scroll">
      <div class="settings-column">
        <div class="project-settings-tabs"></div>
      </div>
    </section>
  `;
});

describe("project settings layout", () => {
  it("uses the full workspace without a card surface", () => {
    const column = getComputedStyle(document.querySelector<HTMLElement>(".settings-column")!);
    const settings = getComputedStyle(document.querySelector<HTMLElement>(".project-settings-tabs")!);

    expect(column.width).toBe("100%");
    expect(column.margin).toBe("0px");
    expect(settings.borderTopWidth).toBe("0px");
    expect(settings.borderRadius).toBe("0px");
    expect(settings.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });

  it("locks sticky metadata and full-width activity detail rules", () => {
    expect(styles).toMatch(/\.metadata-rail-header\s*\{[^}]*position:\s*sticky;/s);
    expect(styles).toMatch(/\.metadata-rail-header\s*\{[^}]*top:\s*0;/s);
    expect(styles).toMatch(/\.activity-turn\s*\{[^}]*width:\s*100%;/s);
    expect(styles).toMatch(/\.activity-log-output\s*\{[^}]*box-sizing:\s*border-box;/s);
    expect(styles).toMatch(/\.activity-log-output\s*\{[^}]*width:\s*100%;/s);
  });

  it("keeps a quiet single-row footer inside the right settings column", () => {
    expect(styles).toMatch(/\.project-settings-main\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/s);
    expect(styles).toMatch(/\.project-settings-actions\s*\{[^}]*min-height:\s*54px;/s);
    expect(styles).toMatch(/\.project-settings-actions\s*\{[^}]*flex-wrap:\s*nowrap;/s);
    expect(styles).toMatch(/\.project-settings-actions\s*\{[^}]*box-shadow:\s*none;/s);
    expect(styles).toMatch(/\.project-path-control \[data-slot="button"\]\s*\{[^}]*height:\s*32px;/s);
  });
});
