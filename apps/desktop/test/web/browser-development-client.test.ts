// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import * as client from "../../src/web/api/client.js";

describe("browser development Runtime client", () => {
  it("rejects browser mutations instead of writing to the desktop Runtime", async () => {
    const createProductTransport = (
      client as typeof client & {
        createProductTransport?: (options: {
          bridge?: undefined;
          development: boolean;
          fetch: () => Promise<Response>;
        }) => {
          submitManual(input: {
            projectId: string;
            commandId: string;
            content: string;
          }): Promise<unknown>;
        };
      }
    ).createProductTransport;
    expect(createProductTransport).toBeTypeOf("function");
    const transport = createProductTransport!({
      bridge: undefined,
      development: true,
      fetch: async () => ({
        ok: true,
        json: async () => ({
          integrationPlugins: [],
          projects: [],
          issues: [],
          integrationHealth: {},
        }),
      }) as Response,
    });

    await expect(transport.submitManual({
      projectId: "project-1",
      commandId: "manual-1",
      content: "Do not persist this",
    })).rejects.toMatchObject({
      message: "浏览器样式预览为只读模式",
      code: "DEV_BROWSER_READ_ONLY",
    });
  });

  it("loads one opening snapshot and serves Projects and Issues from it", async () => {
    const project = {
      id: "project-1",
      key: "OMB",
      name: "Oh My Bug",
      path: "/work/oh-my-bug",
      revision: 1,
      createdAt: "2026-08-21T08:00:00.000Z",
      updatedAt: "2026-08-21T08:00:00.000Z",
    };
    const issue = {
      id: "issue-1",
      projectId: "project-1",
      identifier: "OMB-1",
      title: "Issue panel overflows",
      titleSource: "integration" as const,
      status: "ASSESSING" as const,
      inputs: [],
      revision: 1,
      createdAt: "2026-08-21T08:00:00.000Z",
      updatedAt: "2026-08-21T08:00:00.000Z",
    };
    const snapshot = {
      integrationPlugins: [],
      projects: [project],
      issues: [issue],
      issueEvents: {
        "issue-1": [{
          id: "issue-1:1",
          issueId: "issue-1",
          sequence: 1,
          type: "ISSUE_CREATED",
          actor: "SYSTEM",
          occurredAt: "2026-08-21T08:00:00.000Z",
          data: { message: "Issue created" },
        }],
      },
      integrationHealth: {},
    };
    let loads = 0;
    const fetchSnapshot = async (input: RequestInfo | URL) => {
      loads += 1;
      if (loads > 1) throw new Error("SNAPSHOT_LOADED_MORE_THAN_ONCE");
      if (String(input) !== "/api/dev/snapshot") throw new Error("WRONG_SNAPSHOT_URL");
      return {
        ok: true,
        json: async () => snapshot,
      } as Response;
    };
    const createProductTransport = (
      client as typeof client & {
        createProductTransport?: (options: {
          bridge?: undefined;
          development: boolean;
          fetch: typeof fetchSnapshot;
        }) => {
          integrationPlugins(): Promise<unknown>;
          projects(): Promise<unknown>;
          project(id: string): Promise<unknown>;
          issues(): Promise<unknown>;
          issue(id: string): Promise<unknown>;
          integrationHealth(): Promise<unknown>;
          subscribeIssueEvents(
            id: string,
            cursor: number,
            listener: (events: unknown[], cursor: number) => void,
          ): () => void;
        };
      }
    ).createProductTransport;
    const transport = createProductTransport?.({
      bridge: undefined,
      development: true,
      fetch: fetchSnapshot,
    });

    const [plugins, projects, issues, health] = await Promise.all([
      transport?.integrationPlugins(),
      transport?.projects(),
      transport?.issues(),
      transport?.integrationHealth(),
    ]);

    expect({ plugins, projects, issues, health }).toEqual({
      plugins: [],
      projects: [project],
      issues: [issue],
      health: {},
    });
    expect(await transport?.project("project-1")).toEqual(project);
    expect(await transport?.issue("issue-1")).toEqual(issue);
    let delivered: { events: unknown[]; cursor: number } | undefined;
    transport?.subscribeIssueEvents("issue-1", 0, (events, cursor) => {
      delivered = { events, cursor };
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(delivered).toEqual({ events: snapshot.issueEvents["issue-1"], cursor: 1 });
    expect(loads).toBe(1);
  });
});
