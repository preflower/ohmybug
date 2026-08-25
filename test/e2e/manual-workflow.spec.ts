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

    const rootApproval = page.getByRole("region", { name: "确认 Assessment" });
    await expect(rootApproval).toBeVisible({ timeout: 15_000 });
    await rootApproval.getByRole("button", { name: "开始实现" }).click();

    const acceptanceApproval = page.getByRole("region", { name: "验收 Delivery" });
    await expect(acceptanceApproval).toBeVisible({ timeout: 15_000 });
    const evidence = page.getByRole("img", { name: "Checkout acceptance" });
    await expect(evidence).toBeVisible({ timeout: 15_000 });
    await expect(evidence).toHaveJSProperty("naturalWidth", 1280);
    const artifactDir = process.env.OH_MY_BUG_EVIDENCE_DIR
      ? resolve(process.env.OH_MY_BUG_EVIDENCE_DIR)
      : resolve("test-results", "acceptance");
    await mkdir(artifactDir, { recursive: true });
    await page.getByRole("button", { name: "预览 Checkout acceptance" }).click();
    const preview = page.getByRole("dialog", { name: "Checkout acceptance" });
    await expect(preview).toBeVisible();
    await expect(preview.locator(".evidence-preview-header")).toHaveCount(0);
    await expect(preview.locator(".evidence-preview-stage > .evidence-preview-toolbar")).toBeVisible();
    const previewImage = preview.getByRole("img", { name: "Checkout acceptance" });
    await expect(previewImage).toHaveJSProperty("naturalWidth", 1280);
    const zoomLevel = preview.getByLabel("当前缩放比例");
    await expect(zoomLevel).toHaveText("100%");
    await expect(zoomLevel).toHaveCSS("height", "28px");
    await preview.getByRole("button", { name: "放大" }).click();
    await preview.getByRole("button", { name: "放大" }).click();
    await expect(zoomLevel).toHaveText("150%");
    await expect(previewImage).toHaveCSS("transform", /matrix\(1\.5, 0, 0, 1\.5,/);
    const imageStage = preview.getByRole("region", { name: /图片预览区域/ });
    const stageBounds = await imageStage.boundingBox();
    if (!stageBounds) throw new Error("IMAGE_PREVIEW_STAGE_NOT_VISIBLE");
    await page.mouse.move(stageBounds.x + stageBounds.width / 2, stageBounds.y + stageBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(stageBounds.x + stageBounds.width / 2 + 140, stageBounds.y + stageBounds.height / 2);
    await page.mouse.up();
    await expect.poll(() => previewImage.evaluate((image) => image.style.transform)).toContain("translate3d(140px, 0px, 0px)");
    await preview.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    await page.screenshot({ path: resolve(artifactDir, "image-preview-zoomed.png") });
    await preview.getByRole("button", { name: "重置视图" }).click();
    await expect(preview.getByLabel("当前缩放比例")).toHaveText("100%");
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

    await acceptanceApproval.getByRole("button", { name: "接受交付" }).click();
    await expect(page.getByRole("status")).toHaveText("结果：FIXED · 修复已验收，Issue 已完成。", { timeout: 15_000 });
    await page.screenshot({ path: resolve(artifactDir, "completed-workflow.png"), fullPage: true });
  } finally {
    await fixture.cleanup();
  }
});
