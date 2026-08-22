import { _electron as electron } from "file:///Users/starrblink/Documents/Workspace/ohmybug/node_modules/playwright/index.mjs";
import assert from "node:assert/strict";

const { OMB_RENDERER_URL: _rendererUrl, OMB_VITE_DEV: _viteDev, ...baseEnvironment } = process.env;

const app = await electron.launch({
  executablePath: "/Users/starrblink/Documents/Workspace/ohmybug/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  args: [
    "/Users/starrblink/.oh-my-bug/worktrees/8658b7f1-5784-4a50-9e06-072e38389e27/1940dd6d-60c4-4ec7-b20b-3a4d7c49caf7/.vite/build/apps/desktop/src/electron/main.js",
    "--user-data-dir=/tmp/oh-my-bug-evidence-profile-v0JeZf",
  ],
  env: {
    ...baseEnvironment,
    OH_MY_BUG_HOME: "/Users/starrblink/.oh-my-bug/worktrees/8658b7f1-5784-4a50-9e06-072e38389e27/1940dd6d-60c4-4ec7-b20b-3a4d7c49caf7/.oh-my-bug-tmp-fFH4K9/runtime-data",
  },
  timeout: 30_000,
});

try {
  app.process().stdout?.on("data", (chunk) => process.stdout.write(`[electron:out] ${chunk}`));
  app.process().stderr?.on("data", (chunk) => process.stderr.write(`[electron:err] ${chunk}`));
  const page = await app.firstWindow({ timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  const projectShortcut = page.locator(".sidebar-section").getByRole("button", {
    name: "Oh My Bug ?!",
    exact: true,
  });
  await projectShortcut.waitFor({ state: "visible", timeout: 30_000 });
  await projectShortcut.click();

  const breadcrumbProject = page.locator(".breadcrumb span:last-child");
  await breadcrumbProject.waitFor({ state: "visible" });
  assert.equal(await breadcrumbProject.innerText(), "Oh My Bug ?!");
  assert.equal(await page.locator('[data-testid="project-config-screen"]').count(), 0);

  const issueList = page.getByRole("region", { name: "Issue 列表" });
  const filteredText = await issueList.innerText();
  assert.match(filteredText, /OHMYBUG-9/);
  assert.doesNotMatch(filteredText, /MODE-CORE-1/);

  await issueList.getByText("OHMYBUG-9", { exact: true }).click();
  const issueDetail = page.getByRole("region", { name: "Issue 详情" });
  await issueDetail.getByText("Open a project's issue list when selecting it from the sidebar", {
    exact: true,
  }).waitFor({ state: "visible" });

  const outputPath = "/Users/starrblink/.oh-my-bug/worktrees/8658b7f1-5784-4a50-9e06-072e38389e27/1940dd6d-60c4-4ec7-b20b-3a4d7c49caf7/.oh-my-bug-tmp-evidence-v0JeZf/sidebar-project-filtered-issues.png";
  await page.screenshot({ path: outputPath, fullPage: true });
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  const projectList = page.getByRole("region", { name: "本机项目" });
  await projectList.waitFor({ state: "visible" });
  await projectList.getByRole("button", { name: /打开项目 Oh My Bug \?!/ }).click();
  await page.locator('[data-testid="project-config-screen"]').waitFor({ state: "visible" });
  const configOutputPath = "/Users/starrblink/.oh-my-bug/worktrees/8658b7f1-5784-4a50-9e06-072e38389e27/1940dd6d-60c4-4ec7-b20b-3a4d7c49caf7/.oh-my-bug-tmp-evidence-v0JeZf/projects-list-project-configuration.png";
  await page.screenshot({ path: configOutputPath, fullPage: true });
  console.log(JSON.stringify({
    captured: outputPath,
    configCaptured: configOutputPath,
    project: await breadcrumbProject.innerText(),
    projectCurrent: await projectShortcut.getAttribute("aria-current"),
    selectedIssue: "OHMYBUG-9",
    filteredOut: "MODE-CORE-1",
  }));
} finally {
  await app.close();
}
