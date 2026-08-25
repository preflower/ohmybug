import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { createTempDir } from "../../../../../test/helpers/temp-dir.js";
import { expect, test } from "./electron-fixture.js";

test("right-aligns the New Issue icon in the real desktop application", async ({ desktop }) => {
  const project = await createTempDir("oh-my-bug-sidebar-project-");
  const suffix = String(Date.now()).slice(-6);
  try {
    await desktop.chooseProjectDirectory(project.path);
    await desktop.page.getByRole("button", { name: "打开项目目录" }).click();
    await desktop.page.getByLabel("项目名称").fill(`Sidebar acceptance ${suffix}`);
    await desktop.page.getByLabel("项目标识").fill(`S${suffix}`);
    await desktop.page.getByRole("tab", { name: "命令与验收" }).click();
    await desktop.page.getByLabel("测试命令").fill("node --test");
    await desktop.page.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(desktop.page.getByText("所有更改已保存", { exact: true })).toBeVisible();

    const button = desktop.page.getByRole("button", { name: "新建 Issue" });
    const geometry = await button.evaluate((element) => {
      const iconBounds = element.querySelector("svg")!.getBoundingClientRect();
      const buttonBounds = element.getBoundingClientRect();
      return { rightGap: buttonBounds.right - iconBounds.right };
    });
    expect(geometry.rightGap).toBeLessThanOrEqual(12);

    const evidenceDir = process.env.OH_MY_BUG_EVIDENCE_DIR
      ?? resolve("test-results", "electron-acceptance");
    await mkdir(evidenceDir, { recursive: true });
    await desktop.page.locator(".sidebar").screenshot({
      path: resolve(evidenceDir, "new-issue-icon-right-aligned.png"),
    });

    await desktop.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error("DESKTOP_WINDOW_NOT_FOUND");
      const [, height] = window.getContentSize();
      window.setContentSize(900, height ?? 720);
    });
    await expect.poll(() => desktop.page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(980);
    const collapsed = await button.evaluate((element) => {
      const iconBounds = element.querySelector("svg")!.getBoundingClientRect();
      const buttonBounds = element.getBoundingClientRect();
      return {
        buttonCenter: buttonBounds.left + buttonBounds.width / 2,
        iconCenter: iconBounds.left + iconBounds.width / 2,
      };
    });
    expect(Math.abs(collapsed.buttonCenter - collapsed.iconCenter)).toBeLessThan(1);
  } finally {
    await project.cleanup();
  }
});
