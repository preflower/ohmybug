import { describe, expect, it, vi } from "vitest";

import { createDesktopApi } from "../../src/electron/desktop-api.js";

describe("preload desktop API", () => {
  it("exposes only frozen named product operations", () => {
    const ipc = {
      invoke: vi.fn(async () => undefined),
      on: vi.fn(),
      removeListener: vi.fn()
    };
    const api = createDesktopApi(ipc);

    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.keys(api).sort()).toEqual([
      "approveAssessment", "approveBugAssessment", "approveDelivery", "cancelIssue", "confirmDuplicate",
      "confirmNotABug", "createProject", "getIssue", "getProject", "listIntegrationPlugins",
      "listIssues", "listProjects", "listWorkspaceProviders", "onRuntimeState", "openProjectDirectory",
      "readEvidence", "rebuildAgentSession", "rejectDelivery", "requestReassessment", "retryIssue",
      "setIntegrationSecrets", "submitManual", "subscribeIssueEvents", "integrationHealth", "updateProject"
    ].sort());
    expect("invoke" in api).toBe(false);
    expect("filesystem" in api).toBe(false);
    expect("shell" in api).toBe(false);
  });

  it("maps named methods to fixed channels and operations", async () => {
    const ipc = {
      invoke: vi.fn(async () => [{ id: "project-1" }]),
      on: vi.fn(),
      removeListener: vi.fn()
    };
    const api = createDesktopApi(ipc);

    await expect(api.listProjects()).resolves.toEqual([{ id: "project-1" }]);
    await api.openProjectDirectory();

    expect(ipc.invoke).toHaveBeenNthCalledWith(1, "oh-my-bug:request", {
      operation: "listProjects",
      payload: {}
    });
    expect(ipc.invoke).toHaveBeenNthCalledWith(2, "oh-my-bug:open-project-directory");
  });
});
