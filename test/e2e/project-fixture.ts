import type { Page } from "@playwright/test";

import { createTempDir } from "../helpers/temp-dir.js";

export async function registerProject(page: Page, suffix: string) {
  const fixture = await createTempDir("oh-my-bug-project-");
  const key = `E${suffix.replace(/\D/g, "").slice(-7)}`;
  const name = `Checkout ${suffix}`;
  await page.goto("/");
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "高级：手动输入路径" }).click();
  await page.getByLabel("项目名称").fill(name);
  await page.getByLabel("项目标识").fill(key);
  await page.getByLabel("本机项目路径").fill(fixture.path);
  await page.getByRole("tab", { name: "命令与验收" }).click();
  await page.getByLabel("测试命令").fill("node --test");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await page.getByText("所有更改已保存", { exact: true }).waitFor();
  return { repository: fixture.path, cleanup: fixture.cleanup, key, name };
}
