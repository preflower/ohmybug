import type { AgentSessionRef } from "@oh-my-bug/core";
import { describe, expect, it, vi } from "vitest";

import { RuntimeWorker } from "../src/orchestration/worker.js";
import { FakeAgent } from "./helpers/fakes.js";
import { createHarness, eventIds, now, project } from "./helpers/runtime.js";

type Harness = ReturnType<typeof createHarness>;

class BlockingAssessmentAgent extends FakeAgent {
  readonly startedIssueIds: string[] = [];
  private readonly releases = new Map<string, () => void>();
  private releaseFutureAssessments = false;

  override async assess(
    session: AgentSessionRef,
    input: Parameters<FakeAgent["assess"]>[1],
  ) {
    this.startedIssueIds.push(input.issue.id);
    if (!this.releaseFutureAssessments) {
      await new Promise<void>((resolve) => {
        this.releases.set(input.issue.id, resolve);
      });
    }
    return super.assess(session, input);
  }

  release(issueId: string): void {
    this.releases.get(issueId)?.();
    this.releases.delete(issueId);
  }

  releaseAll(): void {
    this.releaseFutureAssessments = true;
    for (const release of this.releases.values()) release();
    this.releases.clear();
  }
}

function queueAssessment(
  store: Harness["store"],
  id: string,
  identifier: string,
  projectPath: string | null = project.path,
): void {
  store.transaction((transaction) => transaction.insertIssue({
    id,
    projectId: project.id,
    ...(projectPath ? { projectPath } : {}),
    identifier,
    title: identifier,
    titleSource: "user",
    status: "RECEIVED",
    inputs: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }, "ASSESS"));
}

function workerFor(
  harness: Harness,
  options?: { maxConcurrentIssues?: number },
): RuntimeWorker {
  return new RuntimeWorker({
    store: harness.store,
    agents: harness.agents,
    evidence: harness.evidence,
    workspaces: harness.workspaces,
    id: eventIds("parallel-worker"),
    now: () => now,
  }, options);
}

describe("Runtime parallel Issue scheduler", () => {
  it("starts a newly queued Issue while another Issue is active and a slot is free", async () => {
    const agent = new BlockingAssessmentAgent();
    const harness = createHarness(agent);
    const worker = workerFor(harness);
    queueAssessment(harness.store, "issue-1", "OMB-01");
    worker.kick();
    await vi.waitFor(() => expect(agent.startedIssueIds).toEqual(["issue-1"]));

    queueAssessment(harness.store, "issue-2", "OMB-02");
    worker.kick();
    try {
      await vi.waitFor(
        () => expect(agent.startedIssueIds).toContain("issue-2"),
        { timeout: 200 },
      );
    } finally {
      agent.releaseAll();
      await worker.drain();
    }
  });

  it("starts no more than three Issues by default", async () => {
    const agent = new BlockingAssessmentAgent();
    const harness = createHarness(agent);
    const worker = workerFor(harness);
    for (let index = 1; index <= 4; index += 1) {
      queueAssessment(harness.store, `issue-${index}`, `OMB-0${index}`);
    }

    worker.kick();
    await vi.waitFor(() => expect(agent.startedIssueIds).toHaveLength(3));
    expect(agent.startedIssueIds).not.toContain("issue-4");

    agent.release("issue-1");
    await vi.waitFor(() => expect(agent.startedIssueIds).toHaveLength(4));
    expect(agent.startedIssueIds).toContain("issue-4");
    agent.releaseAll();
    await worker.drain();
  });

  it("does not overlap two operations for the same Issue", async () => {
    const agent = new BlockingAssessmentAgent();
    const harness = createHarness(agent);
    const worker = workerFor(harness);
    queueAssessment(harness.store, "issue-1", "OMB-01");
    worker.kick();
    await vi.waitFor(() => expect(agent.startedIssueIds).toEqual(["issue-1"]));

    const active = harness.store.getIssue("issue-1");
    if (!active) throw new Error("ACTIVE_ISSUE_REQUIRED");
    harness.store.transaction((transaction) => {
      transaction.updateIssue(active, active.revision, "ASSESS");
    });
    worker.kick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(agent.startedIssueIds).toEqual(["issue-1"]);

    agent.releaseAll();
    await worker.drain();
  });

  it("continues unrelated Issues before reporting an unexpected operation error", async () => {
    const agent = new FakeAgent();
    const harness = createHarness(agent);
    const worker = workerFor(harness);
    queueAssessment(harness.store, "bad-issue", "OMB-01", null);
    queueAssessment(harness.store, "good-issue", "OMB-02");

    await expect(worker.drain()).rejects.toThrow("ISSUE_PROJECT_PATH_REQUIRED");
    expect(harness.store.getIssue("good-issue")?.status).toBe("ASSESSMENT_REVIEW");
    expect(harness.store.listPendingOperations().map(({ issue }) => issue.id))
      .toContain("bad-issue");
  });

  it("does not start queued Issues after shutdown begins", async () => {
    const agent = new BlockingAssessmentAgent();
    const harness = createHarness(agent);
    const worker = workerFor(harness);
    for (let index = 1; index <= 4; index += 1) {
      queueAssessment(harness.store, `issue-${index}`, `OMB-0${index}`);
    }

    worker.kick();
    await vi.waitFor(() => expect(agent.startedIssueIds).toHaveLength(3));
    worker.beginShutdown();
    agent.releaseAll();
    await worker.drain();

    expect(agent.startedIssueIds).toHaveLength(3);
    expect(harness.store.listPendingOperations().map(({ issue }) => issue.id))
      .toContain("issue-4");
  });
});
