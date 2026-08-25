// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createDesktopTransport } from "../../src/web/api/desktop-transport.js";
import {
  createProjectPayload,
  saveProjectSettingsPayload,
} from "../../src/web/api/transport.js";

const project = {
  id: "project-1", name: "Checkout", key: "CHK", path: "/work/checkout",
  commands: {}, agent: { plugin: "codex" }, integrations: {}, revision: 1,
  workspace: { provider: "local", config: {} },
  createdAt: "2026-08-20T08:00:00.000Z", updatedAt: "2026-08-20T08:00:00.000Z",
};

describe("renderer product transports", () => {
  it("maps typed desktop operations, event subscriptions, and evidence bytes", async () => {
    const unsubscribe = vi.fn();
    const bridge = {
      listIntegrationPlugins: vi.fn(async () => []),
      listWorkspaceProviders: vi.fn(async () => [{
        id: "local", name: "本机目录", configFields: [],
      }]),
      listProjects: vi.fn(async () => [project]),
      inspectProject: vi.fn(async () => ({
        path: project.path,
        name: project.name,
        key: project.key,
        workspaces: { local: { available: true } },
      })),
      inspectProjectBranches: vi.fn(async () => ({
        localBranches: ["main"],
        remoteBranches: ["origin/main"],
        publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
      })),
      approveDelivery: vi.fn(async () => ({
        issue: { id: "issue-1", status: "COMPLETED" },
        branch: { name: "ohmybug/chk-1", commit: "abc123" },
      })),
      getIssueWorkspace: vi.fn(async () => ({
        providerId: "git",
        status: "READY" as const,
        branch: "ohmybug/chk-1",
      })),
      grantIssueCapabilities: vi.fn(async () => ({
        id: "issue-1",
        status: "REPAIRING",
      })),
      subscribeIssueEvents: vi.fn((_id: string, _cursor: number, listener: (event: unknown) => void) => {
        listener({ issueId: "issue-1", cursor: 2, events: [{ id: "event-2", sequence: 2 }] });
        return unsubscribe;
      }),
      readEvidence: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", label: "Shot" })),
    };
    const transport = createDesktopTransport(bridge as never);
    const listener = vi.fn();
    await expect(transport.integrationPlugins()).resolves.toEqual([]);
    await expect(transport.workspaceProviders()).resolves.toEqual([
      { id: "local", name: "本机目录", configFields: [] },
    ]);
    await expect(transport.projects()).resolves.toEqual([project]);
    await expect(transport.inspectProject(project.path)).resolves.toMatchObject({
      path: project.path,
      workspaces: { local: { available: true } },
    });
    expect(bridge.inspectProject).toHaveBeenCalledWith(project.path);
    await expect(transport.projectBranches(project.path, "git", true)).resolves.toEqual({
      localBranches: ["main"],
      remoteBranches: ["origin/main"],
      publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
    });
    expect(bridge.inspectProjectBranches).toHaveBeenCalledWith(project.path, "git", true);
    await expect(transport.approveDelivery("issue-1")).resolves.toEqual({
      issue: { id: "issue-1", status: "COMPLETED" },
      branch: { name: "ohmybug/chk-1", commit: "abc123" },
    });
    await expect(transport.issueWorkspace("issue-1")).resolves.toEqual({
      providerId: "git",
      status: "READY",
      branch: "ohmybug/chk-1",
    });
    expect(bridge.getIssueWorkspace).toHaveBeenCalledWith("issue-1");
    await expect(transport.grantIssueCapabilities("issue-1", 7, "request-1"))
      .resolves.toMatchObject({ status: "REPAIRING" });
    expect(bridge.grantIssueCapabilities).toHaveBeenCalledWith("issue-1", 7, "request-1");
    const stop = transport.subscribeIssueEvents("issue-1", 1, listener);
    stop();
    const evidence = await transport.evidenceSource("issue-1", "evidence-1");
    expect(listener).toHaveBeenCalledWith([{ id: "event-2", sequence: 2 }], 2);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(bridge.readEvidence).toHaveBeenCalledWith("issue-1", "evidence-1");
    expect(evidence.url).toMatch(/^blob:/);
    evidence.revoke?.();
  });

  it("maps form-only secret state out of Runtime project requests", () => {
    expect(createProjectPayload({
      name: "Checkout", key: "CHK", path: "/work/checkout", instructions: "", commands: {},
      agentPlugin: "codex",
      workspace: { provider: "git", config: { baseBranch: "main", delivery: "local" } },
      integrations: {
        example: { enabled: true, config: { workspace: "acme", channels: ["alerts"] }, secretConfigured: { apiToken: true } },
      },
    })).toEqual({
      name: "Checkout", key: "CHK", path: "/work/checkout", commands: {}, agent: { plugin: "codex" },
      workspace: { provider: "git", config: { baseBranch: "main", delivery: "local" } },
      integrations: { example: { enabled: true, config: { workspace: "acme", channels: ["alerts"] } } },
    });
  });

  it("maps project configuration and secret drafts into one settings request", () => {
    const formValue = {
      id: "project-1",
      revision: 3,
      name: "Checkout",
      key: "CHK",
      path: "/work/checkout",
      instructions: "",
      commands: {},
      agentPlugin: "codex",
      workspace: { provider: "local", config: {} },
      integrations: {
        dingtalk: {
          enabled: true,
          config: { conversationIds: ["cid-1"] },
          secretConfigured: { clientId: true, clientSecret: false },
        },
      },
    };

    expect(saveProjectSettingsPayload(formValue, {
      dingtalk: { clientSecret: "client-secret" },
    })).toEqual({
      mode: "update",
      id: "project-1",
      expectedRevision: 3,
      project: createProjectPayload(formValue),
      secretPatches: { dingtalk: { clientSecret: "client-secret" } },
    });
  });
});
