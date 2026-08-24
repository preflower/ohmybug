import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { gitWorkspaceFactory } from "../src/provider.js";
import { createGitFixture, git } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture() {
  const value = await createGitFixture();
  cleanups.push(value.cleanup);
  return value;
}

describe("Git Workspace project inspection", () => {
  it("lists local refs immediately and appends fetched remote refs", async () => {
    const value = await fixture();
    const bare = join(value.root, "origin.git");
    await git(value.root, "init", "--bare", bare);
    await git(value.repository, "remote", "add", "origin", bare);
    await git(value.repository, "push", "origin", "main:main", "main:release");

    const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

    await expect(factory.inspectProjectBranches?.(value.repository, { refreshRemote: false }))
      .resolves.toMatchObject({
        localBranches: ["main"],
        fetchRemote: { name: "origin", url: bare },
        publicationRemotes: [{ name: "origin", url: bare }],
      });
    await expect(factory.inspectProjectBranches?.(value.repository, { refreshRemote: true }))
      .resolves.toMatchObject({
        localBranches: ["main"],
        remoteBranches: ["origin/main", "origin/release"],
        fetchRemote: { name: "origin", url: bare },
        publicationRemotes: [{ name: "origin", url: bare }],
      });
  });

  it("keeps local refs and reports a failed Fetch", async () => {
    const value = await fixture();
    await git(value.repository, "remote", "add", "origin", join(value.root, "missing.git"));
    const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

    await expect(factory.inspectProjectBranches?.(value.repository, { refreshRemote: true }))
      .resolves.toMatchObject({
        localBranches: ["main"],
        remoteBranches: [],
        refreshError: "GIT_COMMAND_FAILED:fetch",
      });
  });

  it("validates local and remote-tracking base refs before save", async () => {
    const value = await fixture();
    const bare = join(value.root, "origin.git");
    await git(value.root, "init", "--bare", bare);
    await git(value.repository, "remote", "add", "origin", bare);
    await git(value.repository, "push", "origin", "main:release");
    await git(value.repository, "fetch", "origin");
    const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

    await expect(factory.validateProjectConfiguration?.(value.repository, {
      baseBranch: "main",
      pushToRemote: false,
    })).resolves.toBeUndefined();
    await expect(factory.validateProjectConfiguration?.(value.repository, {
      baseBranch: "origin/release",
      pushToRemote: false,
    })).resolves.toBeUndefined();
    await expect(factory.validateProjectConfiguration?.(value.repository, {
      baseBranch: "missing",
      pushToRemote: false,
    })).rejects.toThrow("GIT_COMMAND_FAILED:rev-parse");
  });

  it("requires a local baseline branch when automatic merge is enabled", async () => {
    const value = await fixture();
    const bare = join(value.root, "origin.git");
    await git(value.root, "init", "--bare", bare);
    await git(value.repository, "remote", "add", "origin", bare);
    await git(value.repository, "push", "origin", "main:release");
    await git(value.repository, "fetch", "origin");
    const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

    await expect(factory.validateProjectConfiguration?.(value.repository, {
      baseBranch: "main",
      pushToRemote: false,
      mergeToBaseBranch: true,
    })).resolves.toBeUndefined();
    await expect(factory.validateProjectConfiguration?.(value.repository, {
      baseBranch: "origin/release",
      pushToRemote: false,
      mergeToBaseBranch: true,
    })).rejects.toThrow("GIT_AUTO_MERGE_REQUIRES_LOCAL_BASE_BRANCH");
  });

  it("prefers the current branch remote and exposes its URL as read-only evidence", async () => {
    const value = await fixture();
    await git(value.repository, "remote", "add", "origin", "/srv/git/origin.git");
    await git(value.repository, "remote", "add", "upstream", "git@example.com:team/repo.git");
    await git(value.repository, "config", "branch.main.remote", "upstream");

    const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

    await expect(factory.inspectProject?.(value.repository)).resolves.toMatchObject({
      available: true,
      configPatch: { remote: "upstream" },
      fields: { pushToRemote: { enabled: true } },
      branches: {
        fetchRemote: { name: "upstream", url: "git@example.com:team/repo.git" },
        publicationRemotes: [
          { name: "origin", url: "/srv/git/origin.git" },
          { name: "upstream", url: "git@example.com:team/repo.git" },
        ],
      },
      properties: [{
        key: "remoteUrl",
        label: "远程仓库",
        value: "git@example.com:team/repo.git",
        description: "Git remote: upstream",
      }],
    });
  });

  it("prefers origin when the current branch has no remote", async () => {
    const value = await fixture();
    await git(value.repository, "remote", "add", "backup", "/srv/git/backup.git");
    await git(value.repository, "remote", "add", "origin", "/srv/git/checkout.git");

    const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

    await expect(factory.inspectProject?.(value.repository)).resolves.toMatchObject({
      configPatch: { remote: "origin" },
      properties: [{ value: "/srv/git/checkout.git" }],
    });
  });

  it("uses the sole configured remote", async () => {
    const value = await fixture();
    await git(value.repository, "remote", "add", "delivery", "/srv/git/delivery.git");

    const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

    await expect(factory.inspectProject?.(value.repository)).resolves.toMatchObject({
      configPatch: { remote: "delivery" },
      properties: [{ value: "/srv/git/delivery.git" }],
    });
  });

  it("keeps local Worktree available when no remote exists", async () => {
    const value = await fixture();
    const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

    await expect(factory.inspectProject?.(value.repository)).resolves.toMatchObject({
      available: true,
      fields: {
        pushToRemote: {
          enabled: false,
          reason: "当前 Git 仓库未配置远程仓库",
        },
      },
      properties: [],
      branches: {
        localBranches: ["main"],
        remoteBranches: [],
        publicationRemotes: [],
        fetchUnavailableReason: "当前 Git 仓库未配置远程仓库",
      },
    });
  });

  it("disables remote publication when multiple remotes are ambiguous", async () => {
    const value = await fixture();
    await git(value.repository, "remote", "add", "backup", "/srv/git/backup.git");
    await git(value.repository, "remote", "add", "delivery", "/srv/git/delivery.git");
    const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

    await expect(factory.inspectProject?.(value.repository)).resolves.toMatchObject({
      available: true,
      fields: {
        pushToRemote: {
          enabled: false,
          reason: "当前 Git 仓库有多个远程仓库，且未配置默认上游",
        },
      },
    });
  });

  it("marks a non-Git directory unavailable", async () => {
    const value = await fixture();
    const directory = join(value.root, "not-a-repository");
    await mkdir(directory);
    const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

    await expect(factory.inspectProject?.(directory)).resolves.toEqual({
      available: false,
      reason: "所选目录不在 Git 仓库中",
    });
  });
});
