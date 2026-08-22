import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "./runtime-protocol-fixture.js";

import { registerProject } from "./project-fixture.js";

test("runs the two-gate manual Issue workflow and shows acceptance evidence", async ({ page }) => {
  const suffix = String(Date.now());
  const fixture = await registerProject(page, suffix);
  try {
    await page.getByRole("button", { name: "新建 Issue" }).click();
    const dialog = page.getByRole("dialog", { name: "新建 Issue" });
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: fixture.name, exact: true }).click();
    await dialog.getByLabel("摘要（可选）").fill(`Checkout returns 500 ${suffix}`);
    await dialog.getByLabel("问题内容").fill("An expired session crashes before a recoverable response is returned.");
    await dialog.getByRole("button", { name: "创建并开始分析" }).click();

    const rootApproval = page.getByRole("region", { name: "评估结果操作" });
    await expect(rootApproval).toBeVisible({ timeout: 15_000 });
    await rootApproval.getByRole("button", { name: "确认是 Bug 并开始修复" }).click();

    const acceptanceApproval = page.getByRole("region", { name: "Delivery 审核" });
    await expect(acceptanceApproval).toBeVisible({ timeout: 15_000 });
    const evidence = page.getByRole("img", { name: "Checkout acceptance" });
    await expect(evidence).toBeVisible({ timeout: 15_000 });
    await expect(evidence).toHaveJSProperty("naturalWidth", 1280);
    const artifactDir = resolve("test-results", "acceptance");
    await mkdir(artifactDir, { recursive: true });
    await page.getByRole("button", { name: "预览 Checkout acceptance" }).click();
    const preview = page.getByRole("dialog", { name: "Checkout acceptance" });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("img", { name: "Checkout acceptance" })).toHaveJSProperty("naturalWidth", 1280);
    await preview.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    await page.screenshot({ path: resolve(artifactDir, "delivery-image-preview.png") });
    await preview.getByRole("button", { name: "关闭预览" }).click();
    await expect(preview).toBeHidden();

    await page.getByRole("button", { name: "播放 Checkout recording" }).click();
    const recordingPreview = page.getByRole("dialog", { name: "Checkout recording" });
    const player = recordingPreview.getByLabel("Checkout recording 视频");
    await expect(recordingPreview).toBeVisible();
    await expect(player).toHaveAttribute("controls", "");
    await expect(player).toHaveAttribute("autoplay", "");
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => ({
      durationPositive: video.duration > 0,
      played: video.played.length,
      width: video.videoWidth,
    }))).toEqual({ durationPositive: true, played: 1, width: 1280 });
    await recordingPreview.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    await page.screenshot({ path: resolve(artifactDir, "delivery-video-preview.png") });
    await recordingPreview.getByRole("button", { name: "关闭预览" }).click();
    await expect(recordingPreview).toBeHidden();

    await page.screenshot({ path: resolve(artifactDir, "root-cause-and-acceptance.png"), fullPage: true });

    await acceptanceApproval.getByRole("button", { name: "批准验收并关闭 Issue" }).click();
    await expect(page.getByRole("status")).toHaveText("结果：FIXED · 修复已验收，Issue 已关闭。", { timeout: 15_000 });
    await page.screenshot({ path: resolve(artifactDir, "completed-workflow.png"), fullPage: true });
  } finally {
    await fixture.cleanup();
  }
});
