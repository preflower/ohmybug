import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RepairResult } from "@oh-my-bug/core";
import { afterEach, describe, expect, it } from "vitest";

import { gitWorkspaceFactory } from "../src/index.js";
import { createGitFixture, git } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

function delivery(baseCommit: string, issueCommit: string): RepairResult {
  return {
    kind: "DELIVERY_READY",
    summary: "Integrated the latest base",
    evidence: [],
    integration: { baseCommit, issueCommit, conflicts: [] },
    verification: [{ command: "pnpm test", outcome: "PASSED", summary: "Passed" }],
  };
}

async function setup(mergeToBaseBranch = true) {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({ baseBranch: "main", pushToRemote: false, mergeToBaseBranch });
  const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
  const issue = { ...fixture.issue, projectPath: acquired.projectPath, status: "REPAIRING" as const };
  return { fixture, provider, acquired, issue };
}

describe("Git Repair integration", () => {
  it("observes the current immutable base on every Repair turn", async () => {
    const { fixture, provider, acquired, issue } = await setup();
    const first = await provider.observeRepair?.({ issue, resourceId: acquired.resourceId });
    await writeFile(join(fixture.repository, "base.txt"), "advanced\n");
    await git(fixture.repository, "add", "base.txt");
    await git(fixture.repository, "commit", "-m", "advance base");
    const second = await provider.observeRepair?.({ issue, resourceId: acquired.resourceId });

    expect(first).toMatchObject({
      required: true,
      baseBranch: "main",
      issueBranch: "ohmybug/omb-1",
    });
    expect(second?.baseCommit).not.toBe(first?.baseCommit);
    expect(second?.baseCommit).toBe(await git(fixture.repository, "rev-parse", "main"));
  });

  it("opts out when merge-to-base publication is disabled", async () => {
    const { provider, acquired, issue } = await setup(false);
    await expect(provider.observeRepair?.({ issue, resourceId: acquired.resourceId }))
      .resolves.toEqual({ required: false });
  });

  it("accepts a clean Issue commit containing the observed base", async () => {
    const { fixture, provider, acquired, issue } = await setup();
    await writeFile(join(acquired.projectPath, "issue.txt"), "issue\n");
    await git(acquired.projectPath, "add", "issue.txt");
    await git(acquired.projectPath, "commit", "-m", "issue change");
    await writeFile(join(fixture.repository, "base.txt"), "base\n");
    await git(fixture.repository, "add", "base.txt");
    await git(fixture.repository, "commit", "-m", "base change");
    const observation = await provider.observeRepair!({ issue, resourceId: acquired.resourceId });
    await git(acquired.projectPath, "merge", "--no-edit", observation.baseCommit!);
    const head = await git(acquired.projectPath, "rev-parse", "HEAD");

    await expect(provider.validateRepair?.({
      issue,
      resourceId: acquired.resourceId,
      observation,
      result: delivery(observation.baseCommit!, head),
    })).resolves.toEqual({
      kind: "DELIVERY_READY",
      branch: { name: "ohmybug/omb-1", commit: head },
    });
  });

  it.each([
    ["base mismatch", (_base: string, head: string) => delivery("f".repeat(40), head), "GIT_REPAIR_BASE_MISMATCH"],
    ["head mismatch", (base: string) => delivery(base, "e".repeat(40)), "GIT_REPAIR_HEAD_MISMATCH"],
    ["missing verification", (base: string, head: string) => ({
      ...delivery(base, head),
      verification: [],
    }), "GIT_REPAIR_VERIFICATION_REQUIRED"],
    ["failed verification", (base: string, head: string) => ({
      ...delivery(base, head),
      verification: [{ command: "pnpm test", outcome: "FAILED" as const, summary: "Failed" }],
    }), "GIT_REPAIR_VERIFICATION_REQUIRED"],
  ])("rejects %s", async (_label, mutate, code) => {
    const { provider, acquired, issue } = await setup();
    const observation = await provider.observeRepair!({ issue, resourceId: acquired.resourceId });
    const head = await git(acquired.projectPath, "rev-parse", "HEAD");

    await expect(provider.validateRepair?.({
      issue,
      resourceId: acquired.resourceId,
      observation,
      result: mutate(observation.baseCommit!, head) as RepairResult,
    })).rejects.toThrow(code);
  });

  it.each([
    ["tracked", async (path: string) => writeFile(join(path, "README.md"), "dirty\n")],
    ["staged", async (path: string) => {
      await writeFile(join(path, "staged.txt"), "dirty\n");
      await git(path, "add", "staged.txt");
    }],
    ["untracked", async (path: string) => writeFile(join(path, "untracked.txt"), "dirty\n")],
  ])("rejects a %s worktree change", async (_label, dirty) => {
    const { provider, acquired, issue } = await setup();
    const observation = await provider.observeRepair!({ issue, resourceId: acquired.resourceId });
    const head = await git(acquired.projectPath, "rev-parse", "HEAD");
    await dirty(acquired.projectPath);

    await expect(provider.validateRepair?.({
      issue,
      resourceId: acquired.resourceId,
      observation,
      result: delivery(observation.baseCommit!, head),
    })).rejects.toThrow("GIT_REPAIR_WORKTREE_DIRTY");
  });

  it("allows a real unresolved merge only for a bounded business decision", async () => {
    const { fixture, provider, acquired, issue } = await setup();
    await writeFile(join(acquired.projectPath, "README.md"), "issue behavior\n");
    await git(acquired.projectPath, "add", "README.md");
    await git(acquired.projectPath, "commit", "-m", "issue behavior");
    const issueHead = await git(acquired.projectPath, "rev-parse", "HEAD");
    await writeFile(join(fixture.repository, "README.md"), "base behavior\n");
    await git(fixture.repository, "add", "README.md");
    await git(fixture.repository, "commit", "-m", "base behavior");
    const observation = await provider.observeRepair!({ issue, resourceId: acquired.resourceId });
    await git(acquired.projectPath, "merge", observation.baseCommit!).catch(() => undefined);
    const decision: RepairResult = {
      kind: "BUSINESS_DECISION_REQUIRED",
      summary: "The two behaviors are mutually exclusive",
      decision: {
        baseCommit: observation.baseCommit!,
        issueCommit: issueHead,
        conflictPaths: ["README.md"],
        baseIntent: "Use base behavior",
        issueIntent: "Use Issue behavior",
        incompatibility: "README demonstrates one observable behavior",
        recommendation: "Use Issue behavior",
        rationale: "It matches the approved Issue",
        choices: [{ id: "use-issue", label: "Use Issue", description: "Keep Issue behavior" }],
      },
    };

    await expect(provider.validateRepair?.({
      issue,
      resourceId: acquired.resourceId,
      observation,
      result: decision,
    })).resolves.toEqual({ kind: "BUSINESS_DECISION_REQUIRED" });
    await expect(provider.validateRepair?.({
      issue,
      resourceId: acquired.resourceId,
      observation,
      result: delivery(observation.baseCommit!, issueHead),
    })).rejects.toThrow("GIT_REPAIR_UNRESOLVED_MERGE");
    await expect(provider.validateRepair?.({
      issue,
      resourceId: acquired.resourceId,
      observation,
      result: {
        ...decision,
        decision: { ...decision.decision, conflictPaths: ["other.ts"] },
      },
    })).rejects.toThrow("GIT_REPAIR_UNRESOLVED_MERGE");
  });

  it("rejects generated artifact roots before generic dirty-state handling", async () => {
    const { provider, acquired, issue } = await setup();
    const observation = await provider.observeRepair!({ issue, resourceId: acquired.resourceId });
    const head = await git(acquired.projectPath, "rev-parse", "HEAD");
    await mkdir(join(acquired.projectPath, ".pnpm-store"), { recursive: true });
    await writeFile(join(acquired.projectPath, ".pnpm-store/cache.bin"), "generated\n");

    await expect(provider.validateRepair?.({
      issue,
      resourceId: acquired.resourceId,
      observation,
      result: delivery(observation.baseCommit!, head),
    })).rejects.toThrow("GIT_REPAIR_GENERATED_ARTIFACTS_PRESENT");
  });

  it("rejects a base that was not integrated into Issue HEAD", async () => {
    const { fixture, provider, acquired, issue } = await setup();
    await writeFile(join(fixture.repository, "advanced.txt"), "base\n");
    await git(fixture.repository, "add", "advanced.txt");
    await git(fixture.repository, "commit", "-m", "advance base");
    const observation = await provider.observeRepair!({ issue, resourceId: acquired.resourceId });
    const head = await git(acquired.projectPath, "rev-parse", "HEAD");

    await expect(provider.validateRepair?.({
      issue,
      resourceId: acquired.resourceId,
      observation,
      result: delivery(observation.baseCommit!, head),
    })).rejects.toThrow("GIT_REPAIR_BASE_NOT_ANCESTOR");
  });

  it.each(["wrong-branch", "detached"] as const)(
    "rejects %s Issue HEAD state",
    async (mode) => {
      const { provider, acquired, issue } = await setup();
      const observation = await provider.observeRepair!({ issue, resourceId: acquired.resourceId });
      const head = await git(acquired.projectPath, "rev-parse", "HEAD");
      if (mode === "wrong-branch") {
        await git(acquired.projectPath, "switch", "-c", "other-branch");
      } else {
        await git(acquired.projectPath, "checkout", "--detach", head);
      }

      await expect(provider.validateRepair?.({
        issue,
        resourceId: acquired.resourceId,
        observation,
        result: delivery(observation.baseCommit!, head),
      })).rejects.toThrow("GIT_REPAIR_WRONG_BRANCH");
    },
  );

  it.each(["CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer"] as const)(
    "rejects leftover %s operation metadata",
    async (metadata) => {
      const { provider, acquired, issue } = await setup();
      const observation = await provider.observeRepair!({ issue, resourceId: acquired.resourceId });
      const head = await git(acquired.projectPath, "rev-parse", "HEAD");
      const metadataPath = await git(acquired.projectPath, "rev-parse", "--git-path", metadata);
      if (metadata === "sequencer") {
        await mkdir(metadataPath, { recursive: true });
      } else {
        await writeFile(metadataPath, head + "\n");
      }

      await expect(provider.validateRepair?.({
        issue,
        resourceId: acquired.resourceId,
        observation,
        result: delivery(observation.baseCommit!, head),
      })).rejects.toThrow("GIT_REPAIR_UNRESOLVED_MERGE");
    },
  );

  it("rejects hidden index flags", async () => {
    const { provider, acquired, issue } = await setup();
    const observation = await provider.observeRepair!({ issue, resourceId: acquired.resourceId });
    const head = await git(acquired.projectPath, "rev-parse", "HEAD");
    await git(acquired.projectPath, "update-index", "--assume-unchanged", "README.md");

    await expect(provider.validateRepair?.({
      issue,
      resourceId: acquired.resourceId,
      observation,
      result: delivery(observation.baseCommit!, head),
    })).rejects.toThrow("GIT_REPAIR_WORKTREE_DIRTY");
  });

  it("rejects an undeclared Gitlink before delivery", async () => {
    const { fixture, provider, acquired, issue } = await setup();
    const embedded = join(acquired.projectPath, "embedded");
    await mkdir(embedded);
    await git(embedded, "init", "-b", "main");
    await git(embedded, "config", "user.name", "Embedded Test");
    await git(embedded, "config", "user.email", "embedded@ohmybug.local");
    await writeFile(join(embedded, "README.md"), "embedded\n");
    await git(embedded, "add", "README.md");
    await git(embedded, "commit", "-m", "embedded");
    await git(acquired.projectPath, "add", "embedded");
    const observation = await provider.observeRepair!({ issue, resourceId: acquired.resourceId });
    const head = await git(acquired.projectPath, "rev-parse", "HEAD");

    await expect(provider.validateRepair?.({
      issue,
      resourceId: acquired.resourceId,
      observation,
      result: delivery(observation.baseCommit!, head),
    })).rejects.toThrow("GIT_REPAIR_WORKTREE_DIRTY");
    expect(await git(fixture.repository, "rev-parse", "main")).toBe(observation.baseCommit);
  });
});
