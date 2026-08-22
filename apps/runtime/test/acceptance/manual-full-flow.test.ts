import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRuntime } from "../../src/composition.js";
import { FakeAgent } from "../helpers/fakes.js";
import { project } from "../helpers/runtime.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite-backed Runtime acceptance", () => {
  it("runs Manual input through both reviews and closes on Delivery approval", async () => {
    const root = mkdtempSync(join(tmpdir(), "omb-runtime-acceptance-"));
    temporaryDirectories.push(root);
    const dataRoot = join(root, "data");
    const projectRoot = join(root, "project");
    mkdirSync(dataRoot);
    mkdirSync(projectRoot);
    let sequence = 0;
    const agent = new FakeAgent();
    const runtime = createRuntime({
      databasePath: join(dataRoot, "runtime.sqlite"),
      agent,
      id: () => `acceptance-${++sequence}`,
      now: () => "2026-08-20T16:00:00.000Z",
    });
    const acceptanceProject = { ...project, path: projectRoot };
    runtime.registerProject(acceptanceProject);
    await runtime.start();

    const created = await runtime.submitManual(acceptanceProject.id, {
      commandId: "manual-command-1",
      content: "支付页打不开",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await runtime.drain();
    const assessed = runtime.getIssue(created.issue.id);
    expect(assessed.status).toBe("ASSESSMENT_REVIEW");

    runtime.approveAssessment(assessed.id, {
      assessmentRevision: assessed.assessment!.revision,
      assessmentContentHash: assessed.assessment!.contentHash,
      title: assessed.assessment!.suggestedTitle,
    });
    await runtime.drain();
    const delivered = runtime.getIssue(assessed.id);
    expect(delivered.status).toBe("ACCEPTANCE_REVIEW");
    const evidence = delivered.repair?.delivery?.evidence[0];
    if (!evidence) throw new Error("EVIDENCE_REQUIRED");
    const intakeDirectory = agent.repairInputs[0]?.evidenceDirectory;
    if (!intakeDirectory) throw new Error("EVIDENCE_INTAKE_REQUIRED");
    expect(dirname(intakeDirectory)).toBe(realpathSync(projectRoot));
    expect(basename(intakeDirectory)).toMatch(/^\.oh-my-bug-tmp-evidence-/);
    expect(readdirSync(projectRoot).some((name) => name.startsWith(".oh-my-bug-tmp-evidence-")))
      .toBe(false);
    expect(existsSync(join(
      dataRoot,
      "evidence",
      "issues",
      assessed.id,
      "repairs",
      "1",
      "evidence",
      `${evidence.evidenceId}.png`,
    ))).toBe(true);

    runtime.approveDelivery(assessed.id);
    expect(runtime.getIssue(assessed.id)).toMatchObject({
      status: "COMPLETED",
      resolution: "FIXED",
      agentSession: { agent: "fake", sessionId: "session-1" },
    });
    expect(agent.assessSessions).toEqual(["session-1"]);
    expect(agent.repairSessions).toEqual(["session-1"]);
    expect(runtime.readIssueEvents(assessed.id).map((event) => event.type)).toEqual([
      "ISSUE_CREATED",
      "ASSESSMENT_STARTED",
      "ASSESSMENT_READY",
      "ASSESSMENT_APPROVED",
      "REPAIR_STARTED",
      "DELIVERY_READY",
      "EVIDENCE_ACCEPTED",
      "DELIVERY_APPROVED",
    ]);
    await runtime.stop();
  });
});
