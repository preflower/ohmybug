import { describe, expect, it } from "vitest";
import { createHarness, project } from "./helpers/runtime.js";

describe("Runtime intake commands", () => {
  it("accepts Manual input atomically and ignores an exact redelivery", async () => {
    const { commands, wakes } = createHarness();
    const first = await commands.submitManual(project.id, { commandId: "command-1", content: "支付页打不开" });
    const duplicate = await commands.submitManual(project.id, { commandId: "command-1", content: "支付页打不开" });
    expect(first).toMatchObject({ kind: "CREATED", issue: { id: "issue-1", title: "支付页打不开" } });
    expect(duplicate).toEqual({ kind: "IGNORED_DUPLICATE", issueId: "issue-1" });
    expect(commands.listIssues(project.id)).toHaveLength(1);
    expect(wakes()).toBe(1);
  });

  it("rejects intake for an unknown project", async () => {
    const { commands } = createHarness();
    await expect(commands.submitManual("missing", { commandId: "command-2", content: "Bug" }))
      .rejects.toThrow("PROJECT_NOT_FOUND");
  });
});
