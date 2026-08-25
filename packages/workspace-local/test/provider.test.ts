import type { Issue, RuntimeProject } from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import { localWorkspaceFactory } from "../src/index.js";

const project: RuntimeProject = { id: "project-1", key: "OMB", path: "/tmp/project" };
const issue = { id: "issue-1", projectId: project.id } as Issue;

describe("LocalWorkspace", () => {
  it("returns the registered project path without side effects", async () => {
    const provider = localWorkspaceFactory.create({});
    const resourceId = `local:${issue.id}`;

    await expect(provider.acquire({ issue, project })).resolves.toEqual({
      projectPath: project.path,
      resourceId,
    });
    await expect(provider.observeRepair?.({ issue, resourceId })).resolves.toEqual({
      required: false,
    });
    await expect(provider.validateRepair?.({
      issue,
      resourceId,
      observation: { required: false },
      result: {
        kind: "DELIVERY_READY",
        summary: "Implemented",
        evidence: [],
        verification: [{ command: "pnpm test", outcome: "PASSED", summary: "Passed" }],
      },
    })).resolves.toMatchObject({ kind: "DELIVERY_READY" });
    await expect(provider.publish({ issue, resourceId })).resolves.toBeUndefined();
    await expect(provider.release({ issue, resourceId })).resolves.toBeUndefined();
  });
});
