import { realpath } from "node:fs/promises";

import { expect, test } from "./electron-fixture.js";
import { createTempDir } from "../../../../../test/helpers/temp-dir.js";

test("opens the first project through the native directory workflow", async ({ desktop }) => {
  const project = await createTempDir("oh-my-bug-project-");
  try {
    await expect(desktop.page.getByRole("heading", { name: "打开第一个本机项目" })).toBeVisible();
    await expect(desktop.page.getByRole("button", { name: "新建 Issue" })).toHaveCount(0);

    await desktop.chooseProjectDirectory(undefined);
    await desktop.page.getByRole("button", { name: "打开项目目录" }).click();
    await expect(desktop.page.getByRole("heading", { name: "打开第一个本机项目" })).toBeVisible();

    await desktop.chooseProjectDirectory(project.path);
    await desktop.page.getByRole("button", { name: "打开项目目录" }).click();
    await expect(desktop.page.getByLabel("本机项目路径")).toHaveValue(await realpath(project.path));
    await expect(desktop.page.getByLabel("项目名称")).toHaveAttribute("data-slot", "input");
    await expect(desktop.page.getByRole("tablist", { name: "项目配置" })).toHaveAttribute("aria-orientation", "vertical");

    await desktop.page.getByRole("tab", { name: "命令与验收" }).click();
    await desktop.page.getByLabel("测试命令").fill("node --test");
    await expect(desktop.page.getByRole("button", { name: "保存更改" })).toHaveAttribute("data-slot", "button");
    await desktop.page.getByRole("button", { name: "保存更改" }).click();
    await expect(desktop.page.getByRole("status").filter({ hasText: "已保存" })).toBeVisible();
    await desktop.page.getByRole("tab", { name: "Sentry" }).click();
    await expect(desktop.page.getByLabel("Auth token")).toBeVisible();
    await expect(desktop.page.getByRole("button", { name: "新建 Issue" })).toBeVisible();
  } finally {
    await project.cleanup();
  }
});
