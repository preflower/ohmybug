import { transitionIssue, type NewIssueEvent } from "@oh-my-bug/core";
import type { WorkspaceBinding } from "@oh-my-bug/module-api";
import { describe, expect, it } from "vitest";

import {
  openRuntimeDatabase,
  SqliteRuntimeStore,
  SqliteWorkspaceStore,
} from "../../src/index.js";
import { issue, now, project } from "../helpers.js";

function createWorkspaceStores() {
  const database = openRuntimeDatabase(":memory:");
  return {
    runtime: new SqliteRuntimeStore(database),
    workspaces: new SqliteWorkspaceStore(database),
  };
}

function workspaceEvent(type: string): NewIssueEvent {
  return {
    id: `event-${type.toLowerCase()}`,
    issueId: issue.id,
    type,
    actor: "SYSTEM",
    data: {},
    occurredAt: now,
  };
}

function binding(
  status: WorkspaceBinding["status"],
  overrides: Partial<WorkspaceBinding> = {},
): WorkspaceBinding {
  return {
    issueId: issue.id,
    providerId: "local",
    resourceId: `local:${issue.id}`,
    status,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("SQLite Workspace persistence", () => {
  it("round-trips project configuration and module-owned state", () => {
    const { runtime, workspaces } = createWorkspaceStores();
    runtime.registerProject(project);

    workspaces.setProjectConfiguration(project.id, {
      provider: "git",
      config: { baseBranch: "main", push: false },
    });
    workspaces.set("git", "git:issue-1", { branch: "ohmybug/omb-1" });

    expect(workspaces.getProjectConfiguration(project.id)).toEqual({
      provider: "git",
      config: { baseBranch: "main", push: false },
    });
    expect(workspaces.get("git", "git:issue-1")).toEqual({
      branch: "ohmybug/omb-1",
    });
    workspaces.delete("git", "git:issue-1");
    expect(workspaces.get("git", "git:issue-1")).toBeUndefined();
    runtime.close();
  });

  it("persists a failed binding with its event", () => {
    const { runtime, workspaces } = createWorkspaceStores();
    runtime.registerProject(project);
    runtime.transaction((transaction) => transaction.insertIssue(issue, "PREPARE"));
    workspaces.beginAcquire(binding("PREPARING"));

    const failed = binding("FAILED", { lastError: "WORKTREE_FAILED" });
    workspaces.failAcquire(failed, workspaceEvent("WORKSPACE_FAILED"));

    expect(workspaces.getBinding(issue.id)).toEqual(failed);
    expect(runtime.readEvents(issue.id)).toEqual([
      expect.objectContaining({ type: "WORKSPACE_FAILED" }),
    ]);
    runtime.close();
  });

  it("recovers only READY bindings", () => {
    const { runtime, workspaces } = createWorkspaceStores();
    runtime.registerProject(project);
    runtime.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));

    expect(() => workspaces.recoverBinding(binding("PREPARING")))
      .toThrow("WORKSPACE_BINDING_NOT_READY");
    workspaces.recoverBinding(binding("READY"));

    expect(workspaces.getBinding(issue.id)).toEqual(binding("READY"));
    runtime.close();
  });

  it("assigns projectPath and queues Assessment atomically with a READY binding", () => {
    const { runtime, workspaces } = createWorkspaceStores();
    runtime.registerProject(project);
    runtime.transaction((transaction) => transaction.insertIssue(issue, "PREPARE"));
    workspaces.beginAcquire(binding("PREPARING"));
    const ready = binding("READY");
    const assignedIssue = {
      ...issue,
      projectPath: project.path,
      revision: 2,
      updatedAt: now,
    };

    const assigned = workspaces.completeAcquire({
      binding: ready,
      issue: assignedIssue,
      expectedRevision: 1,
      event: workspaceEvent("WORKSPACE_READY"),
    });

    expect(workspaces.getBinding(issue.id)).toEqual(ready);
    expect(runtime.listPendingOperations()).toEqual([
      { issue: assigned, operation: "ASSESS" },
    ]);
    expect(runtime.readEvents(issue.id)).toEqual([
      expect.objectContaining({ type: "WORKSPACE_READY" }),
    ]);
    runtime.close();
  });

  it("keeps the original Issue and binding when projectPath replacement is rejected", () => {
    const { runtime, workspaces } = createWorkspaceStores();
    const assigned = { ...issue, projectPath: project.path };
    runtime.registerProject(project);
    runtime.transaction((transaction) => transaction.insertIssue(assigned, "PREPARE"));
    const preparing = binding("PREPARING");
    workspaces.beginAcquire(preparing);

    expect(() => workspaces.completeAcquire({
      binding: binding("READY", { resourceId: "git:issue-1" }),
      issue: {
        ...assigned,
        projectPath: "/tmp/different-worktree",
        revision: 2,
      },
      expectedRevision: 1,
      event: workspaceEvent("WORKSPACE_READY"),
    })).toThrow("PROJECT_PATH_CONFLICT");

    expect(runtime.getIssue(issue.id)).toEqual(assigned);
    expect(workspaces.getBinding(issue.id)).toEqual(preparing);
    expect(runtime.readEvents(issue.id)).toEqual([]);
    runtime.close();
  });

  it("rolls back a READY binding when the Issue revision is stale", () => {
    const { runtime, workspaces } = createWorkspaceStores();
    runtime.registerProject(project);
    runtime.transaction((transaction) => transaction.insertIssue(issue, "PREPARE"));
    const preparing = binding("PREPARING");
    workspaces.beginAcquire(preparing);

    expect(() => workspaces.completeAcquire({
      binding: binding("READY"),
      issue: { ...issue, projectPath: project.path, revision: 2 },
      expectedRevision: 99,
      event: workspaceEvent("WORKSPACE_READY"),
    })).toThrow("CONCURRENT_UPDATE");

    expect(runtime.getIssue(issue.id)).toEqual(issue);
    expect(workspaces.getBinding(issue.id)).toEqual(preparing);
    expect(runtime.readEvents(issue.id)).toEqual([]);
    runtime.close();
  });

  it("completes an approved Issue atomically with Workspace release", () => {
    const { runtime, workspaces } = createWorkspaceStores();
    const approved = {
      ...issue,
      projectPath: project.path,
      status: "FINALIZING" as const,
      resolution: "FIXED" as const,
      revision: 5,
    };
    runtime.registerProject(project);
    runtime.transaction((transaction) => transaction.insertIssue(approved, "FINALIZE"));
    workspaces.beginAcquire(binding("PREPARING"));
    const released = binding("RELEASED");
    const completed = transitionIssue(approved, "COMPLETE_DELIVERY", now);

    expect(workspaces.completeRelease({
      binding: released,
      issue: completed,
      expectedRevision: approved.revision,
      event: workspaceEvent("ISSUE_COMPLETED"),
    })).toEqual(completed);
    expect(workspaces.getBinding(issue.id)).toEqual(released);
    expect(runtime.getIssue(issue.id)).toEqual(completed);
    expect(runtime.listPendingOperations()).toEqual([]);
    expect(runtime.readEvents(issue.id)).toEqual([
      expect.objectContaining({ type: "ISSUE_COMPLETED" }),
    ]);
    runtime.close();
  });
});
