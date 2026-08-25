import { describe, expect, it, vi } from "vitest";

import {
  createDesktopApi,
  TRAY_NAVIGATION_CHANNEL,
} from "../../src/electron/desktop-api.js";

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
      "confirmNotABug", "createProject", "getIssue", "getIssueWorkspace", "getProject", "listIntegrationPlugins",
      "inspectProject", "inspectProjectBranches", "listIssues", "listProjects", "listWorkspaceProviders", "onRuntimeState", "openProjectDirectory",
      "readEvidence", "rebuildAgentSession", "rejectDelivery", "requestReassessment", "retryIssue",
      "grantIssueCapabilities", "onTrayNavigation", "saveProjectSettings", "setIntegrationSecrets", "submitManual", "submitReview", "subscribeIssueEvents", "integrationHealth", "updateProject"
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
    await api.inspectProject("/work/checkout");
    await api.inspectProjectBranches("/work/checkout", "git", true);
    await api.openProjectDirectory();
    await api.getIssueWorkspace("issue-1");
    await api.grantIssueCapabilities("issue-1", 7, "request-1");
    await api.submitReview("issue-1", {
      expectedRevision: 8,
      requestId: "review-1",
      choiceId: "keep-base",
    });
    await api.saveProjectSettings({
      mode: "create",
      project: { path: "/work/checkout", key: "CHK" },
      secretPatches: {},
    });

    expect(ipc.invoke).toHaveBeenNthCalledWith(1, "oh-my-bug:request", {
      operation: "listProjects",
      payload: {}
    });
    expect(ipc.invoke).toHaveBeenNthCalledWith(2, "oh-my-bug:request", {
      operation: "inspectProject",
      payload: { path: "/work/checkout" }
    });
    expect(ipc.invoke).toHaveBeenNthCalledWith(3, "oh-my-bug:request", {
      operation: "inspectProjectBranches",
      payload: { path: "/work/checkout", providerId: "git", refreshRemote: true },
    });
    expect(ipc.invoke).toHaveBeenNthCalledWith(4, "oh-my-bug:open-project-directory");
    expect(ipc.invoke).toHaveBeenNthCalledWith(5, "oh-my-bug:request", {
      operation: "getIssueWorkspace",
      payload: { id: "issue-1" },
    });
    expect(ipc.invoke).toHaveBeenNthCalledWith(6, "oh-my-bug:request", {
      operation: "grantIssueCapabilities",
      payload: { id: "issue-1", expectedRevision: 7, requestId: "request-1" },
    });
    expect(ipc.invoke).toHaveBeenNthCalledWith(7, "oh-my-bug:request", {
      operation: "submitReview",
      payload: {
        id: "issue-1",
        input: { expectedRevision: 8, requestId: "review-1", choiceId: "keep-base" },
      },
    });
    expect(ipc.invoke).toHaveBeenNthCalledWith(8, "oh-my-bug:request", {
      operation: "saveProjectSettings",
      payload: {
        mode: "create",
        project: { path: "/work/checkout", key: "CHK" },
        secretPatches: {},
      },
    });
  });

  it("forwards only valid tray navigation targets and removes the exact listener", () => {
    const ipc = {
      invoke: vi.fn(async () => undefined),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const api = createDesktopApi(ipc);
    const listener = vi.fn();

    const stop = api.onTrayNavigation(listener);
    const onTrayNavigation = ipc.on.mock.calls.find(([channel]) =>
      channel === TRAY_NAVIGATION_CHANNEL
    )?.[1];
    expect(onTrayNavigation).toBeTypeOf("function");
    onTrayNavigation?.({}, { issueId: "issue-1" });
    onTrayNavigation?.({}, {});
    onTrayNavigation?.({}, { issueId: "" });
    onTrayNavigation?.({}, { issueId: 4 });
    onTrayNavigation?.({}, null);

    expect(listener.mock.calls).toEqual([[{ issueId: "issue-1" }], [{}]]);
    stop();
    expect(ipc.removeListener).toHaveBeenCalledWith(TRAY_NAVIGATION_CHANNEL, onTrayNavigation);
  });
});
