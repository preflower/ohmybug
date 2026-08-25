import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const featureFiles = [
  "src/web/app.tsx",
  "src/web/command/command-menu.tsx",
  "src/web/dialogs/new-issue-dialog.tsx",
  "src/web/issues/agent-activity.tsx",
  "src/web/issues/review-panel.tsx",
  "src/web/issues/issue-detail.tsx",
  "src/web/projects/integration-fields.tsx",
  "src/web/projects/project-form.tsx",
  "src/web/settings/theme-selector.tsx",
];

describe("shadcn interaction boundary", () => {
  it("keeps reusable native controls behind checked-in UI primitives", () => {
    for (const file of featureFiles) {
      const source = readFileSync(
        resolve(import.meta.dirname, "../..", file),
        "utf8",
      );
      expect(source, file).not.toMatch(/<(button|input|select|textarea)(?:\s|>)/);
    }
  });

  it("does not restore legacy generic control classes", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../src/web/styles/global.css"),
      "utf8",
    );
    expect(source).not.toMatch(
      /\.(primary-button|secondary-button|icon-button|modal-backdrop)\b/,
    );
  });

  it("disables overlay motion when the operating system requests it", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../src/web/styles/global.css"),
      "utf8",
    );
    const reducedMotion = source.match(
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/,
    )?.[1];

    expect(reducedMotion).toContain('[data-slot="dialog-content"]');
    expect(reducedMotion).toContain('[data-slot="dialog-overlay"]');
    expect(reducedMotion).toMatch(/animation:\s*none\s*!important/);
  });
});
