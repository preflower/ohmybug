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
      workspaceProviders: [{ id: "git", name: "Git Worktree", configFields: [] }],
      projectInspections: {
        "project-1": {
          path: project.path,
          name: project.name,
          key: project.key,
          workspaces: {
            git: {
              available: true,
              properties: [{ key: "remoteUrl", label: "远程仓库", value: "git@example.com:openai/oh-my-bug.git" }],
              branches: {
                localBranches: ["main"],
                remoteBranches: ["origin/main"],
                fetchRemote: { name: "origin", url: "git@example.com:openai/oh-my-bug.git" },
                publicationRemotes: [{ name: "origin", url: "git@example.com:openai/oh-my-bug.git" }],
              },
            },
          },
        },
      },
      projects: [project],
      issues: [issue],
      issueWorkspaces: {
        "issue-1": {
          providerId: "git",
          status: "READY" as const,
          branch: "ohmybug/omb-1",
        },
      },
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
          workspaceProviders(): Promise<unknown>;
          projects(): Promise<unknown>;
          project(id: string): Promise<unknown>;
          inspectProject(path: string): Promise<unknown>;
          projectBranches(path: string, providerId: string, refreshRemote: boolean): Promise<unknown>;
          issues(): Promise<unknown>;
          issue(id: string): Promise<unknown>;
          issueWorkspace(id: string): Promise<unknown>;
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

    const [plugins, workspaces, projects, issues, health] = await Promise.all([
      transport?.integrationPlugins(),
      transport?.workspaceProviders(),
      transport?.projects(),
      transport?.issues(),
      transport?.integrationHealth(),
    ]);

    expect({ plugins, workspaces, projects, issues, health }).toEqual({
      plugins: [],
      workspaces: snapshot.workspaceProviders,
      projects: [project],
      issues: [issue],
      health: {},
    });
    expect(await transport?.project("project-1")).toEqual(project);
    expect(await transport?.inspectProject(project.path)).toEqual(snapshot.projectInspections["project-1"]);
    expect(await transport?.projectBranches(project.path, "git", true)).toEqual(
      snapshot.projectInspections["project-1"].workspaces.git.branches,
    );
    expect(await transport?.issue("issue-1")).toEqual(issue);
    expect(await transport?.issueWorkspace("issue-1")).toEqual(
      snapshot.issueWorkspaces["issue-1"],
    );
    expect(await transport?.issueWorkspace("missing-issue")).toBeNull();
    let delivered: { events: unknown[]; cursor: number } | undefined;
    transport?.subscribeIssueEvents("issue-1", 0, (events, cursor) => {
      delivered = { events, cursor };
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(delivered).toEqual({ events: snapshot.issueEvents["issue-1"], cursor: 1 });
    expect(loads).toBe(1);
  });
});
