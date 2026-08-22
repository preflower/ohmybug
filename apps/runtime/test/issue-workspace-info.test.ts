import type { Issue } from "@oh-my-bug/core";
import type {
  WorkspaceBinding,
  WorkspacePersistence,
  WorkspaceProvider,
} from "@oh-my-bug/module-api";
import { describe, expect, it, vi } from "vitest";

import { readIssueWorkspaceInfo } from "../src/workspaces/issue-workspace-info.js";

const issue: Issue = {
  id: "issue-1",
  projectId: "project-1",
  identifier: "OMB-1",
  title: "Show the worktree branch",
  titleSource: "user",
  status: "REPAIRING",
  inputs: [],
  revision: 2,
  createdAt: "2026-08-22T08:00:00.000Z",
  updatedAt: "2026-08-22T08:01:00.000Z",
};

const gitBinding: WorkspaceBinding = {
    issueId: issue.id,
    providerId: "git",
    resourceId: `git:${issue.id}`,
    status: "READY",
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
};

function persistence(
  binding: WorkspaceBinding | null = gitBinding,
): WorkspacePersistence {
  return {
    transaction: (work) => work(),
    getProjectConfiguration: () => ({
      provider: "git",
      config: { baseBranch: "main" },
    }),
    setProjectConfiguration: vi.fn(),
    getBinding: () => binding ?? undefined,
    recoverBinding: vi.fn(),
    beginAcquire: vi.fn(),
    completeAcquire: (input) => input.issue,
    failAcquire: vi.fn(),
    completeRelease: (input) => input.issue,
  };
}

describe("readIssueWorkspaceInfo", () => {
  it("returns a described branch from the persisted binding", async () => {
    const provider = {
      id: "git",
      acquire: vi.fn(),
      describe: vi.fn(async () => ({ branch: "ohmybug/omb-1" })),
      publish: vi.fn(),
      release: vi.fn(),
    } satisfies WorkspaceProvider;
    const registry = { create: vi.fn(() => provider) };

    await expect(readIssueWorkspaceInfo({
      issue,
      persistence: persistence(),
      registry,
    })).resolves.toEqual({
      providerId: "git",
      status: "READY",
      branch: "ohmybug/omb-1",
    });
    expect(registry.create).toHaveBeenCalledWith("git", { baseBranch: "main" });
  });

  it("returns null without a binding", async () => {
    await expect(readIssueWorkspaceInfo({
      issue,
      persistence: persistence(null),
      registry: { create: vi.fn() },
    })).resolves.toBeNull();
  });

  it("returns binding metadata without a branch for providers without describe", async () => {
    const localBinding: WorkspaceBinding = {
      issueId: issue.id,
      providerId: "local",
      resourceId: `local:${issue.id}`,
      status: "READY",
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
    const localProvider = {
      id: "local",
      acquire: vi.fn(),
      publish: vi.fn(),
      release: vi.fn(),
    } satisfies WorkspaceProvider;

    await expect(readIssueWorkspaceInfo({
      issue,
      persistence: persistence(localBinding),
      registry: { create: vi.fn(() => localProvider) },
    })).resolves.toEqual({ providerId: "local", status: "READY" });
  });

  it("keeps binding metadata when provider description fails", async () => {
    const registry = {
      create: vi.fn((): WorkspaceProvider => { throw new Error("PROVIDER_MISSING"); }),
    };

    await expect(readIssueWorkspaceInfo({
      issue,
      persistence: persistence(),
      registry,
    })).resolves.toEqual({ providerId: "git", status: "READY" });
  });
});
