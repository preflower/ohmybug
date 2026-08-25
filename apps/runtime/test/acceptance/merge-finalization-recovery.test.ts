import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  AgentAdapter,
  AgentSessionRef,
  FinalizationRecoveryInput,
  FinalizationRecoveryResult,
  RepairResult,
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

describe("AI merge finalization recovery", () => {
  it("completes the OHMYBUG-21 conflict after renewed evidence and acceptance", async () => {
    const root = await mkdtemp(join(tmpdir(), "ohmybug-merge-recovery-"));
    temporaryRoots.push(root);
    const repository = join(root, "repository");
    await mkdir(join(repository, "apps/desktop/src/web/issues"), { recursive: true });
    await git(repository, "init", "-b", "main");
    await git(repository, "config", "user.email", "tests@example.com");
    await git(repository, "config", "user.name", "OhMyBug Tests");
    const componentPath = "apps/desktop/src/web/issues/issue-detail.tsx";
    await writeFile(join(repository, componentPath), [
      'import { Square } from "lucide-react";',
      "export const Cancel = () => <Square />;",
      "",
    ].join("\n"));
    await git(repository, "add", componentPath);
    await git(repository, "commit", "-m", "baseline component");

    const agent = new MergeRecoveryAgent();
    const fixture = createHarness(agent as AgentAdapter);
    fixture.workspaceRegistry.register(gitWorkspaceFactory({
      state: fixture.workspacePersistence,
      worktreeRoot: join(root, "worktrees"),
    }));
    const gitProject = {
      ...project,
      id: "git-merge-recovery-project",
      key: "GITMERGE",
      path: repository,
    };
    fixture.commands.registerProject(gitProject);
    fixture.workspacePersistence.setProjectConfiguration(gitProject.id, {
      provider: "git",
      config: { baseBranch: "main", pushToRemote: false, mergeToBaseBranch: true },
    });
    const worker = new RuntimeWorker({
      store: fixture.store,
      agents: fixture.agents,
      evidence: fixture.evidence,
      workspaces: fixture.workspaces,
      hooks: fixture.hooks,
      id: eventIds("git-merge-recovery"),
      now: () => now,
    });
    const created = await fixture.commands.submitManual(gitProject.id, {
      commandId: "ohmybug-21",
      content: "保留图片预览恢复逻辑，并把取消按钮图标改成 X",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await worker.drain();
    fixture.commands.approveAssessment(created.issue.id, {
      assessmentRevision: assessment.revision,
      assessmentContentHash: assessment.contentHash,
      title: "修复取消按钮图标",
    });
    await worker.drain();
    const ready = fixture.store.getIssue(created.issue.id)!;
    if (!ready.projectPath) throw new Error("PROJECT_PATH_REQUIRED");
    await writeFile(join(ready.projectPath, componentPath), [
      'import { X } from "lucide-react";',
      "export const Cancel = () => <X />;",
      "",
    ].join("\n"));
    await writeFile(join(repository, componentPath), [
      'import { ImagePreview, Square } from "lucide-react";',
      "export const Preview = () => <ImagePreview />;",
      "export const Cancel = () => <Square aria-label=\"cancel\" />;",
      "",
    ].join("\n"));
    await git(repository, "add", componentPath);
    await git(repository, "commit", "-m", "add image preview recovery UI");
    const preparedBase = await git(repository, "rev-parse", "main");

    fixture.commands.approveDelivery(created.issue.id);
    await worker.drainOne();
    expect(fixture.store.getIssue(created.issue.id)?.status).toBe("FINALIZATION_RECOVERY");
    await worker.drainOne();
    expect(fixture.store.getIssue(created.issue.id)?.status).toBe("EVIDENCE_CAPTURE");
    expect(await git(repository, "rev-parse", "main")).toBe(preparedBase);
    expect(agent.recoveryInputs[0]).toMatchObject({
      recoveryKind: "MERGE_CONFLICT",
      merge: {
        baseBranch: "main",
        baseCommit: preparedBase,
        conflictPaths: [componentPath],
        mergePrepared: true,
      },
    });

    await worker.drain();
    expect(fixture.store.getIssue(created.issue.id)?.status).toBe("ACCEPTANCE_REVIEW");
    fixture.commands.rejectDelivery(created.issue.id, "取消按钮还需要保留键盘关闭行为");
    await worker.drain();
    expect(fixture.store.getIssue(created.issue.id)?.status).toBe("ACCEPTANCE_REVIEW");
    await writeFile(
      join(repository, "apps/desktop/src/web/issues/advanced-base.ts"),
      "export const advancedBase = true;\n",
    );
    await git(repository, "add", "apps/desktop/src/web/issues/advanced-base.ts");
    await git(repository, "commit", "-m", "advance base after repaired acceptance");
    const advancedBase = await git(repository, "rev-parse", "main");
    fixture.commands.approveDelivery(created.issue.id);
    await worker.drain();
    expect(fixture.store.getIssue(created.issue.id)?.status).toBe("ACCEPTANCE_REVIEW");
    expect(agent.recoveryInputs[1]).toMatchObject({
      recoveryKind: "MERGE_CONFLICT",
      merge: {
        baseCommit: advancedBase,
        conflictPaths: [],
        mergePrepared: true,
      },
    });
    fixture.commands.approveDelivery(created.issue.id);
    await worker.drain();

    const completed = fixture.store.getIssue(created.issue.id)!;
    expect(completed.status).toBe("COMPLETED");
    const mergeCommit = await git(repository, "rev-parse", "main");
    const parents = (await git(repository, "show", "-s", "--format=%P", mergeCommit)).split(" ");
    expect(parents).toHaveLength(2);
    expect(parents[1]).toBe(advancedBase);
    expect(await git(repository, "show", `main:${componentPath}`)).toContain("ImagePreview");
    expect(await git(repository, "show", `main:${componentPath}`)).toContain("<X");
    expect(await git(repository, "show", `main:${componentPath}`)).toContain("onKeyDown");
    expect(await git(
      repository,
      "show",
      "main:apps/desktop/src/web/issues/merge-repair-note.ts",
    )).toBe('export const mergeRepairNote = "accepted after rejection";');
    expect(fixture.workspacePersistence.getBinding(created.issue.id))
      .toMatchObject({ status: "RELEASED" });
    expectInOrder(
      fixture.store.readEvents(created.issue.id).map((event) => event.type),
      [
        "WORKSPACE_PUBLISH_FAILED",
        "DELIVERY_FINALIZATION_RECOVERY_STARTED",
        "DELIVERY_FINALIZATION_MERGE_PREPARED",
        "DELIVERY_FINALIZATION_RECOVERY_COMPLETED",
        "DELIVERY_FINALIZATION_MERGE_RESOLVED",
        "DELIVERY_FINALIZATION_REVALIDATION_REQUIRED",
        "ISSUE_COMPLETED",
      ],
    );
  });
});

class MergeRecoveryAgent extends FakeAgent {
  readonly recoveryInputs: FinalizationRecoveryInput[] = [];

  async recoverFinalization(
    _session: AgentSessionRef,
    input: FinalizationRecoveryInput,
  ): Promise<FinalizationRecoveryResult> {
    this.recoveryInputs.push(input);
    const path = input.merge?.conflictPaths[0];
    if (!input.issue.projectPath) throw new Error("MERGE_CONTEXT_REQUIRED");
    if (!path) {
      return {
        summary: "基线前移后重新计算合并结果",
        diagnosis: "最新基线未引入新的内容冲突",
        disposition: "REVALIDATION_REQUIRED",
        affectedPaths: [],
      };
    }
    await writeFile(join(input.issue.projectPath, path), [
      'import { ImagePreview, X } from "lucide-react";',
      "export const Preview = () => <ImagePreview />;",
      "export const Cancel = () => <X aria-label=\"cancel\" />;",
      "",
    ].join("\n"));
    return {
      summary: "保留图片预览恢复逻辑并应用 X 图标",
      diagnosis: "Issue 与 main 同时修改了取消按钮组件",
      disposition: "REVALIDATION_REQUIRED",
      affectedPaths: [path],
    };
  }

  async repair(
    session: AgentSessionRef,
    input: Parameters<AgentAdapter["repair"]>[1],
  ): Promise<RepairResult> {
    if (!input.issue.projectPath) throw new Error("PROJECT_PATH_REQUIRED");
    const componentPath = "apps/desktop/src/web/issues/issue-detail.tsx";
    await writeFile(join(input.issue.projectPath, componentPath), [
      'import { ImagePreview, X } from "lucide-react";',
      "export const Preview = () => <ImagePreview />;",
      'export const Cancel = () => <X aria-label="cancel" onKeyDown={() => undefined} />;',
      "",
    ].join("\n"));
    await writeFile(
      join(input.issue.projectPath, "apps/desktop/src/web/issues/merge-repair-note.ts"),
      'export const mergeRepairNote = "accepted after rejection";\n',
    );
    const result = await super.repair(session, input);
    return { ...result, summary: "按拒绝反馈补充键盘行为并保留合并修复" };
  }
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
