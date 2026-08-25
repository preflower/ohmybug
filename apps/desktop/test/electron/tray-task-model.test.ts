import { describe, expect, it } from "vitest";

import {
  buildTrayTaskModel,
  classifyTrayStatus,
  truncateTrayTitle,
  type TrayIssue,
} from "../../src/electron/tray-task-model.js";

const attention = [
  "ASSESSMENT_REVIEW",
  "PERMISSION_REQUIRED",
  "ACCEPTANCE_REVIEW",
  "ASSESSMENT_FAILED",
  "EVIDENCE_FAILED",
  "REPAIR_FAILED",
  "FINALIZATION_FAILED",
] as const;
const processing = [
  "RECEIVED",
  "ASSESSING",
  "REPAIRING",
  "EVIDENCE_CAPTURE",
  "EVIDENCE_CHECK",
  "FINALIZING",
  "FINALIZATION_RECOVERY",
] as const;
const terminal = ["COMPLETED", "CLOSED", "CANCELED"] as const;

function issue(
  identifier: string,
  status: TrayIssue["status"],
  updatedAt: string,
  title = `Title ${identifier}`,
): TrayIssue {
  return { id: identifier.toLowerCase(), identifier, status, title, updatedAt };
}

describe("tray task model", () => {
  it("classifies every Issue status without leaving an implicit case", () => {
    for (const status of attention) expect(classifyTrayStatus(status)).toBe("attention");
    for (const status of processing) expect(classifyTrayStatus(status)).toBe("processing");
    for (const status of terminal) expect(classifyTrayStatus(status)).toBeNull();
  });

  it("sorts newest first, limits each section to four, and reports overflow", () => {
    const issues = [1, 2, 3, 4, 5].map((number) => issue(
      `CHK-${number}`,
      "ASSESSMENT_REVIEW",
      `2026-08-25T10:0${number}:00.000Z`,
    ));
    const model = buildTrayTaskModel([
      ...issues,
      issue("CHK-9", "REPAIRING", "2026-08-25T11:00:00.000Z"),
      issue("CHK-10", "COMPLETED", "2026-08-25T12:00:00.000Z"),
    ]);

    expect(model.attention.total).toBe(5);
    expect(model.attention.overflow).toBe(1);
    expect(model.attention.items.map((item) => item.identifier)).toEqual([
      "CHK-5",
      "CHK-4",
      "CHK-3",
      "CHK-2",
    ]);
    expect(model.processing.items.map((item) => item.identifier)).toEqual(["CHK-9"]);
    expect(model.processing.total).toBe(1);
  });

  it("uses numeric identifiers as a deterministic timestamp tie-breaker", () => {
    const time = "2026-08-25T10:00:00.000Z";
    const model = buildTrayTaskModel([
      issue("CHK-2", "REPAIRING", time),
      issue("CHK-10", "REPAIRING", time),
    ]);

    expect(model.processing.items.map((item) => item.identifier)).toEqual(["CHK-10", "CHK-2"]);
  });

  it("builds the native label from the shared Chinese status wording", () => {
    const model = buildTrayTaskModel([
      issue("CHK-1", "ASSESSMENT_REVIEW", "2026-08-25T10:00:00.000Z", "Review checkout"),
    ]);

    expect(model.attention.items[0]?.label).toBe("CHK-1 · Review checkout — 待确认判断");
  });

  it("truncates title text at 32 grapheme clusters without splitting emoji", () => {
    expect(truncateTrayTitle("修复🧑🏽‍💻".repeat(20))).toBe(`${"修复🧑🏽‍💻".repeat(10)}修复…`);
    expect(truncateTrayTitle("short title")).toBe("short title");
  });
});
