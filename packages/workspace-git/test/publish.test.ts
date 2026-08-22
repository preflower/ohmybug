import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { gitWorkspaceFactory } from "../src/index.js";
import { createGitFixture, git } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("GitWorkspace publish", () => {
  it("commits only when publish is called and returns one stable local branch", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", delivery: "local" });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const before = await git(acquired.projectPath, "rev-parse", "HEAD");
    await writeFile(join(acquired.projectPath, "fixed.txt"), "fixed\n");

    expect(await git(acquired.projectPath, "rev-parse", "HEAD")).toBe(before);
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };
    const first = await provider.publish({ issue: approved, resourceId: "git:issue-1" });
    const second = await provider.publish({ issue: approved, resourceId: "git:issue-1" });

    expect(first).toMatchObject({ name: "ohmybug/omb-1" });
    expect(first?.commit).not.toBe(before);
    expect(second).toEqual(first);
    expect(await git(acquired.projectPath, "status", "--porcelain")).toBe("");
  });

  it("retries a failed remote push without creating a duplicate commit", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", delivery: "remote", remote: "delivery" });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };
    await writeFile(join(acquired.projectPath, "fixed.txt"), "fixed\n");

    await expect(provider.publish({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_COMMAND_FAILED:push");
    const committed = await git(acquired.projectPath, "rev-parse", "HEAD");
    const bare = join(fixture.root, "delivery.git");
    await mkdir(bare);
    await git(bare, "init", "--bare");
    await git(fixture.repository, "remote", "add", "delivery", bare);

    const published = await provider.publish({ issue: approved, resourceId: "git:issue-1" });

    expect(published).toEqual({
      name: "ohmybug/omb-1",
      commit: committed,
      remote: "delivery",
    });
    expect(await git(acquired.projectPath, "rev-list", "--count", "main..HEAD"))
      .toBe("1");
    expect(await git(bare, "rev-parse", "refs/heads/ohmybug/omb-1")).toBe(committed);
  });

  it("removes the worktree without deleting the delivered branch", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", delivery: "local" });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };
    await provider.publish({ issue: approved, resourceId: "git:issue-1" });

    await provider.release({ issue: approved, resourceId: "git:issue-1" });

    await expect(access(acquired.projectPath)).rejects.toThrow();
    expect(await git(fixture.repository, "show-ref", "--verify", "refs/heads/ohmybug/omb-1"))
      .toContain("refs/heads/ohmybug/omb-1");
  });
});
