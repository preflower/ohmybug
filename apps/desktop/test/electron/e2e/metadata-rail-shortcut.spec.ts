import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { createTempDir } from "../../../../../test/helpers/temp-dir.js";
import { expect, test } from "./electron-fixture.js";

test("toggles the Issue details rail with the documented keyboard shortcut", async ({ desktop }) => {
  const project = await createTempDir("oh-my-bug-shortcut-project-");
  const suffix = String(Date.now()).slice(-6);
  try {
    await desktop.chooseProjectDirectory(project.path);
    await desktop.page.getByRole("button", { name: "打开项目目录" }).click();
    await desktop.page.getByLabel("项目名称").fill(`Shortcut acceptance ${suffix}`);
    await desktop.page.getByLabel("项目标识").fill(`S${suffix}`);
    await desktop.page.getByRole("tab", { name: "命令与验收" }).click();
    await desktop.page.getByLabel("测试命令").fill("node --test");
    await desktop.page.getByTestId("project-settings-form")
      .getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(desktop.page.getByRole("status").filter({ hasText: "已保存" })).toBeVisible();

    await desktop.page.getByRole("button", { name: "新建 Issue" }).click();
    const dialog = desktop.page.getByRole("dialog", { name: "新建 Issue" });
    await dialog.getByLabel("摘要（可选）").fill("右侧详情栏快捷键验收");
    await dialog.getByLabel("问题内容").fill("验证键盘可以切换右侧详情栏。");
    await dialog.getByRole("button", { name: "创建并开始分析" }).click();

    await expect(desktop.page.getByTestId("issue-metadata-rail")).toBeVisible();
    const hideAction = desktop.page.getByRole("button", { name: "隐藏详情栏" });
    await expect(hideAction).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+Shift+B Meta+Shift+B",
    );
    await hideAction.hover();
    await expect(desktop.page.getByRole("tooltip")).toContainText("Shift");

    await desktop.page.getByRole("button", { name: "新建 Issue" }).click();
    const focusedInput = desktop.page.getByRole("dialog", { name: "新建 Issue" })
      .getByLabel("摘要（可选）");
    await focusedInput.focus();
    await desktop.page.keyboard.press(shortcut());
    await expect(desktop.page.getByTestId("issue-metadata-rail")).toBeVisible();
    await desktop.page.keyboard.press("Escape");
    await expect(desktop.page.getByRole("dialog", { name: "新建 Issue" })).toHaveCount(0);
    await hideAction.hover();
    await expect(desktop.page.getByRole("tooltip")).toContainText("Shift");

    await desktop.page.keyboard.press(shortcut());
    await expect(desktop.page.getByTestId("issue-metadata-rail")).toHaveCount(0);
    const showAction = desktop.page.getByRole("button", { name: "显示详情栏" });
    await expect(showAction).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+Shift+B Meta+Shift+B",
    );
    await showAction.hover();
    await expect(desktop.page.getByRole("tooltip")).toContainText("Shift");

    const evidenceDir = process.env.OH_MY_BUG_EVIDENCE_DIR
      ?? resolve("test-results", "electron-acceptance");
    await mkdir(evidenceDir, { recursive: true });
    await desktop.page.screenshot({
      path: resolve(evidenceDir, "metadata-rail-shortcut-collapsed.png"),
      fullPage: true,
    });

    await desktop.page.keyboard.press(shortcut());
    await expect(desktop.page.getByTestId("issue-metadata-rail")).toBeVisible();
    await desktop.page.getByRole("button", { name: "隐藏详情栏" }).hover();
    await expect(desktop.page.getByRole("tooltip")).toContainText("Shift");
    await desktop.page.screenshot({
      path: resolve(evidenceDir, "metadata-rail-shortcut-restored.png"),
      fullPage: true,
    });
  } finally {
    await project.cleanup();
  }
});

function shortcut(): string {
  return process.platform === "darwin" ? "Meta+Shift+B" : "Control+Shift+B";
}
