import { expect, test } from "./electron-fixture.js";

test("keeps the packaged renderer isolated behind the frozen desktop bridge", async ({ desktop }) => {
  const surface = await desktop.page.evaluate(() => ({
    electron: typeof (globalThis as Record<string, unknown>).electron,
    process: typeof (globalThis as Record<string, unknown>).process,
    require: typeof (globalThis as Record<string, unknown>).require,
    frozen: Object.isFrozen(window.ohMyBug),
    keys: Object.keys(window.ohMyBug ?? {}).sort()
  }));

  expect(surface).toEqual({
    electron: "undefined",
    process: "undefined",
    require: "undefined",
    frozen: true,
    keys: [
      "approveAssessment",
      "approveBugAssessment",
      "approveDelivery",
      "cancelIssue",
      "confirmDuplicate",
      "confirmNotABug",
      "createProject",
      "getIssue",
      "getIssueWorkspace",
      "getProject",
      "grantIssueCapabilities",
      "integrationHealth",
      "inspectProject",
      "inspectProjectBranches",
      "listIntegrationPlugins",
      "listIssues",
      "listProjects",
      "listWorkspaceProviders",
      "onRuntimeState",
      "openProjectDirectory",
      "readEvidence",
      "rebuildAgentSession",
      "rejectDelivery",
      "requestReassessment",
      "retryIssue",
      "saveProjectSettings",
      "setIntegrationSecrets",
      "submitManual",
      "subscribeIssueEvents",
      "updateProject"
    ]
  });

  await desktop.page.getByRole("link", { name: "Settings" }).click();
  await expect(desktop.page).toHaveURL(/#\/settings$/);
  await expect(desktop.page.getByRole("heading", { name: "集成运行状态" })).toBeVisible();
  await expect(desktop.page.getByRole("heading", { name: "Runtime" })).toHaveCount(0);
  await desktop.page.getByRole("link", { name: "Projects" }).click();
  await expect(desktop.page).toHaveURL(/#\/projects$/);
});
