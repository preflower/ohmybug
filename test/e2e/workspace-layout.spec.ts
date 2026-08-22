import { expect, test } from "./runtime-protocol-fixture.js";

import { registerProject } from "./project-fixture.js";

async function createIssue(page: import("@playwright/test").Page, summary: string) {
  await page.getByRole("button", { name: "新建 Issue" }).click();
  await page.getByLabel("摘要（可选）").fill(summary);
  await page.getByLabel("问题内容").fill(`${summary} details`);
  await page.getByRole("button", { name: "创建并开始分析" }).click();
  await expect(page.locator(".issue-row strong").filter({ hasText: summary })).toBeVisible();
}

test("centers the titled empty Issue state", async ({ page }) => {
  const fixture = await registerProject(page, `empty-${Date.now()}`);
  try {
    await page.getByRole("link", { name: "Issues" }).click();

    const content = page.locator(".empty-list > div");
    await expect(page.getByRole("heading", { name: "暂无 Issue" })).toBeVisible();
    await expect(content).toHaveCSS("justify-items", "center");
    await expect(content).toHaveCSS("text-align", "center");
  } finally {
    await fixture.cleanup();
  }
});

test("keeps tall Projects content inside the workspace scroll boundary", async ({ page }) => {
  await page.goto("/projects");
  await page.setViewportSize({ width: 1000, height: 600 });
  const workspace = page.locator(".projects-page");
  await workspace.evaluate((element) => {
    const spacer = document.createElement("div");
    spacer.style.height = "1400px";
    spacer.setAttribute("aria-hidden", "true");
    element.append(spacer);
  });

  await workspace.hover();
  await page.mouse.wheel(0, 700);

  await expect.poll(() => workspace.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? -1)).toBe(0);
  await expect(workspace).toHaveCSS("overscroll-behavior-y", "contain");
});

test("aligns Issue metadata, titles, and timestamps across rows", async ({ page }) => {
  const fixture = await registerProject(page, `issue-alignment-${Date.now()}`);
  try {
    await page.getByRole("link", { name: "Issues" }).click();
    await createIssue(page, "Short title");
    await createIssue(page, "A much longer Issue title that occupies most of the available row width");

    const leftEdges = await page.locator(".issue-row").evaluateAll((rows) => rows.flatMap((row) => [
      row.querySelector(".issue-row-top")!.getBoundingClientRect().left,
      row.querySelector("strong")!.getBoundingClientRect().left,
      row.querySelector("small")!.getBoundingClientRect().left,
    ]));

    expect(Math.max(...leftEdges) - Math.min(...leftEdges)).toBeLessThan(1);
  } finally {
    await fixture.cleanup();
  }
});

test("uses a neutral selected Issue surface instead of the accent wash", async ({ page }) => {
  const fixture = await registerProject(page, `issue-active-${Date.now()}`);
  try {
    await page.getByRole("link", { name: "Issues" }).click();
    await createIssue(page, "Selected Issue");

    const colors = await page.locator('.issue-row[aria-current="true"]').evaluate((row) => {
      const resolveColor = (token: string) => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = `var(${token})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      };
      return {
        selected: getComputedStyle(row).backgroundColor,
        accentSoft: resolveColor("--accent-soft"),
        surfaceRaised: resolveColor("--surface-raised"),
      };
    });

    expect(colors.selected).toBe(colors.surfaceRaised);
    expect(colors.selected).not.toBe(colors.accentSoft);
  } finally {
    await fixture.cleanup();
  }
});

test("stretches project shortcuts across the sidebar section", async ({ page }) => {
  const fixture = await registerProject(page, `sidebar-width-${Date.now()}`);
  try {
    const widths = await page.locator(".sidebar-section").evaluate((section, projectName) => {
      const button = [...section.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(projectName));
      if (!button) throw new Error("PROJECT_SHORTCUT_NOT_FOUND");
      return {
        button: button.getBoundingClientRect().width,
        section: section.getBoundingClientRect().width,
      };
    }, fixture.name);

    expect(Math.abs(widths.button - widths.section)).toBeLessThan(1);
  } finally {
    await fixture.cleanup();
  }
});
