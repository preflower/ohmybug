import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { createTempDir } from "../../../../../test/helpers/temp-dir.js";
import { expect, test } from "./electron-fixture.js";

const execFileAsync = promisify(execFile);

test("publishes an approved local Git branch and removes only its worktree", async ({ desktop }) => {
  const project = await createTempDir("oh-my-bug-git-project-");
  const suffix = String(Date.now()).slice(-6);
  try {
    await git(project.path, "init", "-b", "main");
    await git(project.path, "config", "user.email", "e2e@example.com");
    await git(project.path, "config", "user.name", "OhMyBug E2E");
    await writeFile(join(project.path, "README.md"), "baseline\n");
    await git(project.path, "add", "README.md");
    await git(project.path, "commit", "-m", "baseline");
    const baseline = await git(project.path, "rev-parse", "HEAD");

    await desktop.chooseProjectDirectory(project.path);
    await desktop.page.getByRole("button", { name: "打开项目目录" }).click();
    await desktop.page.getByLabel("项目名称").fill(`Git Checkout ${suffix}`);
    await desktop.page.getByLabel("项目标识").fill(`G${suffix}`);
    await desktop.page.getByRole("tab", { name: "工作目录" }).click();
    await desktop.page.getByRole("combobox", { name: "工作目录方式" }).click();
    await desktop.page.getByRole("option", { name: "Git Worktree" }).click();
    await desktop.page.getByLabel("基线分支").fill("main");
    await desktop.page.getByLabel("交付方式").fill("local");
    await desktop.page.getByTestId("project-settings-form")
      .getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(desktop.page.getByRole("status").filter({ hasText: "已保存" })).toBeVisible();

    await desktop.page.getByRole("button", { name: "新建 Issue" }).click();
    const dialog = desktop.page.getByRole("dialog", { name: "新建 Issue" });
    await dialog.getByLabel("摘要（可选）").fill(`Git checkout ${suffix}`);
    await dialog.getByLabel("问题内容").fill("Create and deliver an isolated Git branch.");
    await dialog.getByRole("button", { name: "创建并开始分析" }).click();
    const assessment = desktop.page.getByRole("region", { name: "评估结果操作" });
    await expect(assessment).toBeVisible();
    await desktop.page.getByRole("button", { name: "隐藏详情栏" }).click();
    await assessment.getByRole("button", { name: "开始修复" }).click();
    const acceptance = desktop.page.getByRole("region", { name: "Delivery 审核" });
    await expect(acceptance).toBeVisible();

    const identifier = (await desktop.page.locator(".issue-title-block .eyebrow").textContent())!.trim();
    const branch = `ohmybug/${identifier.toLowerCase()}`;
    const worktree = worktreeForBranch(
      await git(project.path, "worktree", "list", "--porcelain"),
      branch,
    );
    await mkdir(join(worktree, "src"), { recursive: true });
    await writeFile(join(worktree, "src", "fixed.ts"), "export const fixed = true;\n");

    expect(await git(project.path, "rev-parse", `refs/heads/${branch}`)).toBe(baseline);
    await acceptance.getByRole("button", { name: "批准验收并完成 Issue" }).click();
    await expect(desktop.page.getByRole("status"))
      .toHaveText("结果：FIXED · 修复已验收，Issue 已完成。");

    const delivered = await git(project.path, "rev-parse", `refs/heads/${branch}`);
    expect(delivered).not.toBe(baseline);
    await expect(desktop.page.getByRole("region", { name: "交付分支" }))
      .toContainText(branch);
    expect(await git(project.path, "worktree", "list", "--porcelain"))
      .not.toContain(`branch refs/heads/${branch}`);
    expect(await git(project.path, "rev-parse", "main")).toBe(baseline);
  } finally {
    await project.cleanup();
  }
});

function worktreeForBranch(list: string, branch: string): string {
  for (const block of list.split("\n\n")) {
    if (!block.includes(`branch refs/heads/${branch}`)) continue;
    const line = block.split("\n").find((entry) => entry.startsWith("worktree "));
    if (line) return line.slice("worktree ".length);
  }
  throw new Error(`WORKTREE_NOT_FOUND:${branch}`);
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}
