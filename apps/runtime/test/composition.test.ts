import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { AgentPlugin } from "@oh-my-bug/core";
import { MemorySecretStore } from "@oh-my-bug/storage";
import { describe, expect, it } from "vitest";

import * as runtimeComposition from "../src/composition.js";

const { createDesktopRuntimeComposition } = runtimeComposition;

describe("Runtime composition boundary", () => {
  it("keeps concrete Workspace packages in composition only", () => {
    const runtimeSource = resolve(import.meta.dirname, "../src");
    const sourceFiles = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) ? [path] : [];
      });
    const compositionPath = resolve(runtimeSource, "composition.ts");
    const nonComposition = sourceFiles(runtimeSource)
      .filter((path) => path !== compositionPath)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const composition = readFileSync(compositionPath, "utf8");

    expect(nonComposition).not.toMatch(/@oh-my-bug\/workspace-(local|git)/);
    expect(composition).toContain("localWorkspaceFactory");
    expect(composition).toContain("gitWorkspaceFactory");
  });

  it("reads a browser-safe snapshot from the persisted desktop Runtime", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "omb-runtime-browser-snapshot-"));
    const timestamp = "2026-08-21T08:00:00.000Z";
    const composition = createDesktopRuntimeComposition({
      dataRoot,
      overrides: { secrets: new MemorySecretStore(), now: () => timestamp },
    });
    const issue = {
      id: "issue-1",
      projectId: "project-1",
      identifier: "OMB-1",
      title: "Checkout content overflows",
      titleSource: "integration" as const,
      status: "ASSESSING" as const,
      inputs: [{
        id: "input-1",
        integration: "manual",
        inputKey: "manual-1",
        rawData: { content: "Checkout content overflows" },
        data: { content: "Checkout content overflows" },
        receivedAt: timestamp,
      }],
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      composition.store.registerProject({
        id: "project-1",
        key: "OMB",
        name: "Oh My Bug",
        path: dataRoot,
        agent: { plugin: "codex" },
        integrations: {
          sentry: {
            enabled: true,
            config: { organization: "openai", project: "oh-my-bug" },
            secretRefs: { token: "integration-secret:project-1:sentry:token" },
          },
        },
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      composition.store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
      composition.workspacePersistence.setProjectConfiguration(issue.projectId, {
        provider: "git",
        config: { baseBranch: "main", pushToRemote: false },
      });
      composition.workspacePersistence.recoverBinding({
        issueId: issue.id,
        providerId: "git",
        resourceId: `git:${issue.id}`,
        status: "READY",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      composition.workspacePersistence.set("workspace-git", `git:${issue.id}`, {
        issueId: issue.id,
        repositoryPath: dataRoot,
        projectRelativePath: ".",
        worktreePath: join(dataRoot, "worktrees", issue.id),
        branch: "ohmybug/omb-1",
        baseBranch: "main",
        baseCommit: "abc123",
        pushToRemote: false,
      });
      composition.store.transaction((transaction) => transaction.appendEvent({
        id: "issue-1:1",
        issueId: "issue-1",
        type: "ISSUE_CREATED",
        actor: "SYSTEM",
        occurredAt: timestamp,
        data: { message: "Issue created" },
      }));

      const inspectDesktopRuntimeSnapshot = (
        runtimeComposition as typeof runtimeComposition & {
          inspectDesktopRuntimeSnapshot?: (options: { dataRoot: string }) => Promise<unknown>;
        }
      ).inspectDesktopRuntimeSnapshot;
      const snapshot = await inspectDesktopRuntimeSnapshot?.({ dataRoot });

      expect(snapshot).toMatchObject({
        integrationPlugins: expect.arrayContaining([
          expect.objectContaining({ id: "sentry", name: "Sentry" }),
          expect.objectContaining({ id: "dingtalk", name: "DingTalk" }),
        ]),
        projects: [{
          id: "project-1",
          key: "OMB",
          name: "Oh My Bug",
          path: dataRoot,
          agent: { plugin: "codex" },
          integrations: {
            sentry: {
              enabled: true,
              config: { organization: "openai", project: "oh-my-bug" },
              secretConfigured: { token: true },
            },
          },
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        }],
        issues: [issue],
        issueWorkspaces: {
          "issue-1": {
            providerId: "git",
            status: "READY",
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
            occurredAt: timestamp,
            data: { message: "Issue created" },
          }],
        },
        integrationHealth: {},
        workspaceProviders: expect.arrayContaining([
          expect.objectContaining({ id: "local", name: "本机目录" }),
          expect.objectContaining({ id: "git", name: "Git Worktree" }),
        ]),
        projectInspections: {
          "project-1": {
            path: dataRoot,
            name: "Oh My Bug",
            key: "OMB",
            workspaces: {
              local: { available: true },
              git: expect.objectContaining({ available: false }),
            },
          },
        },
      });
      expect(JSON.stringify(snapshot)).not.toContain("secretRefs");
    } finally {
      composition.store.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it("is the only Runtime source that installs concrete Agent and Integration plugins", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/composition.ts"), "utf8");

    expect(source).toContain("codexAgent");
    expect(source).toContain("sentryPlugin");
    expect(source).toContain("dingTalkPlugin");
    expect(source).toContain("gitWorkspaceFactory");
    expect(source).toContain("new AgentRegistry");
    expect(source).toContain("new IntegrationRegistry");
    expect(source).not.toContain("new SentryPoller");
    expect(source).not.toContain("new DingTalkStream");
  });

  it("substitutes the demo implementation behind the configured Codex plugin in desktop E2E mode", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "omb-runtime-demo-composition-"));
    const composition = createDesktopRuntimeComposition({
      dataRoot,
      overrides: { secrets: new MemorySecretStore() },
    }, true);
    try {
      await composition.runtime.start();
      composition.runtime.registerProject({
        id: "project-1",
        key: "OMB",
        path: dataRoot,
        agent: { plugin: "codex" },
      });

      const created = await composition.runtime.submitManual("project-1", {
        commandId: "manual-1",
        content: "Checkout returns 500",
      });
      if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
      await composition.runtime.drain();

      expect(composition.runtime.getIssue(created.issue.id)).toMatchObject({
        status: "ASSESSMENT_REVIEW",
        agentSession: { agent: "codex" },
      });
    } finally {
      await composition.runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it("persists normalized Agent activity on the owning Issue", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "omb-runtime-agent-activity-"));
    const timestamp = "2026-08-22T03:33:41.000Z";
    const agentPlugin: AgentPlugin = {
      id: "activity-fixture",
      create(context) {
        return {
          async createSession(input) {
            return { agent: "activity-fixture", sessionId: `activity-${input.issue.id}` };
          },
          async assess(session) {
            await context.reportActivity?.({
              sessionId: session.sessionId,
              stage: "ASSESSMENT",
              type: "AGENT_TURN_STARTED",
              message: "Codex 开始分析",
              level: "info",
            });
            await context.reportActivity?.({
              sessionId: session.sessionId,
              stage: "ASSESSMENT",
              type: "AGENT_ERROR",
              message: "Codex 网络连接中断",
              detail: "stream disconnected before completion",
              level: "error",
            });
            throw new Error("NETWORK_FAILURE");
          },
          async repair() { throw new Error("NOT_USED"); },
          async captureEvidence() { throw new Error("NOT_USED"); },
          async cancel() {},
        };
      },
    };
    const composition = createDesktopRuntimeComposition({
      dataRoot,
      overrides: {
        agentPlugin,
        secrets: new MemorySecretStore(),
        now: () => timestamp,
      },
    });
    try {
      await composition.runtime.start();
      composition.runtime.registerProject({
        id: "project-activity",
        key: "ACT",
        path: dataRoot,
        agent: { plugin: "activity-fixture" },
      });
      const created = await composition.runtime.submitManual("project-activity", {
        commandId: "manual-activity",
        content: "Issue analysis should expose Agent errors",
      });
      if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");

      await composition.runtime.drain();

      expect(composition.runtime.readIssueEvents(created.issue.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "AGENT_TURN_STARTED",
          actor: "AGENT",
          data: expect.objectContaining({ message: "Codex 开始分析", level: "info" }),
        }),
        expect.objectContaining({
          type: "AGENT_ERROR",
          actor: "AGENT",
          data: expect.objectContaining({
            message: "Codex 网络连接中断",
            detail: "stream disconnected before completion",
            level: "error",
          }),
        }),
      ]));
      expect(composition.runtime.getIssue(created.issue.id).status).toBe("ASSESSMENT_FAILED");
    } finally {
      await composition.runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
