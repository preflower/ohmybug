import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { createTempDir } from "../../../../../test/helpers/temp-dir.js";
import { expect, test } from "./electron-fixture.js";

test("creates an Issue with Enter while preserving Shift+Enter for newlines", async ({ desktop }) => {
  const project = await createTempDir("oh-my-bug-enter-project-");
  const suffix = String(Date.now()).slice(-6);
  const artifactDir = resolve("test-results", "electron-acceptance");
  try {
    await mkdir(artifactDir, { recursive: true });
    await desktop.chooseProjectDirectory(project.path);
    await desktop.page.getByRole("button", { name: "打开项目目录" }).click();
    await desktop.page.getByLabel("项目名称").fill(`Enter Shortcut ${suffix}`);
    await desktop.page.getByLabel("项目标识").fill(`E${suffix}`);
    await desktop.page.getByTestId("project-settings-form")
      .getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(desktop.page.getByRole("status").filter({ hasText: "已保存" })).toBeVisible();

    await desktop.page.getByRole("button", { name: "新建 Issue" }).click();
    const dialog = desktop.page.getByRole("dialog", { name: "新建 Issue" });
    const contentField = dialog.getByLabel("问题内容");
    const createButton = dialog.getByRole("button", { name: "创建并开始分析" });

    await expect(createButton).toBeDisabled();
    await contentField.press("Enter");
    await expect(dialog).toBeVisible();

    await contentField.fill("   ");
    await expect(createButton).toBeDisabled();
    await contentField.press("Enter");
    await expect(dialog).toBeVisible();

    await contentField.fill("An expired session crashes before a recoverable response is returned.");
    await contentField.press("Shift+Enter");
    await contentField.pressSequentially("The dialog should submit when Enter is pressed.");
    await expect(contentField).toHaveValue(
      "An expired session crashes before a recoverable response is returned.\nThe dialog should submit when Enter is pressed.",
    );
    await expect(createButton).toBeEnabled();
    await desktop.page.screenshot({ path: resolve(artifactDir, "new-issue-enter-ready.png") });

    await contentField.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(desktop.page.getByRole("region", { name: "评估结果操作" })).toBeVisible();
    await desktop.page.screenshot({ path: resolve(artifactDir, "new-issue-enter-created.png"), fullPage: true });
  } finally {
    await project.cleanup();
  }
});
