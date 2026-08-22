// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  const styles = await readFile(resolve(process.cwd(), "src/web/styles/global.css"), "utf8");
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
});
