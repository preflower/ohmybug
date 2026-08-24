import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { gitWorkspaceFactory } from "../src/index.js";
import { createGitFixture, git } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("GitWorkspace publish", () => {
  it("rejects an embedded repository that is not declared as a submodule", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const before = await git(acquired.projectPath, "rev-parse", "HEAD");
    const embedded = join(acquired.projectPath, "renamed-acceptance-repository");
    await mkdir(embedded);
    await git(embedded, "init", "-b", "main");
    await git(embedded, "config", "user.name", "Embedded Test");
    await git(embedded, "config", "user.email", "embedded@ohmybug.local");
    await writeFile(join(embedded, "README.md"), "temporary repository\n");
    await git(embedded, "add", "README.md");
    await git(embedded, "commit", "-m", "temporary repository");
    await writeFile(join(acquired.projectPath, "fixed.txt"), "fixed\n");
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };

    await expect(provider.publish({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_EMBEDDED_REPOSITORY_NOT_ALLOWED");

    expect(await git(acquired.projectPath, "rev-parse", "HEAD")).toBe(before);
  });

  it("ignores an unstaged .gitmodules file when validating embedded repositories", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const embedded = join(acquired.projectPath, "mapped-only-in-the-worktree");
    await mkdir(embedded);
    await git(embedded, "init", "-b", "main");
    await git(embedded, "config", "user.name", "Embedded Test");
    await git(embedded, "config", "user.email", "embedded@ohmybug.local");
    await writeFile(join(embedded, "README.md"), "temporary repository\n");
    await git(embedded, "add", "README.md");
    await git(embedded, "commit", "-m", "temporary repository");
    await writeFile(
      join(acquired.projectPath, ".gitmodules"),
      [
        '[submodule "mapped-only-in-the-worktree"]',
        "\tpath = mapped-only-in-the-worktree",
        `\turl = ${embedded}`,
        "",
      ].join("\n"),
    );
    const excludePath = await git(acquired.projectPath, "rev-parse", "--git-path", "info/exclude");
    await writeFile(excludePath, ".gitmodules\n");
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };

    await expect(provider.publish({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_EMBEDDED_REPOSITORY_NOT_ALLOWED");
  });

  it("publishes a properly declared submodule", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const source = join(fixture.root, "declared-source");
    await mkdir(source);
    await git(source, "init", "-b", "main");
    await git(source, "config", "user.name", "Submodule Test");
    await git(source, "config", "user.email", "submodule@ohmybug.local");
    await writeFile(join(source, "README.md"), "declared submodule\n");
    await git(source, "add", "README.md");
    await git(source, "commit", "-m", "declared submodule");
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    await git(
      acquired.projectPath,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      source,
      "vendor/declared",
    );
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };

    const branch = await provider.publish({ issue: approved, resourceId: "git:issue-1" });

    expect(branch).toMatchObject({ name: "ohmybug/omb-1" });
    expect(await git(acquired.projectPath, "status", "--porcelain")).toBe("");
    await provider.release({ issue: approved, resourceId: "git:issue-1" });
    await expect(access(acquired.projectPath)).rejects.toThrow();
  });

  it("commits only when publish is called and returns one stable local branch", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });
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
    const bare = join(fixture.root, "delivery.git");
    await git(fixture.repository, "remote", "add", "delivery", bare);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: true, remote: "delivery" });
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
    await mkdir(bare);
    await git(bare, "init", "--bare");

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
    }).create({ baseBranch: "main", pushToRemote: false });
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

  it.each([
    ["tracked", async (path: string) => writeFile(join(path, "README.md"), "changed\n")],
    ["untracked", async (path: string) => writeFile(join(path, "local-note.txt"), "keep me\n")],
  ])("preserves a worktree with %s changes during release", async (_kind, change) => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };
    await provider.publish({ issue: approved, resourceId: "git:issue-1" });
    await change(acquired.projectPath);

    await expect(provider.release({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");

    await expect(access(acquired.projectPath)).resolves.toBeUndefined();
  });

  it("preserves untracked files hidden by status.showUntrackedFiles during release", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };
    await provider.publish({ issue: approved, resourceId: "git:issue-1" });
    await git(acquired.projectPath, "config", "status.showUntrackedFiles", "no");
    await writeFile(join(acquired.projectPath, "hidden-local-note.txt"), "keep me\n");

    await expect(provider.release({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");

    await expect(access(join(acquired.projectPath, "hidden-local-note.txt")))
      .resolves.toBeUndefined();
  });

  it("preserves submodule changes hidden by ignore=all during release", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const source = join(fixture.root, "release-submodule-source");
    await mkdir(source);
    await git(source, "init", "-b", "main");
    await git(source, "config", "user.name", "Submodule Test");
    await git(source, "config", "user.email", "submodule@ohmybug.local");
    await writeFile(join(source, "README.md"), "declared submodule\n");
    await git(source, "add", "README.md");
    await git(source, "commit", "-m", "declared submodule");
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    await git(
      acquired.projectPath,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      source,
      "vendor/declared",
    );
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };
    await provider.publish({ issue: approved, resourceId: "git:issue-1" });
    await git(acquired.projectPath, "config", "submodule.vendor/declared.ignore", "all");
    const changedFile = join(acquired.projectPath, "vendor/declared/README.md");
    await writeFile(changedFile, "keep this submodule change\n");

    await expect(provider.release({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");

    await expect(access(changedFile)).resolves.toBeUndefined();
  });
});
