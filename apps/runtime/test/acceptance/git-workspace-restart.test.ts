import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  openRuntimeDatabase,
  SqliteRuntimeStore,
  SqliteWorkspaceStore,
} from "@oh-my-bug/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntime } from "../../src/composition.js";
import { FakeAgent } from "../helpers/fakes.js";
import { assessment, now, project } from "../helpers/runtime.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Git Workspace restart acceptance", () => {
  it("reuses the persisted Git binding after the project default changes", async () => {
    const fixture = await createFixture("local");
    const runtime = createRuntime(fixture.runtimeOptions);
    await runtime.start();
    const created = await runtime.submitManual(fixture.gitProject.id, {
      commandId: "git-binding",
      content: "Checkout fails",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await runtime.drain();
    const projectPath = runtime.getIssue(created.issue.id).projectPath;
    expect(projectPath).toContain("worktrees");
    await runtime.stop();

    const database = openRuntimeDatabase(fixture.databasePath);
    const workspaceStore = new SqliteWorkspaceStore(database);
    workspaceStore.setProjectConfiguration(fixture.gitProject.id, {
      provider: "local",
      config: {},
    });
    expect(workspaceStore.getBinding(created.issue.id)?.providerId).toBe("git");
    database.close();

    const reopened = createRuntime(fixture.runtimeOptions);
    await reopened.start();
    expect(reopened.getIssue(created.issue.id).projectPath).toBe(projectPath);
    await reopened.stop();
  });

  it("resumes failed remote publication without rerunning Repair", async () => {
    const fixture = await createFixture("remote");
    const runtime = createRuntime(fixture.runtimeOptions);
    await runtime.start();
    const created = await runtime.submitManual(fixture.gitProject.id, {
      commandId: "git-publish-restart",
      content: "Checkout fails",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await runtime.drain();
    const assessed = runtime.getIssue(created.issue.id);
    expect(assessed).toMatchObject({
      status: "ASSESSMENT_REVIEW",
      assessment,
    });
    runtime.approveAssessment(assessed.id, {
      assessmentRevision: assessment.revision,
      assessmentContentHash: assessment.contentHash,
      title: assessment.suggestedTitle,
    });
    await runtime.drain();

    const failed = await runtime.approveDelivery(assessed.id);
    expect(failed.issue.status).toBe("FINALIZING");
    await runtime.drain();
    expect(runtime.getIssue(assessed.id).status).toBe("FINALIZATION_FAILED");
    expect(fixture.agent.repairInputs).toHaveLength(1);
    await runtime.stop();

    const remote = join(fixture.root, "delivery.git");
    await mkdir(remote);
    await git(remote, "init", "--bare");
    await git(fixture.repository, "remote", "add", "delivery", remote);

    const reopened = createRuntime(fixture.runtimeOptions);
    await reopened.start();
    await reopened.drain();

    expect(reopened.getIssue(assessed.id).status).toBe("FINALIZATION_FAILED");
    const completed = await reopened.approveDelivery(assessed.id);
    expect(completed.issue.status).toBe("FINALIZING");
    await reopened.drain();
    expect(reopened.getIssue(assessed.id).status).toBe("COMPLETED");
    expect(fixture.agent.repairInputs).toHaveLength(1);
    expect(reopened.readIssueEvents(assessed.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "ISSUE_COMPLETED",
        data: expect.objectContaining({
          branch: expect.objectContaining({ remote: "delivery" }),
        }),
      }),
    ]));
    await reopened.stop();
  });
});

async function createFixture(delivery: "local" | "remote") {
  const root = await mkdtemp(join(tmpdir(), "ohmybug-git-restart-"));
  roots.push(root);
  const repository = join(root, "repository");
  await mkdir(repository);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.email", "tests@example.com");
  await git(repository, "config", "user.name", "OhMyBug Tests");
  await writeFile(join(repository, "README.md"), "baseline\n");
  await git(repository, "add", "README.md");
  await git(repository, "commit", "-m", "baseline");

  const databasePath = join(root, "runtime.sqlite");
  const database = openRuntimeDatabase(databasePath);
  const store = new SqliteRuntimeStore(database);
  const gitProject = { ...project, id: "git-project", key: "GIT", path: repository };
  store.registerProject(gitProject);
  new SqliteWorkspaceStore(database).setProjectConfiguration(gitProject.id, {
    provider: "git",
    config: {
      baseBranch: "main",
      delivery,
      ...(delivery === "remote" ? { remote: "delivery" } : {}),
    },
  });
  store.close();

  const agent = new FakeAgent();
  let sequence = 0;
  return {
    root,
    repository,
    databasePath,
    gitProject,
    agent,
    runtimeOptions: {
      databasePath,
      evidenceRoot: join(root, "evidence"),
      agent,
      id: () => `git-restart-${++sequence}`,
      now: () => now,
    },
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}
