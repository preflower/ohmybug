import type { Page } from "@playwright/test";

import { createTempDir } from "../../../../../test/helpers/temp-dir.js";
import {
  expect,
  launchPackagedDesktop,
  test,
  type DesktopHarness,
} from "./electron-fixture.js";

test("reconciles interrupted Agent work automatically after Runtime restart", async () => {
  const data = await createTempDir("oh-my-bug-electron-recovery-");
  const project = await createTempDir("oh-my-bug-project-");
  let first: DesktopHarness | undefined;
  let second: DesktopHarness | undefined;
  try {
    first = await launchPackagedDesktop({ dataRoot: data.path, delayMs: 30_000 });
    await registerProject(first, project.path, "RST");
    await createIssue(first.page, "Restart recovery returns 500");
    await expect(first.page.getByRole("button", { name: "暂停 Agent" })).toBeVisible();

    const child = first.app.process();
    child.kill("SIGKILL");
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true);
    await first.app.close().catch(() => undefined);
    first = undefined;

    second = await launchPackagedDesktop({ dataRoot: data.path });
    await second.page.getByText("Restart recovery returns 500", { exact: true }).first().click();
    await expect(second.page.getByRole("region", { name: "确认 Assessment" })).toBeVisible();
    await second.page.getByRole("button", { name: "Agent 活动" }).click();
    await expect(second.page.getByText("Runtime 已重启，正在恢复分析")).toBeVisible();
  } finally {
    await first?.app.close().catch(() => undefined);
    await second?.app.close().catch(() => undefined);
    await project.cleanup();
    await data.cleanup();
  }
});

test("pauses and resumes an in-flight Agent turn through the packaged Runtime protocol", async () => {
  const data = await createTempDir("oh-my-bug-electron-pause-");
  const project = await createTempDir("oh-my-bug-project-");
  let desktop: DesktopHarness | undefined;
  try {
    desktop = await launchPackagedDesktop({ dataRoot: data.path, delayMs: 30_000 });
    await registerProject(desktop, project.path, "PAU");
    await createIssue(desktop.page, "Pause this Agent turn");
    await desktop.page.getByRole("button", { name: "暂停 Agent" }).click();

    await expect(desktop.page.getByLabel("Issue 详情", { exact: true })
      .getByText("已暂停", { exact: true })).toBeVisible();
    await expect(desktop.page.getByRole("button", { name: "继续执行" })).toBeVisible();
    await expect(desktop.page.getByRole("button", { name: "取消 Issue" })).toBeVisible();
    await desktop.page.getByRole("button", { name: "继续执行" }).click();
    await expect(desktop.page.getByLabel("Issue 详情", { exact: true })
      .getByText("分析中", { exact: true })).toBeVisible();
    await expect(desktop.page.getByRole("button", { name: "暂停 Agent" })).toBeVisible();
  } finally {
    await desktop?.app.close().catch(() => undefined);
    await project.cleanup();
    await data.cleanup();
  }
});

test("cancels a passive Issue only after confirmation", async () => {
  const data = await createTempDir("oh-my-bug-electron-cancel-");
  const project = await createTempDir("oh-my-bug-project-");
  let desktop: DesktopHarness | undefined;
  try {
    desktop = await launchPackagedDesktop({ dataRoot: data.path });
    await registerProject(desktop, project.path, "CAN");
    await createIssue(desktop.page, "Cancel this reviewed Issue");
    await expect(desktop.page.getByRole("region", { name: "确认 Assessment" })).toBeVisible();
    await desktop.page.getByRole("button", { name: "取消 Issue" }).click();
    await expect(desktop.page.getByRole("dialog", { name: "确认取消 Issue？" })).toBeVisible();
    await desktop.page.getByRole("button", { name: "确认取消" }).click();

    await expect(desktop.page.getByRole("status").filter({ hasText: "结果：CANCELED" })).toBeVisible();
    await expect(desktop.page.getByLabel("Issue 详情", { exact: true })
      .getByText("已取消", { exact: true })).toBeVisible();
  } finally {
    await desktop?.app.close().catch(() => undefined);
    await project.cleanup();
    await data.cleanup();
  }
});

test("discloses a missing native session and rebuilds only after user confirmation", async () => {
  const data = await createTempDir("oh-my-bug-electron-session-rebuild-");
  const project = await createTempDir("oh-my-bug-project-");
  let desktop: DesktopHarness | undefined;
  try {
    desktop = await launchPackagedDesktop({ dataRoot: data.path, unavailableOnce: true });
    await registerProject(desktop, project.path, "SES");
    await createIssue(desktop.page, "Missing Agent session keeps Issue context");

    await expect(desktop.page.getByText("Agent 会话已被删除或不可用")).toBeVisible();
    await expect(desktop.page.getByRole("button", { name: "重试分析" })).toHaveCount(0);
    await desktop.page.getByRole("button", { name: "重建 Agent 会话" }).click();

    await expect(desktop.page.getByRole("region", { name: "确认 Assessment" })).toBeVisible();
    await expect(desktop.page.getByRole("heading", {
      level: 2,
      name: "Missing Agent session keeps Issue context",
    })).toBeVisible();
    await desktop.page.getByRole("button", { name: "Agent 活动" }).click();
    await expect(desktop.page.getByText("Codex 会话已重建")).toBeVisible();
  } finally {
    await desktop?.app.close().catch(() => undefined);
    await project.cleanup();
    await data.cleanup();
  }
});

async function registerProject(desktop: DesktopHarness, repository: string, key: string): Promise<void> {
  await desktop.chooseProjectDirectory(repository);
  await desktop.page.getByRole("button", { name: "打开项目目录" }).click();
  await desktop.page.getByLabel("项目名称").fill(`${key} project`);
  await desktop.page.getByLabel("项目标识").fill(key);
  await desktop.page.getByRole("button", { name: "保存更改" }).click();
  await expect(desktop.page.getByRole("status").filter({ hasText: "已保存" })).toBeVisible();
}

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "新建 Issue" }).click();
  const dialog = page.getByRole("dialog", { name: "新建 Issue" });
  await dialog.getByLabel("摘要（可选）").fill(title);
  await dialog.getByLabel("问题内容").fill("The operation must remain under Runtime control.");
  await dialog.getByRole("button", { name: "创建并开始分析" }).click();
}
