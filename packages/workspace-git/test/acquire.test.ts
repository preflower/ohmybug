import { access, rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { gitWorkspaceFactory } from "../src/index.js";
import { createGitFixture, git } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("GitWorkspace acquire", () => {
  it("models remote publication as a Boolean capability", () => {
    const factory = gitWorkspaceFactory({
      state: { get: () => undefined, set: () => {}, delete: () => {} },
      worktreeRoot: "/tmp/worktrees",
    });

    expect(factory.manifest.configFields).toContainEqual(expect.objectContaining({
      key: "pushToRemote",
      type: "boolean",
      label: "完成后推送到远程",
      defaultValue: false,
    }));
    expect(factory.manifest.configFields)
      .not.toContainEqual(expect.objectContaining({ key: "delivery" }));
    expect(factory.manifest.configFields)
      .not.toContainEqual(expect.objectContaining({ key: "remote" }));
  });

  it("requires an inspected remote only when remote push is enabled", () => {
    const factory = gitWorkspaceFactory({
      state: { get: () => undefined, set: () => {}, delete: () => {} },
      worktreeRoot: "/tmp/worktrees",
    });

    expect(() => factory.validate({ baseBranch: "main", pushToRemote: true }))
      .toThrow("GIT_REMOTE_REQUIRED");
    expect(() => factory.validate({ baseBranch: "main", pushToRemote: false }))
      .not.toThrow();
    expect(() => factory.validate({ baseBranch: "main", delivery: "remote", remote: "delivery" }))
      .not.toThrow();
  });

  it("creates one stable Issue branch and worktree", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });

    const first = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const second = await provider.acquire({ issue: fixture.issue, project: fixture.project });

    expect(second).toEqual(first);
    expect(first.projectPath).not.toBe(fixture.project.path);
    expect(await git(fixture.repository, "branch", "--show-current")).toBe("main");
    expect(await git(first.projectPath, "branch", "--show-current")).toBe("ohmybug/omb-1");
  });

  it("maps a project subdirectory into the isolated worktree", async () => {
    const fixture = await createGitFixture("apps/shop");
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });

    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });

    expect(acquired.projectPath).toBe(join(
      fixture.worktreeRoot,
      fixture.project.id,
      fixture.issue.id,
      "apps/shop",
    ));
    await expect(access(join(acquired.projectPath, "project.txt"))).resolves.toBeUndefined();
  });

  it("recreates a missing worktree from persisted resource state", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const factory = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    });
    const first = await factory.create({ baseBranch: "main", pushToRemote: false })
      .acquire({ issue: fixture.issue, project: fixture.project });
    await git(fixture.repository, "worktree", "remove", first.projectPath);
    await rm(first.projectPath, { recursive: true, force: true });

    const recovered = await factory.create({})
      .acquire({ issue: fixture.issue, project: fixture.project });

    expect(recovered).toEqual(first);
    expect(await git(recovered.projectPath, "branch", "--show-current"))
      .toBe("ohmybug/omb-1");
  });
});
