import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { AgentAdapter, Issue, RepairResult } from "@oh-my-bug/core";
import {
  openRuntimeDatabase,
  SqliteRuntimeStore,
  SqliteWorkspaceStore,
} from "@oh-my-bug/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntime } from "../../src/composition.js";
import { FakeAgent } from "../helpers/fakes.js";
import { now, project } from "../helpers/runtime.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class IntegratingAgent extends FakeAgent {
  constructor(private readonly conflict: boolean) {
    super();
  }

  override async repair(
    session: Parameters<AgentAdapter["repair"]>[0],
    input: Parameters<AgentAdapter["repair"]>[1],
  ): Promise<RepairResult> {
    await super.repair(session, input);
    const workspace = input.issue.projectPath;
    const integration = input.integration;
    if (!workspace || !integration) throw new Error("INTEGRATION_INPUT_REQUIRED");

    if (!this.conflict) {
      await writeFile(join(workspace, "feature.txt"), "AI implementation\n");
      await git(workspace, "add", "feature.txt");
      await git(workspace, "commit", "-m", "implement feature");
      await git(workspace, "merge", "--no-edit", integration.observedBaseCommit);
      const issueCommit = await git(workspace, "rev-parse", "HEAD");
      return delivery(integration.observedBaseCommit, issueCommit, []);
    }

    const businessContinuation = input.continuation?.reason === "REVIEW_SUBMITTED"
      && input.continuation.kind === "business-merge-conflict";
    if (!businessContinuation) {
      await writeFile(join(workspace, "README.md"), "Issue cancellation policy\n");
      await git(workspace, "add", "README.md");
      await git(workspace, "commit", "-m", "change cancellation policy");
      const issueCommit = await git(workspace, "rev-parse", "HEAD");
      await git(workspace, "merge", integration.observedBaseCommit).catch(() => undefined);
      return {
        kind: "BUSINESS_DECISION_REQUIRED",
        summary: "The two cancellation policies are mutually exclusive.",
        decision: {
          baseCommit: integration.observedBaseCommit,
          issueCommit,
          conflictPaths: ["README.md"],
          baseIntent: "Keep the order pending after a gateway timeout.",
          issueIntent: "Cancel the order after a gateway timeout.",
          incompatibility: "The same order cannot be pending and canceled.",
          recommendation: "keep-issue",
          rationale: "The approved Issue explicitly changes the cancellation contract.",
          choices: [{
            id: "keep-base",
            label: "保留基线行为",
            description: "Keep the latest main-branch behavior.",
          }, {
            id: "keep-issue",
            label: "保留 Issue 行为",
            description: "Apply the approved Issue behavior.",
          }],
        },
      };
    }

    if (
      input.continuation?.reason !== "REVIEW_SUBMITTED"
      || input.continuation.kind !== "business-merge-conflict"
      || input.continuation.choiceId !== "keep-issue"
    ) {
      throw new Error("EXPECTED_KEEP_ISSUE");
    }
    await writeFile(join(workspace, "README.md"), "Issue cancellation policy\n");
    await git(workspace, "add", "README.md");
    await git(workspace, "commit", "-m", "resolve cancellation policy");
    const issueCommit = await git(workspace, "rev-parse", "HEAD");
    return delivery(integration.observedBaseCommit, issueCommit, ["README.md"]);
  }
}

describe("AI-owned base integration acceptance", () => {
  it("integrates the latest main commit, preserves unrelated personal files, and fast-forwards main", async () => {
    const fixture = await createFixture(new IntegratingAgent(false), "compatible");
    const runtime = createRuntime(fixture.options);
    await runtime.start();
    const assessed = await createAssessed(runtime, fixture.projectId, "compatible-change");

    await writeFile(join(fixture.repository, "base.txt"), "latest main behavior\n");
    await git(fixture.repository, "add", "base.txt");
    await git(fixture.repository, "commit", "-m", "advance main");
    const latestBase = await git(fixture.repository, "rev-parse", "main");

    submit(runtime, assessed, "implement", { title: assessed.assessment!.suggestedTitle });
    await runtime.drain();
    const deliveryReview = runtime.getIssue(assessed.id);
    expect(deliveryReview).toMatchObject({
      status: "REVIEW_REQUIRED",
      review: { kind: "delivery" },
      repair: { iteration: 1, deliveryDraft: { integration: { baseCommit: latestBase } } },
    });
    expect(fixture.agent.repairInputs[0]?.integration).toMatchObject({
      baseBranch: "main",
      observedBaseCommit: latestBase,
    });

    await writeFile(join(fixture.repository, "personal.notes"), "do not touch\n");
    submit(runtime, deliveryReview, "accept");
    await runtime.drain();

    const completed = runtime.getIssue(assessed.id);
    expect(completed).toMatchObject({ status: "COMPLETED", resolution: "FIXED" });
    expect(await git(fixture.repository, "rev-parse", "main"))
      .toBe(completed.repair!.deliveryDraft!.integration!.issueCommit);
    expect(await readFile(join(fixture.repository, "base.txt"), "utf8")).toBe("latest main behavior\n");
    expect(await readFile(join(fixture.repository, "feature.txt"), "utf8")).toBe("AI implementation\n");
    expect(await readFile(join(fixture.repository, "personal.notes"), "utf8")).toBe("do not touch\n");
    await runtime.stop();
  });

  it("persists a mutually exclusive business decision and resumes the same Repair session and iteration", async () => {
    const fixture = await createFixture(new IntegratingAgent(true), "business");
    const runtime = createRuntime(fixture.options);
    await runtime.start();
    const assessed = await createAssessed(runtime, fixture.projectId, "business-conflict");
    const acquiredHead = await git(assessed.projectPath!, "rev-parse", "HEAD");

    await writeFile(join(fixture.repository, "README.md"), "Base cancellation policy\n");
    await git(fixture.repository, "add", "README.md");
    await git(fixture.repository, "commit", "-m", "change base cancellation policy");
    expect(await git(assessed.projectPath!, "rev-parse", "HEAD")).toBe(acquiredHead);
    expect(await git(fixture.repository, "rev-parse", "main")).not.toBe(acquiredHead);
    submit(runtime, assessed, "implement", { title: assessed.assessment!.suggestedTitle });
    await runtime.drain();
    const paused = runtime.getIssue(assessed.id);
    expect(paused).toMatchObject({
      status: "REVIEW_REQUIRED",
      review: {
        kind: "business-merge-conflict",
        choices: [{ id: "keep-base" }, { id: "keep-issue" }],
      },
      repair: { iteration: 1 },
      agentSession: { sessionId: "session-1" },
    });
    await runtime.stop();

    const reopened = createRuntime(fixture.options);
    await reopened.start();
    const persisted = reopened.getIssue(assessed.id);
    expect(persisted.review?.id).toBe(paused.review?.id);
    submit(reopened, persisted, "keep-issue");
    await reopened.drain();

    const deliveryReview = reopened.getIssue(assessed.id);
    expect(deliveryReview).toMatchObject({
      status: "REVIEW_REQUIRED",
      review: { kind: "delivery" },
      repair: { iteration: 1 },
      agentSession: { sessionId: "session-1" },
    });
    expect(fixture.agent.repairSessions).toEqual(["session-1", "session-1"]);
    expect(fixture.agent.repairInputs[1]?.continuation).toEqual({
      reason: "REVIEW_SUBMITTED",
      requestId: paused.review!.id,
      kind: "business-merge-conflict",
      choiceId: "keep-issue",
    });

    submit(reopened, deliveryReview, "accept");
    await reopened.drain();
    expect(reopened.getIssue(assessed.id)).toMatchObject({ status: "COMPLETED", resolution: "FIXED" });
    expect(await readFile(join(fixture.repository, "README.md"), "utf8"))
      .toBe("Issue cancellation policy\n");
    await reopened.stop();
  });
});

function delivery(baseCommit: string, issueCommit: string, conflicts: string[]): RepairResult {
  return {
    kind: "DELIVERY_READY",
    summary: "Integrated and verified the latest base.",
    evidence: [],
    integration: {
      baseCommit,
      issueCommit,
      conflicts: conflicts.map((path) => ({
        path,
        classification: "COMPATIBLE_BUSINESS" as const,
        resolution: "Applied the explicit human business decision.",
      })),
    },
    verification: [{ command: "pnpm test", outcome: "PASSED", summary: "Passed" }],
  };
}

async function createAssessed(
  runtime: ReturnType<typeof createRuntime>,
  projectId: string,
  commandId: string,
) {
  const created = await runtime.submitManual(projectId, { commandId, content: commandId });
  if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
  await runtime.drain();
  const assessed = runtime.getIssue(created.issue.id);
  expect(assessed).toMatchObject({ status: "REVIEW_REQUIRED", review: { kind: "assessment" } });
  return assessed;
}

function submit(
  runtime: ReturnType<typeof createRuntime>,
  issue: Issue,
  choiceId: string,
  data?: Record<string, string>,
) {
  if (!issue.review) throw new Error("REVIEW_REQUIRED");
  return runtime.submitReview(issue.id, {
    expectedRevision: issue.revision,
    requestId: issue.review.id,
    choiceId,
    ...(data ? { data } : {}),
  });
}

async function createFixture(agent: IntegratingAgent, name: string) {
  const root = await mkdtemp(join(tmpdir(), `ohmybug-ai-integration-${name}-`));
  roots.push(root);
  const repository = join(root, "repository");
  await mkdir(repository);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.email", "tests@example.com");
  await git(repository, "config", "user.name", "OhMyBug Tests");
  await writeFile(join(repository, "README.md"), "Initial cancellation policy\n");
  await git(repository, "add", "README.md");
  await git(repository, "commit", "-m", "baseline");

  const databasePath = join(root, "runtime.sqlite");
  const database = openRuntimeDatabase(databasePath);
  const store = new SqliteRuntimeStore(database);
  const projectId = `git-${name}`;
  store.registerProject({ ...project, id: projectId, key: "GIT", path: repository });
  new SqliteWorkspaceStore(database).setProjectConfiguration(projectId, {
    provider: "git",
    config: { baseBranch: "main", pushToRemote: false, mergeToBaseBranch: true },
  });
  store.close();
  let sequence = 0;
  return {
    root,
    repository,
    projectId,
    agent,
    options: {
      databasePath,
      evidenceRoot: join(root, "evidence"),
      agent,
      id: () => `${name}-${++sequence}`,
      now: () => now,
    },
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}
