import { describe, expect, it } from "vitest";

import { RuntimeWorker } from "../src/orchestration/worker.js";
import { FakeAgent } from "./helpers/fakes.js";
import { assessment, createHarness, eventIds, project } from "./helpers/runtime.js";

describe("Runtime typed lifecycle hooks", () => {
  it("emits the public lifecycle in persisted workflow order", async () => {
    const agent = new FakeAgent();
    const { commands, store, agents, evidence, workspaces, hooks } = createHarness(agent);
    const observed: string[] = [];
    for (const name of [
      "issue.beforeCreate",
      "issue.created",
      "assessment.before",
      "assessment.after",
      "repair.before",
      "repair.after",
      "issue.userApproved",
    ] as const) {
      hooks.on("observer", name, () => observed.push(name));
    }
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      hooks,
      id: eventIds("lifecycle"),
      now: () => "2026-08-20T15:01:00.000Z",
    });

    const created = await commands.submitManual(project.id, {
      commandId: "lifecycle",
      content: "Checkout fails",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await worker.drain();
    commands.approveAssessment(created.issue.id, {
      assessmentRevision: assessment.revision,
      assessmentContentHash: assessment.contentHash,
      title: assessment.suggestedTitle,
    });
    await worker.drain();
    commands.approveDelivery(created.issue.id);

    expect(observed).toEqual([
      "issue.beforeCreate",
      "issue.created",
      "assessment.before",
      "assessment.after",
      "repair.before",
      "repair.after",
      "issue.userApproved",
    ]);
  });

  it("records a failed hook after approval and continues later listeners", () => {
    const { commands, store, hooks } = createHarness();
    const calls: string[] = [];
    hooks.on("broken", "issue.userApproved", () => {
      calls.push("broken");
      throw new Error("PIPELINE_FAILED");
    });
    hooks.on("healthy", "issue.userApproved", () => calls.push("healthy"));
    const issue = {
      id: "issue-delivery-hook",
      projectId: project.id,
      projectPath: project.path,
      identifier: "OMB-DELIVERY-HOOK",
      title: "Checkout fails",
      titleSource: "user" as const,
      status: "ACCEPTANCE_REVIEW" as const,
      inputs: [],
      assessment,
      repair: { iteration: 1 },
      revision: 7,
      createdAt: "2026-08-20T15:00:00.000Z",
      updatedAt: "2026-08-20T15:00:00.000Z",
    };
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));

    expect(commands.approveDelivery(issue.id)).toMatchObject({ status: "APPROVED" });
    expect(calls).toEqual(["broken", "healthy"]);
    expect(store.readEvents(issue.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "MODULE_HOOK_FAILED",
        actor: "SYSTEM",
        data: {
          owner: "broken",
          hook: "issue.userApproved",
          message: "PIPELINE_FAILED",
        },
      }),
    ]));
  });
});
