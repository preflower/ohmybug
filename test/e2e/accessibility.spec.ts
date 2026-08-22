import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "./runtime-protocol-fixture.js";

import { registerProject } from "./project-fixture.js";

test("keeps every theme option inside the settings surface at minimum width", async ({ page }) => {
  const fixture = await registerProject(page, `minimum-width-${Date.now()}`);
  try {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.getByRole("link", { name: "Settings" }).click();

    const bounds = await page.getByRole("group", { name: "主题" }).evaluate((group) => {
      const container = group.closest(".settings-option")!;
      const containerRect = container.getBoundingClientRect();
      const buttons = [...group.querySelectorAll("button")].map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      return {
        container: { left: containerRect.left, right: containerRect.right },
        buttons,
      };
    });

    for (const button of bounds.buttons) {
      expect(button.left).toBeGreaterThanOrEqual(bounds.container.left);
      expect(button.right).toBeLessThanOrEqual(bounds.container.right);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("keeps narrow navigation, keyboard commands, and both themes usable", async ({ page }) => {
  const fixture = await registerProject(page, `accessibility-${Date.now()}`);
  try {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.goto("/issues");

    const projects = page.getByRole("link", { name: "Projects" });
    const settings = page.getByRole("link", { name: "Settings" });
    await expect(projects).toBeVisible();
    await expect(settings).toBeVisible();

    await page.keyboard.press("Control+N");
    await expect(page.getByRole("dialog", { name: "新建 Issue" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "新建 Issue" })).toBeHidden();

    await settings.click();
    await page.getByRole("button", { name: "深色" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const brandMark = page.locator("img.brand-mark");
    await expect(brandMark).toHaveAttribute("alt", "");
    await expect(brandMark).toHaveCSS("filter", "invert(1)");
    const artifactDir = resolve("test-results", "acceptance");
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: resolve(artifactDir, "narrow-dark-settings.png"), fullPage: true });

    await page.getByRole("button", { name: "浅色" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(brandMark).toHaveCSS("filter", "none");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.screenshot({ path: resolve(artifactDir, "narrow-light-settings.png"), fullPage: true });
  } finally {
    await fixture.cleanup();
  }
});
