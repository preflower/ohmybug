import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { createTempDir } from "../../../../../test/helpers/temp-dir.js";
import { expect, test } from "./electron-fixture.js";

test("runs the complete two-gate workflow and renders desktop evidence bytes", async ({ desktop }) => {
  const project = await createTempDir("oh-my-bug-project-");
  const suffix = String(Date.now()).slice(-6);
  const key = `D${suffix}`;
  try {
    await desktop.chooseProjectDirectory(project.path);
    await desktop.page.getByRole("button", { name: "打开项目目录" }).click();
    await desktop.page.getByLabel("项目名称").fill(`Desktop Checkout ${suffix}`);
    await desktop.page.getByLabel("项目标识").fill(key);
    await desktop.page.getByRole("tab", { name: "命令与验收" }).click();
    await desktop.page.getByLabel("测试命令").fill("node --test");
    await desktop.page.getByTestId("project-settings-form")
      .getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(desktop.page.getByRole("status").filter({ hasText: "已保存" })).toBeVisible();

    const createIssue = desktop.page.locator("button.new-issue");
    await createIssue.click();
    const dialog = desktop.page.getByRole("dialog", { name: "新建 Issue" });
    await expect(dialog).toHaveAttribute("data-slot", "dialog-content");
    await desktop.page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(createIssue).toBeFocused();
    await createIssue.click();
    await dialog.getByLabel("摘要（可选）").fill(`Desktop checkout returns 500 ${suffix}`);
    await dialog.getByLabel("问题内容").fill("An expired session crashes before a recoverable response is returned.");
    await dialog.getByRole("button", { name: "创建并开始分析" }).click();

    const rootApproval = desktop.page.getByRole("region", { name: "评估结果操作" });
    await expect(rootApproval).toBeVisible();
    const newIssue = desktop.page.locator("button.new-issue");
    await newIssue.focus();
    await desktop.page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(desktop.page.getByRole("dialog", { name: "命令菜单" })).toBeVisible();
    await desktop.page.keyboard.press("Escape");
    await expect(newIssue).toBeFocused();
    await desktop.page.getByRole("button", { name: "隐藏详情栏" }).click();
    await rootApproval.getByRole("button", { name: "确认是 Bug 并开始修复" }).click();

    const acceptanceApproval = desktop.page.getByRole("region", { name: "Delivery 审核" });
    await expect(acceptanceApproval).toBeVisible();
    const evidence = desktop.page.getByRole("img", { name: "Checkout acceptance" });
    await expect(evidence).toBeVisible();
    await expect(evidence).toHaveJSProperty("naturalWidth", 1280);
    expect(await evidence.evaluate((image) => (image as HTMLImageElement).src.startsWith("blob:file:"))).toBe(true);

    const artifactDir = resolve("test-results", "electron-acceptance");
    await mkdir(artifactDir, { recursive: true });
    await desktop.page.getByRole("button", { name: "预览 Checkout acceptance" }).click();
    const preview = desktop.page.getByRole("dialog", { name: "Checkout acceptance" });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("img", { name: "Checkout acceptance" })).toHaveJSProperty("naturalWidth", 1280);
    await preview.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    await desktop.page.screenshot({ path: resolve(artifactDir, "evidence-preview.png") });
    await preview.getByRole("button", { name: "关闭预览" }).click();
    await expect(preview).toBeHidden();
    await desktop.page.screenshot({ path: resolve(artifactDir, "acceptance-review.png"), fullPage: true });

    await acceptanceApproval.getByRole("button", { name: "批准验收并完成 Issue" }).click();
    await expect(desktop.page.getByRole("status")).toHaveText("结果：FIXED · 修复已验收，Issue 已完成。");
    await desktop.page.screenshot({ path: resolve(artifactDir, "completed-workflow.png"), fullPage: true });
  } finally {
    await project.cleanup();
  }
});
