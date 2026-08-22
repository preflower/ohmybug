// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createDesktopTransport } from "../../src/web/api/desktop-transport.js";
import { createProjectPayload } from "../../src/web/api/transport.js";

const project = {
  id: "project-1", name: "Checkout", key: "CHK", path: "/work/checkout",
  commands: {}, agent: { plugin: "codex" }, integrations: {}, revision: 1,
  createdAt: "2026-08-20T08:00:00.000Z", updatedAt: "2026-08-20T08:00:00.000Z",
};

describe("renderer product transports", () => {
  it("maps typed desktop operations, event subscriptions, and evidence bytes", async () => {
    const unsubscribe = vi.fn();
    const bridge = {
      listIntegrationPlugins: vi.fn(async () => []),
      listProjects: vi.fn(async () => [project]),
      subscribeIssueEvents: vi.fn((_id: string, _cursor: number, listener: (event: unknown) => void) => {
        listener({ issueId: "issue-1", cursor: 2, events: [{ id: "event-2", sequence: 2 }] });
        return unsubscribe;
      }),
      readEvidence: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", label: "Shot" })),
    };
    const transport = createDesktopTransport(bridge as never);
    const listener = vi.fn();
    await expect(transport.integrationPlugins()).resolves.toEqual([]);
    await expect(transport.projects()).resolves.toEqual([project]);
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
      integrations: {
        example: { enabled: true, config: { workspace: "acme", channels: ["alerts"] }, secretConfigured: { apiToken: true } },
      },
    })).toEqual({
      name: "Checkout", key: "CHK", path: "/work/checkout", commands: {}, agent: { plugin: "codex" },
      integrations: { example: { enabled: true, config: { workspace: "acme", channels: ["alerts"] } } },
    });
  });
});
