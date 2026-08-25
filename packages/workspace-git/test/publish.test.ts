import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Issue } from "@oh-my-bug/core";
import type { WorkspacePublishResult } from "@oh-my-bug/module-api";
import { afterEach, describe, expect, it } from "vitest";

import { gitWorkspaceFactory } from "../src/index.js";
import { createGitFixture, git } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

function publishedCommit(result: WorkspacePublishResult): string {
  if (result.kind !== "PUBLISHED" || !result.branch) throw new Error("PUBLISHED_BRANCH_REQUIRED");
  return result.branch.commit;
}

async function preparedIntegration(path = "src/feature.ts") {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({ baseBranch: "main", pushToRemote: false, mergeToBaseBranch: true });
  const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
  const baseCommit = await git(fixture.repository, "rev-parse", "main");
  await mkdir(dirname(join(acquired.projectPath, path)), { recursive: true });
  await writeFile(join(acquired.projectPath, path), "integrated issue behavior\n");
  await git(acquired.projectPath, "add", path);
  await git(acquired.projectPath, "commit", "-m", "integrate issue behavior");
  const issueCommit = await git(acquired.projectPath, "rev-parse", "HEAD");
  const issue: Issue = {
    ...fixture.issue,
    projectPath: acquired.projectPath,
    status: "FINALIZING",
    resolution: "FIXED",
    repair: {
      iteration: 1,
      deliveryDraft: {
        summary: "Integrated latest main",
        repairIteration: 1,
        implementationCompletedAt: fixture.issue.updatedAt,
        integration: {
          baseBranch: "main",
          baseCommit,
          issueBranch: "ohmybug/omb-1",
          issueCommit,
          conflicts: [],
          verification: [{ command: "pnpm test", outcome: "PASSED", summary: "Passed" }],
        },
      },
      delivery: { summary: "Integrated latest main", evidence: [] },
    },
  };
  return { fixture, provider, acquired, issue, baseCommit, issueCommit };
}

describe("GitWorkspace guarded publication", () => {
  it("never creates a commit from dirty Issue files", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false, mergeToBaseBranch: false });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
    const before = await git(acquired.projectPath, "rev-parse", "HEAD");
    await writeFile(join(acquired.projectPath, "dirty.txt"), "not committed\n");
    const finalizing = {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "FINALIZING" as const,
      resolution: "FIXED" as const,
    };

    await expect(provider.publish({ issue: finalizing, resourceId: acquired.resourceId }))
      .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");
    expect(await git(acquired.projectPath, "rev-parse", "HEAD")).toBe(before);
  });

  it("fast-forwards a checked-out baseline to the accepted Issue commit", async () => {
    const prepared = await preparedIntegration();
    const result = await prepared.provider.publish({
      issue: prepared.issue,
      resourceId: prepared.acquired.resourceId,
    });

    expect(result).toMatchObject({ kind: "PUBLISHED" });
    expect(publishedCommit(result)).toBe(prepared.issueCommit);
    expect(await git(prepared.fixture.repository, "rev-parse", "main"))
      .toBe(prepared.issueCommit);
    expect(await git(prepared.fixture.repository, "show", "main:src/feature.ts"))
      .toBe("integrated issue behavior");
  });

  it("uses guarded update-ref when the baseline is not checked out", async () => {
    const prepared = await preparedIntegration();
    await git(prepared.fixture.repository, "switch", "--detach");
    const result = await prepared.provider.publish({
      issue: prepared.issue,
      resourceId: prepared.acquired.resourceId,
    });
    expect(result.kind).toBe("PUBLISHED");
    expect(await git(prepared.fixture.repository, "rev-parse", "main"))
      .toBe(prepared.issueCommit);
  });

  it("returns BASE_STALE without moving either branch when main diverges", async () => {
    const prepared = await preparedIntegration();
    await writeFile(join(prepared.fixture.repository, "advanced.ts"), "advanced base\n");
    await git(prepared.fixture.repository, "add", "advanced.ts");
    await git(prepared.fixture.repository, "commit", "-m", "advance main");
    const advanced = await git(prepared.fixture.repository, "rev-parse", "main");
    const result = await prepared.provider.publish({
      issue: prepared.issue,
      resourceId: prepared.acquired.resourceId,
    });
    expect(result).toEqual({ kind: "BASE_STALE", currentBaseCommit: advanced });
    expect(await git(prepared.fixture.repository, "rev-parse", "main")).toBe(advanced);
    expect(await git(prepared.acquired.projectPath, "rev-parse", "HEAD"))
      .toBe(prepared.issueCommit);
  });

  it("requires the accepted integration commit to equal Issue HEAD", async () => {
    const prepared = await preparedIntegration();
    const staleIssue: Issue = {
      ...prepared.issue,
      repair: {
        ...prepared.issue.repair!,
        deliveryDraft: {
          ...prepared.issue.repair!.deliveryDraft!,
          integration: {
            ...prepared.issue.repair!.deliveryDraft!.integration!,
            issueCommit: prepared.baseCommit,
          },
        },
      },
    };
    await expect(prepared.provider.publish({
      issue: staleIssue,
      resourceId: prepared.acquired.resourceId,
    })).rejects.toThrow("GIT_PUBLISH_HEAD_MISMATCH");
    expect(await git(prepared.fixture.repository, "rev-parse", "main"))
      .toBe(prepared.baseCommit);
  });

  it("is idempotent when main already contains the accepted Issue commit", async () => {
    const prepared = await preparedIntegration();
    const first = await prepared.provider.publish({
      issue: prepared.issue,
      resourceId: prepared.acquired.resourceId,
    });
    const second = await prepared.provider.publish({
      issue: prepared.issue,
      resourceId: prepared.acquired.resourceId,
    });
    expect(second).toEqual(first);
  });

  it("preserves unrelated tracked, staged, untracked, and ignored baseline state", async () => {
    const prepared = await preparedIntegration("apps/desktop/src/app.ts");
    const repository = prepared.fixture.repository;
    await writeFile(join(repository, "README.md"), "unrelated unstaged change\n");
    await writeFile(join(repository, "staged.txt"), "staged personal file\n");
    await git(repository, "add", "staged.txt");
    await writeFile(join(repository, "local.txt"), "untracked personal file\n");
    await mkdir(join(repository, "apps/other-tool"), { recursive: true });
    await writeFile(join(repository, ".git", "info", "exclude"), "apps/other-tool/cache.bin\n");
    await writeFile(join(repository, "apps/other-tool/cache.bin"), "ignored cache\n");
    const indexBefore = await git(repository, "ls-files", "--stage", "staged.txt");

    const result = await prepared.provider.publish({
      issue: prepared.issue,
      resourceId: prepared.acquired.resourceId,
    });

    expect(result.kind).toBe("PUBLISHED");
    expect(await readFile(join(repository, "README.md"), "utf8"))
      .toBe("unrelated unstaged change\n");
    expect(await readFile(join(repository, "staged.txt"), "utf8"))
      .toBe("staged personal file\n");
    expect(await readFile(join(repository, "local.txt"), "utf8"))
      .toBe("untracked personal file\n");
    expect(await readFile(join(repository, "apps/other-tool/cache.bin"), "utf8"))
      .toBe("ignored cache\n");
    expect(await git(repository, "ls-files", "--stage", "staged.txt")).toBe(indexBefore);
  });

  it.each([
    ["README.md", "README.md"],
    ["feature/file.ts", "feature"],
    ["feature", "feature/local.txt"],
  ] as const)("rejects local path overlap: Issue %s / baseline %s", async (issuePath, localPath) => {
    const prepared = await preparedIntegration(issuePath);
    await mkdir(dirname(join(prepared.fixture.repository, localPath)), { recursive: true });
    await writeFile(join(prepared.fixture.repository, localPath), "personal overlap\n");

    await expect(prepared.provider.publish({
      issue: prepared.issue,
      resourceId: prepared.acquired.resourceId,
    })).rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");
    expect(await git(prepared.fixture.repository, "rev-parse", "main"))
      .toBe(prepared.baseCommit);
    expect(await readFile(join(prepared.fixture.repository, localPath), "utf8"))
      .toBe("personal overlap\n");
  });
});
