import { access, lstat, mkdir, rm, symlink, writeFile } from "node:fs/promises";
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

  it("rejects hidden index entries before publishing", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const before = await git(acquired.projectPath, "rev-parse", "HEAD");
    await git(acquired.projectPath, "update-index", "--assume-unchanged", "README.md");
    await writeFile(join(acquired.projectPath, "README.md"), "hidden tracked change\n");
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };

    await expect(provider.publish({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");

    expect(await git(acquired.projectPath, "rev-parse", "HEAD")).toBe(before);
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
      "vendor/declared module",
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

  it.each([
    ["assume-unchanged", "--assume-unchanged"],
    ["skip-worktree", "--skip-worktree"],
  ])("preserves tracked changes hidden by %s during release", async (_kind, flag) => {
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
    await git(acquired.projectPath, "update-index", flag, "README.md");
    const changedFile = join(acquired.projectPath, "README.md");
    await writeFile(changedFile, "hidden tracked change\n");
    expect(await git(
      acquired.projectPath,
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--ignore-submodules=none",
    )).toBe("");

    await expect(provider.release({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");

    await expect(access(changedFile)).resolves.toBeUndefined();
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

  it("rejects hidden tracked changes inside a submodule before publishing", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const source = join(fixture.root, "publish-hidden-submodule-source");
    await createCommittedRepository(source);
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
      "vendor/hidden-publish",
    );
    const submodule = join(acquired.projectPath, "vendor/hidden-publish");
    await git(submodule, "update-index", "--assume-unchanged", "README.md");
    const changedFile = join(submodule, "README.md");
    await writeFile(changedFile, "hidden tracked change\n");
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };

    await expect(provider.publish({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");

    await expect(access(changedFile)).resolves.toBeUndefined();
  });

  it("preserves untracked files hidden inside a submodule during release", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const source = join(fixture.root, "release-hidden-submodule-source");
    await createCommittedRepository(source);
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
      "vendor/hidden-release",
    );
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };
    await provider.publish({ issue: approved, resourceId: "git:issue-1" });
    const submodule = join(acquired.projectPath, "vendor/hidden-release");
    await git(submodule, "config", "status.showUntrackedFiles", "no");
    const hiddenFile = join(submodule, "hidden-local-note.txt");
    await writeFile(hiddenFile, "keep me\n");
    expect(await git(
      acquired.projectPath,
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--ignore-submodules=none",
    )).toBe("");

    await expect(provider.release({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");

    await expect(access(hiddenFile)).resolves.toBeUndefined();
  });

  it("preserves hidden files inside nested submodules during release", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const leaf = join(fixture.root, "nested-leaf-source");
    await createCommittedRepository(leaf);
    const middle = join(fixture.root, "nested-middle-source");
    await createCommittedRepository(middle);
    await git(
      middle,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      leaf,
      "nested/leaf",
    );
    await git(middle, "commit", "-am", "add nested submodule");
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
      middle,
      "vendor/middle",
    );
    await git(
      acquired.projectPath,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "update",
      "--init",
      "--recursive",
      "vendor/middle",
    );
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };
    await provider.publish({ issue: approved, resourceId: "git:issue-1" });
    const leafCheckout = join(acquired.projectPath, "vendor/middle/nested/leaf");
    await git(leafCheckout, "config", "status.showUntrackedFiles", "no");
    const hiddenFile = join(leafCheckout, "nested-local-note.txt");
    await writeFile(hiddenFile, "keep nested file\n");
    expect(await git(
      acquired.projectPath,
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--ignore-submodules=none",
    )).toBe("");

    await expect(provider.release({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");

    await expect(access(hiddenFile)).resolves.toBeUndefined();
  });

  it("preserves files inside an uninitialized submodule directory", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const source = join(fixture.root, "uninitialized-submodule-source");
    await createCommittedRepository(source);
    await git(
      fixture.repository,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      source,
      "vendor/uninitialized",
    );
    await git(fixture.repository, "commit", "-am", "add uninitialized submodule");
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const uninitialized = join(acquired.projectPath, "vendor/uninitialized");
    await mkdir(uninitialized, { recursive: true });
    const hiddenFile = join(uninitialized, "hidden-local-note.txt");
    await writeFile(hiddenFile, "keep me\n");
    expect(await git(
      acquired.projectPath,
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--ignore-submodules=none",
    )).toBe("");
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };

    await expect(provider.publish({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");
    await expect(provider.release({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");

    await expect(access(hiddenFile)).resolves.toBeUndefined();
  });

  it("preserves a dangling symlink at an uninitialized submodule path", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const source = join(fixture.root, "symlink-submodule-source");
    await createCommittedRepository(source);
    await git(
      fixture.repository,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      source,
      "vendor/uninitialized-link",
    );
    await git(fixture.repository, "commit", "-am", "add uninitialized submodule");
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const uninitialized = join(acquired.projectPath, "vendor/uninitialized-link");
    await rm(uninitialized, { recursive: true, force: true });
    await symlink("missing-target", uninitialized);
    const approved = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
    };

    await expect(provider.publish({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");
    await expect(provider.release({ issue: approved, resourceId: "git:issue-1" }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");

    await expect(lstat(uninitialized)).resolves.toBeDefined();
  });
});

async function createCommittedRepository(path: string): Promise<void> {
  await mkdir(path);
  await git(path, "init", "-b", "main");
  await git(path, "config", "user.name", "Submodule Test");
  await git(path, "config", "user.email", "submodule@ohmybug.local");
  await writeFile(join(path, "README.md"), "declared submodule\n");
  await git(path, "add", "README.md");
  await git(path, "commit", "-m", "baseline");
}
