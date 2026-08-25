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
      .getByRole("button", { name: "保存更改", exact: true }).click();
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

    const rootApproval = desktop.page.getByRole("region", { name: "确认 Assessment" });
    await expect(rootApproval).toBeVisible();
    const newIssue = desktop.page.locator("button.new-issue");
    await newIssue.focus();
    await desktop.page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(desktop.page.getByRole("dialog", { name: "命令菜单" })).toBeVisible();
    await desktop.page.keyboard.press("Escape");
    await expect(newIssue).toBeFocused();
    await desktop.page.getByRole("button", { name: "隐藏详情栏" }).click();
    await rootApproval.getByRole("button", { name: "开始实现" }).click();

    const acceptanceApproval = desktop.page.getByRole("region", { name: "验收 Delivery" });
    await expect(acceptanceApproval).toBeVisible();
    const evidence = desktop.page.getByRole("img", { name: "Checkout acceptance" });
    await expect(evidence).toBeVisible();
    await expect(evidence).toHaveJSProperty("naturalWidth", 1280);
    const evidenceUrl = await evidence.evaluate((image) => (image as HTMLImageElement).src);
    expect(evidenceUrl, evidenceUrl).toMatch(/^blob:/);

    await desktop.page.getByRole("button", { name: "显示详情栏" }).click();
    const activity = desktop.page.getByRole("button", { name: "Agent 活动" });
    await activity.click();
    const activityPanel = desktop.page.locator("section.agent-activity");
    await expect(activityPanel).toContainText("实现完成，准备采集证据");
    await expect(activityPanel).toContainText("开始采集验证证据");
    await expect(activityPanel).toContainText("验证证据已通过");
    await desktop.page.getByRole("button", { name: "隐藏详情栏" }).click();

    const artifactDir = process.env.OH_MY_BUG_EVIDENCE_DIR
      ? resolve(process.env.OH_MY_BUG_EVIDENCE_DIR)
      : resolve("test-results", "electron-acceptance");
    await mkdir(artifactDir, { recursive: true });
    await desktop.page.getByRole("button", { name: "预览 Checkout acceptance" }).click();
    const preview = desktop.page.getByRole("dialog", { name: "Checkout acceptance" });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("img", { name: "Checkout acceptance" })).toHaveJSProperty("naturalWidth", 1280);
    await preview.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    const closePreview = preview.getByRole("button", { name: "关闭预览" });
    await closePreview.hover();
    await expect(closePreview).toHaveCSS("background-color", "rgba(255, 255, 255, 0.12)");
    await expect(closePreview).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(closePreview).toHaveCSS("transform", "none");
    await expect(closePreview).toHaveCSS("transition-property", "background-color, border-color, color");
    await desktop.page.mouse.down();
    await expect(closePreview).toHaveCSS("background-color", "rgba(255, 255, 255, 0.18)");
    await expect(closePreview).toHaveCSS("translate", "0px");
    await desktop.page.mouse.move(0, 0);
    await desktop.page.mouse.up();
    await closePreview.hover();
    await desktop.page.screenshot({ path: resolve(artifactDir, "evidence-preview-close-hover.png") });
    await desktop.page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0, { timeout: 120 });
    await desktop.page.screenshot({ path: resolve(artifactDir, "acceptance-review.png"), fullPage: true });

    await acceptanceApproval.getByRole("button", { name: "接受交付" }).click();
    await expect(desktop.page.getByRole("status")).toHaveText("结果：FIXED · 修复已验收，Issue 已完成。");
    await desktop.page.screenshot({ path: resolve(artifactDir, "completed-workflow.png"), fullPage: true });
  } finally {
    await project.cleanup();
  }
});
