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
