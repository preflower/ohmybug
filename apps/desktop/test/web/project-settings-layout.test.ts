// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

let styles = "";

function cssRule(selector: string): string {
  return styles.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "s"))?.[1] ?? "";
}

function cssRuleAfter(marker: string, selector: string): string {
  return styles.slice(styles.indexOf(marker)).match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "s"))?.[1] ?? "";
}

function mediaBlock(startMarker: string, endMarker?: string): string {
  const start = styles.lastIndexOf(startMarker);
  const end = endMarker ? styles.indexOf(endMarker, start) : styles.length;
  return styles.slice(start, end < 0 ? styles.length : end);
}

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
  it("shows project initials only in the collapsed sidebar", () => {
    expect(cssRule("\\.project-initial")).toMatch(/display:\s*none;/);

    const collapsed = mediaBlock("@media (max-width: 980px)", "@media (max-width: 680px)");
    expect(collapsed).toMatch(/\.sidebar-section \.project-dot,\s*\.sidebar-section \.project-name\s*\{[^}]*display:\s*none;/s);
    expect(collapsed).toMatch(/\.sidebar-section \.project-initial\s*\{[^}]*display:\s*grid;/s);
  });

  it("keeps the collapsed project initial unframed", () => {
    const initial = cssRule("\\.project-initial");

    expect(initial).not.toMatch(/background:/);
    expect(initial).not.toMatch(/box-shadow:/);
  });

  it("centers project shortcuts in the collapsed sidebar", () => {
    const collapsed = mediaBlock("@media (max-width: 980px)", "@media (max-width: 680px)");
    const initial = cssRule("\\.project-initial");

    expect(collapsed).toMatch(/\.sidebar-section \.nav-item\s*\{[^}]*justify-content:\s*center;/s);
    expect(initial).toMatch(/place-items:\s*center;/);
    expect(initial).toMatch(/font-size:\s*13px;/);
    expect(initial).toMatch(/line-height:\s*1;/);
  });

  it("uses the full workspace without a card surface", () => {
    const column = getComputedStyle(document.querySelector<HTMLElement>(".settings-column")!);
    const settings = getComputedStyle(document.querySelector<HTMLElement>(".project-settings-tabs")!);

    expect(column.width).toBe("100%");
    expect(column.margin).toBe("0px");
    expect(settings.borderTopWidth).toBe("0px");
    expect(settings.borderRadius).toBe("0px");
    expect(settings.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });

  it("locks the inset Issue metadata card rules", () => {
    const detail = cssRule("\\.issue-detail");
    const detailDocument = cssRule("\\.issue-detail-document");
    const actions = cssRuleAfter(".failure-actions {", "\\.issue-actions");
    const rail = cssRuleAfter("/* Application workbench */", "\\.issue-metadata-rail");
    const card = cssRuleAfter("/* Application workbench */", "\\.issue-metadata-card");
    const metadataRow = cssRuleAfter("/* Application workbench */", "\\.issue-metadata-list > div");

    expect(cssRule("\\.workspace")).toMatch(/grid-template-columns:\s*320px minmax\(0,\s*1fr\);/);
    expect(cssRule("\\.workspace\\.metadata-open")).toMatch(/grid-template-columns:\s*320px minmax\(0,\s*1fr\);/);
    expect(cssRule("\\.detail-pane-scroll")).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\);/);
    expect(detail).toMatch(/position:\s*relative;/);
    expect(detail).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(detail).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/);
    expect(detailDocument).toMatch(/grid-column:\s*1;/);
    expect(detailDocument).toMatch(/grid-row:\s*1;/);
    expect(rail).toMatch(/overflow:\s*visible;/);
    expect(rail).toMatch(/background:\s*transparent;/);
    expect(rail).toMatch(/padding:\s*12px;/);
    expect(rail).toMatch(/box-shadow:\s*none;/);
    expect(rail).toMatch(/grid-column:\s*2;/);
    expect(rail).toMatch(/grid-row:\s*1;/);
    expect(card).toMatch(/max-height:\s*100%;/);
    expect(card).toMatch(/overflow:\s*auto;/);
    expect(card).toMatch(/border:\s*1px solid var\(--border\);/);
    expect(card).toMatch(/border-radius:\s*10px;/);
    expect(card).toMatch(/background:\s*var\(--surface\);/);
    expect(card).toMatch(/box-shadow:\s*0 1px 3px rgb\(0 0 0 \/ 8%\),\s*0 10px 28px rgb\(0 0 0 \/ 10%\);/);
    expect(metadataRow).toMatch(/gap:\s*6px;/);
    expect(metadataRow).toMatch(/padding:\s*16px 0;/);
    expect(cssRule("\\.metadata-rail-header")).toMatch(/height:\s*56px;/);
    expect(cssRule("\\.metadata-rail-header")).not.toMatch(/position:\s*sticky;/);
    expect(actions).toMatch(/grid-column:\s*1 \/ -1;/);
    expect(actions).toMatch(/grid-row:\s*2;/);

    const overlay = mediaBlock("@media (max-width: 1200px) and (min-width: 681px)", "@media (max-width: 900px)");
    expect(overlay).toMatch(/\.workspace\.metadata-open \.issue-detail,\s*\.workspace\.metadata-open \.issue-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
    expect(overlay).toMatch(/\.issue-metadata-rail\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;[^}]*justify-self:\s*end;/s);
    expect(overlay).not.toMatch(/\.issue-metadata-rail\s*\{[^}]*position:\s*absolute;/s);
    expect(overlay).toMatch(/\.issue-metadata-rail\s*\{[^}]*width:\s*min\(280px,\s*calc\(100% - 48px\)\);/s);

    const phone = mediaBlock("@media (max-width: 680px)");
    expect(phone).toMatch(/\.issue-metadata-rail\s*\{[^}]*width:\s*min\(260px,\s*calc\(100% - 40px\)\);/s);
    expect(phone).toMatch(/\.issue-list-back-action\s*\{[^}]*display:\s*inline-flex;/s);
  });

  it("reserves the metadata track only at the wide-screen breakpoint", () => {
    expect(styles).toContain("@media (min-width: 1201px)");
    const wide = mediaBlock("@media (min-width: 1201px)", ".issue-actions-track");
    expect(wide).toMatch(/\.workspace\.metadata-open \.issue-detail,\s*\.workspace\.metadata-open \.issue-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 280px;/s);

    const phone = mediaBlock("@media (max-width: 680px)", ".issue-detail {");
    expect(phone).toMatch(/\.workspace\.metadata-open \.issue-detail,\s*\.workspace\.metadata-open \.issue-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  });

  it("aligns compact Issue actions with the trailing Review actions", () => {
    expect(cssRule("\\.issue-action-row")).toMatch(/justify-content:\s*flex-end;/);
    expect(cssRule("\\.review-dock-row")).toMatch(/justify-content:\s*flex-end;/);
  });

  it("keeps Agent activity turns full width and flattens terminal output", () => {
    expect(styles).toMatch(/\.activity-turn\s*\{[^}]*width:\s*100%;/s);
    expect(styles).toMatch(/\.activity-log-output\s*\{[^}]*box-sizing:\s*border-box;/s);
    expect(styles).toMatch(/\.activity-log-output\s*\{[^}]*width:\s*auto;/s);
    expect(styles).toMatch(/\.activity-log-output\s*\{[^}]*border-radius:\s*0;/s);
    expect(styles).toMatch(/\.activity-log-output\s*\{[^}]*background:\s*transparent;/s);
  });

  it("lets the Issue page own Agent activity scrolling", () => {
    const groups = cssRule("\\.activity-groups");
    const output = cssRule("\\.activity-log-output");

    expect(groups).not.toMatch(/overflow(?:-y)?:\s*(?:auto|scroll)/);
    expect(groups).not.toMatch(/max-height\s*:/);
    expect(output).not.toMatch(/overflow(?:-y)?:\s*(?:auto|scroll)/);
    expect(output).not.toMatch(/max-height\s*:/);
  });

  it("uses the compact product scale across project and integration settings", () => {
    expect(styles).toMatch(/\.project-settings-tabs\s*\{[^}]*grid-template-columns:\s*240px minmax\(0,\s*1fr\);/s);
    expect(styles).toMatch(/\.project-settings-nav \[data-slot="tabs-trigger"\]\s*\{[^}]*height:\s*38px;/s);
    expect(styles).toMatch(/\.project-settings-nav \[data-slot="tabs-trigger"\]\s*\{[^}]*font-size:\s*13px;/s);
    expect(styles).toMatch(/\.project-settings-main\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/s);
    expect(styles).toMatch(/\.project-settings-actions\s*\{[^}]*min-height:\s*54px;/s);
    expect(styles).toMatch(/\.project-settings-actions\s*\{[^}]*flex-wrap:\s*nowrap;/s);
    expect(styles).toMatch(/\.project-settings-actions\s*\{[^}]*box-shadow:\s*none;/s);
    expect(styles).toMatch(/\.project-settings-action-buttons \[data-slot="button"\]\s*\{[^}]*height:\s*30px;/s);
    expect(styles).toMatch(/\.project-path-control \[data-slot="button"\]\s*\{[^}]*height:\s*32px;/s);
    expect(styles).toMatch(/\.integration-heading h2\s*\{[^}]*font-size:\s*20px;/s);
    expect(styles).toMatch(/\.integration-section-fields \[data-slot="input"\]\s*\{[^}]*height:\s*32px;/s);
    expect(styles).toMatch(/\.integration-section-fields \[data-slot="button"\]\s*\{[^}]*min-height:\s*30px;/s);
  });

  it("uses the shared surface hierarchy for project settings", () => {
    expect(cssRule("\\.project-settings-nav")).toMatch(/background:\s*var\(--surface\);/);
    expect(styles).toMatch(/\.project-settings-nav \[data-slot="tabs-trigger"\]:hover\s*\{[^}]*background:\s*var\(--surface-raised\);/s);
    expect(cssRule("\\.project-settings-main")).toMatch(/background:\s*var\(--canvas\);/);
    expect(cssRule("\\.project-settings-actions")).toMatch(/background:\s*var\(--canvas\);/);
  });

  it("does not apply a DingTalk-specific scale", () => {
    expect(styles).not.toMatch(/\[data-brand-icon="dingtalk"\]\s*\{/s);
  });

  it("aligns the advanced disclosure indicator with the title line", () => {
    expect(styles).toMatch(/\.integration-section-collapsed > summary\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*7px minmax\(0,\s*1fr\) auto;/s);
    expect(styles).toMatch(/\.integration-section-collapsed > summary::before\s*\{[^}]*margin-top:\s*8px;/s);
    expect(styles).toMatch(/\.integration-section-collapsed \.integration-section-summary-inline\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1;/s);
    expect(styles).toMatch(/\.integration-section-collapsed \.integration-section-summary-inline\s*\{[^}]*max-width:\s*min\(40vw,\s*360px\);[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s);
  });

  it("stacks the advanced disclosure summary in the content column on phones", () => {
    const phoneStart = styles.lastIndexOf("@media (max-width: 520px)");
    const phoneEnd = styles.indexOf("@media (max-width: 1200px)", phoneStart);
    const phone = styles.slice(phoneStart, phoneEnd);

    expect(phone).toMatch(/\.integration-section-collapsed > summary\s*\{[^}]*grid-template-columns:\s*7px minmax\(0,\s*1fr\);/s);
    expect(phone).toMatch(/\.integration-section-collapsed \.integration-section-summary-inline\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;/s);
    expect(phone).toMatch(/\.integration-section-collapsed \.integration-section-summary-inline\s*\{[^}]*max-width:\s*none;[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/s);
  });

  it("keeps the narrow settings workspace full-height until the phone breakpoint", () => {
    const narrowStart = styles.lastIndexOf("@media (max-width: 800px)");
    const narrowEnd = styles.indexOf("@media (max-width: 520px)", narrowStart);
    const narrow = styles.slice(narrowStart, narrowEnd);
    const phoneStart = styles.lastIndexOf("@media (max-width: 520px)");
    const phone = styles.slice(phoneStart);

    expect(narrow).toMatch(/\.project-settings-tabs\s*\{[^}]*height:\s*100%;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s);
    expect(narrow).toMatch(/\.project-settings-main\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/s);
    expect(narrow).toMatch(/\.project-settings-content\s*\{[^}]*overflow:\s*auto;/s);
    expect(narrow).toMatch(/\.project-settings-actions\s*\{[^}]*position:\s*static;/s);
    expect(narrow).not.toContain(".integration-section-fields > fieldset,");
    expect(phoneStart).toBeGreaterThan(narrowStart);
    expect(phone).toContain(".integration-section-fields > fieldset,");
  });
});
