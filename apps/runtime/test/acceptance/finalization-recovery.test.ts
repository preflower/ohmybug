import { execFile } from "node:child_process";
import { appendFile, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  AgentAdapter,
  AgentSessionRef,
  FinalizationRecoveryInput,
  FinalizationRecoveryResult,
} from "@oh-my-bug/core";
import { gitWorkspaceFactory } from "@oh-my-bug/workspace-git";
import { afterEach, describe, expect, it } from "vitest";

import { RuntimeWorker } from "../../src/orchestration/worker.js";
import { FakeAgent } from "../helpers/fakes.js";
import { assessment, createHarness, eventIds, now, project } from "../helpers/runtime.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("automatic Git finalization recovery", () => {
  it("completes OHMYBUG-14 after one AI removal of generated nested-repository pollution", async () => {
    const fixture = await createGitFixture(async (input) => {
      await rm(fixturePath(input, "_tmp_fixture"), { recursive: true, force: true });
      await rm(generatedCapturePath(input), { recursive: true, force: true });
      return recovered([
        ".pnpm-store/shared/v11/tmp/_tmp_fixture",
        ".oh-my-bug-tmp-capture",
      ]);
    });
    const before = fixture.fixture.store.getIssue(fixture.issueId)!;
    const originalSession = before.agentSession;

    fixture.fixture.commands.approveDelivery(fixture.issueId);
    await fixture.worker.drain();

    const completed = fixture.fixture.store.getIssue(fixture.issueId)!;
    expect(completed).toMatchObject({ status: "COMPLETED", agentSession: originalSession });
    expect(fixture.agent.recoveryInputs).toHaveLength(1);
    expect(fixture.agent.recoveryInputs[0]).toMatchObject({
      diagnostic: {
        providerId: "git",
        step: "add",
        relatedPaths: expect.arrayContaining([
          expect.stringContaining(".pnpm-store"),
          ".oh-my-bug-tmp-capture",
        ]),
      },
    });
    const events = fixture.fixture.store.readEvents(fixture.issueId);
    expectInOrder(events.map((event) => event.type), [
      "WORKSPACE_PUBLISH_FAILED",
      "DELIVERY_FINALIZATION_RECOVERY_STARTED",
      "DELIVERY_FINALIZATION_RECOVERY_COMPLETED",
      "DELIVERY_FINALIZATION_AUTO_RETRIED",
      "ISSUE_COMPLETED",
    ]);
    const completion = events.findLast((event) => event.type === "ISSUE_COMPLETED");
    const branch = (completion?.data.branch as { name?: unknown } | undefined)?.name;
    expect(typeof branch).toBe("string");
    expect(await git(fixture.repository, "show", `${branch}:approved.txt`))
      .toBe("human-approved source change");
    expect(await git(fixture.repository, "ls-tree", "-r", "--name-only", String(branch)))
      .not.toContain(".pnpm-store");
    expect(await git(fixture.repository, "ls-tree", "-r", "--name-only", String(branch)))
      .not.toContain(".oh-my-bug-tmp-capture");
    expect(await git(fixture.repository, "rev-list", "--count", `main..${branch}`)).toBe("1");
    expect(fixture.fixture.workspacePersistence.getBinding(fixture.issueId))
      .toMatchObject({ status: "RELEASED" });
  });

  it("requires evidence again when the AI changes approved source content", async () => {
    const fixture = await createGitFixture(async (input) => {
      await rm(fixturePath(input, "_tmp_fixture"), { recursive: true, force: true });
      await rm(generatedCapturePath(input), { recursive: true, force: true });
      await appendFile(join(input.issue.projectPath!, "approved.txt"), "\nAI changed product behavior\n");
      return {
        ...recovered([
          "approved.txt",
          ".pnpm-store/shared/v11/tmp/_tmp_fixture",
          ".oh-my-bug-tmp-capture",
        ]),
        disposition: "REVALIDATION_REQUIRED",
      };
    });

    fixture.fixture.commands.approveDelivery(fixture.issueId);
    await fixture.worker.drainOne();
    await fixture.worker.drainOne();

    expect(fixture.fixture.store.getIssue(fixture.issueId)).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      repair: { iteration: 2, deliveryDraft: { repairIteration: 2 } },
    });
    expect(fixture.fixture.store.listPendingOperations().map((pending) => pending.operation))
      .toEqual(["CAPTURE_EVIDENCE"]);
    expect(fixture.fixture.store.readEvents(fixture.issueId).map((event) => event.type))
      .toContain("DELIVERY_FINALIZATION_REVALIDATION_REQUIRED");
  });

  it("requires evidence when the AI changes source and then throws", async () => {
    const fixture = await createGitFixture(async (input) => {
      await rm(fixturePath(input, "_tmp_fixture"), { recursive: true, force: true });
      await rm(generatedCapturePath(input), { recursive: true, force: true });
      await appendFile(join(input.issue.projectPath!, "approved.txt"), "\npartial AI edit\n");
      throw new Error("Agent failed after editing source");
    });

    fixture.fixture.commands.approveDelivery(fixture.issueId);
    await fixture.worker.drainOne();
    await fixture.worker.drainOne();

    expect(fixture.fixture.store.getIssue(fixture.issueId)).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      repair: { iteration: 2 },
    });
    expect(fixture.fixture.store.listPendingOperations().map((pending) => pending.operation))
      .toEqual(["CAPTURE_EVIDENCE"]);
    expect(fixture.fixture.store.readEvents(fixture.issueId).map((event) => event.type))
      .toContain("DELIVERY_FINALIZATION_REVALIDATION_REQUIRED");
  });

  it("requires evidence when the AI changes source but leaves generated pollution", async () => {
    const fixture = await createGitFixture(async (input) => {
      await appendFile(join(input.issue.projectPath!, "approved.txt"), "\npartial AI edit\n");
      return {
        ...recovered(["approved.txt"]),
        disposition: "UNSAFE",
      };
    });

    fixture.fixture.commands.approveDelivery(fixture.issueId);
    await fixture.worker.drainOne();
    await fixture.worker.drainOne();

    expect(fixture.fixture.store.getIssue(fixture.issueId)).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      repair: { iteration: 2 },
    });
    expect(fixture.fixture.store.listPendingOperations().map((pending) => pending.operation))
      .toEqual(["CAPTURE_EVIDENCE"]);
  });

  it("stops after one attempt when generated pollution remains", async () => {
    const fixture = await createGitFixture(async () => recovered([]));

    fixture.fixture.commands.approveDelivery(fixture.issueId);
    await fixture.worker.drainOne();
    await fixture.worker.drainOne();

    expect(fixture.fixture.store.getIssue(fixture.issueId)).toMatchObject({
      status: "FINALIZATION_FAILED",
      lastFailure: {
        stage: "FINALIZATION_RECOVERY",
        code: "FINALIZATION_RECOVERY_UNSAFE",
      },
    });
    expect(fixture.agent.recoveryInputs).toHaveLength(1);
    expect(fixture.fixture.store.listPendingOperations()).toEqual([]);
  });

  it("does not start a second AI attempt when the automatic publish retry also fails", async () => {
    const fixture = await createGitFixture(async (input) => {
      await rm(fixturePath(input, "_tmp_fixture"), { recursive: true, force: true });
      await rm(generatedCapturePath(input), { recursive: true, force: true });
      return recovered([
        ".pnpm-store/shared/v11/tmp/_tmp_fixture",
        ".oh-my-bug-tmp-capture",
      ]);
    });
    const hook = join(fixture.repository, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\nexit 1\n");
    await chmod(hook, 0o755);

    fixture.fixture.commands.approveDelivery(fixture.issueId);
    await fixture.worker.drain();

    expect(fixture.fixture.store.getIssue(fixture.issueId)).toMatchObject({
      status: "FINALIZATION_FAILED",
      finalizationRecovery: { automaticAttempts: 1 },
    });
    expect(fixture.agent.recoveryInputs).toHaveLength(1);
    expect(fixture.fixture.store.listPendingOperations()).toEqual([]);
  });
});

class RecoveryAgent extends FakeAgent {
  readonly recoveryInputs: FinalizationRecoveryInput[] = [];

  constructor(
    private readonly recovery: (
      input: FinalizationRecoveryInput,
    ) => Promise<FinalizationRecoveryResult>,
  ) {
    super();
  }

  async recoverFinalization(
    _session: AgentSessionRef,
    input: FinalizationRecoveryInput,
  ): Promise<FinalizationRecoveryResult> {
    this.recoveryInputs.push(input);
    return this.recovery(input);
  }
}

async function createGitFixture(
  recovery: (input: FinalizationRecoveryInput) => Promise<FinalizationRecoveryResult>,
) {
  const root = await mkdtemp(join(tmpdir(), "ohmybug-finalization-recovery-"));
  temporaryRoots.push(root);
  const repository = join(root, "repository");
  await mkdir(repository);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.email", "tests@example.com");
  await git(repository, "config", "user.name", "OhMyBug Tests");
  await writeFile(join(repository, "README.md"), "baseline\n");
  await git(repository, "add", "README.md");
  await git(repository, "commit", "-m", "baseline");

  const agent = new RecoveryAgent(recovery);
  const fixture = createHarness(agent as AgentAdapter);
  fixture.workspaceRegistry.register(gitWorkspaceFactory({
    state: fixture.workspacePersistence,
    worktreeRoot: join(root, "worktrees"),
  }));
  const gitProject = {
    ...project,
    id: "git-recovery-project",
    key: "GITREC",
    path: repository,
  };
  fixture.commands.registerProject(gitProject);
  fixture.workspacePersistence.setProjectConfiguration(gitProject.id, {
    provider: "git",
    config: { baseBranch: "main", pushToRemote: false, mergeToBaseBranch: false },
  });
  const worker = new RuntimeWorker({
    store: fixture.store,
    agents: fixture.agents,
    evidence: fixture.evidence,
    workspaces: fixture.workspaces,
    hooks: fixture.hooks,
    id: eventIds("git-finalization-recovery"),
    now: () => now,
  });
  const created = await fixture.commands.submitManual(gitProject.id, {
    commandId: "git-finalization-recovery",
    content: "Checkout fails",
  });
  if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
  await worker.drain();
  fixture.commands.approveAssessment(created.issue.id, {
    assessmentRevision: assessment.revision,
    assessmentContentHash: assessment.contentHash,
    title: assessment.suggestedTitle,
  });
  await worker.drain();
  const ready = fixture.store.getIssue(created.issue.id)!;
  if (!ready.projectPath) throw new Error("PROJECT_PATH_REQUIRED");
  await writeFile(join(ready.projectPath, "approved.txt"), "human-approved source change\n");
  const nestedRepository = join(
    ready.projectPath,
    ".pnpm-store",
    "shared",
    "v11",
    "tmp",
    "_tmp_fixture",
  );
  await mkdir(nestedRepository, { recursive: true });
  await git(nestedRepository, "init");
  const generatedCapture = join(ready.projectPath, ".oh-my-bug-tmp-capture");
  await mkdir(generatedCapture);
  await writeFile(join(generatedCapture, "artifact.txt"), "generated capture\n");
  return { fixture, agent, worker, issueId: created.issue.id, repository };
}

function fixturePath(input: FinalizationRecoveryInput, name: string): string {
  return join(
    input.issue.projectPath!,
    ".pnpm-store",
    "shared",
    "v11",
    "tmp",
    name,
  );
}

function generatedCapturePath(input: FinalizationRecoveryInput): string {
  return join(input.issue.projectPath!, ".oh-my-bug-tmp-capture");
}

function recovered(affectedPaths: string[]): FinalizationRecoveryResult {
  return {
    summary: "Removed generated workspace pollution",
    diagnosis: "An untracked package-manager cache contained a nested repository",
    disposition: "RECOVERED",
    affectedPaths,
  };
}

function expectInOrder(actual: string[], expected: string[]): void {
  let cursor = -1;
  for (const type of expected) {
    const next = actual.indexOf(type, cursor + 1);
    expect(next, `${type} must occur after ${actual[cursor] ?? "the start"}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}
