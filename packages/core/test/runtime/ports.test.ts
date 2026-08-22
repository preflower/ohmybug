import { describe, expect, it } from "vitest";

import {
  runtimeProjectSchema,
  type AgentSessionRecord,
  type EvidenceInspector,
  type IntegrationCheckpointStore,
  type RuntimeProject,
  type RuntimeStore,
} from "../../src/index.js";

describe("Runtime ports", () => {
  it("validates the complete Agent project context", () => {
    const project: RuntimeProject = {
      id: "project-1",
      key: "OMB",
      path: "/tmp/project-1",
      instructions: "Follow AGENTS.md",
    };
    expect(runtimeProjectSchema.parse(project)).toEqual(project);
    expect(() => runtimeProjectSchema.parse({ ...project, key: "omb" })).toThrow();
  });

  it("supports infrastructure-neutral evidence inspection", async () => {
    const inspector: EvidenceInspector = {
      async inspect(_issueId, repairIteration, evidenceId) {
        return {
          evidenceId,
          repairIteration,
          exists: true,
          byteLength: 10,
          mediaKind: "image",
          decodes: true,
          playable: false,
          hasMediaPayload: true,
        };
      },
    };
    expect(await inspector.inspect("issue-1", 2, `sha256-${"a".repeat(64)}`))
      .toMatchObject({ repairIteration: 2, evidenceId: `sha256-${"a".repeat(64)}` });
  });

  it("defines project mutation and Integration checkpoint ports", () => {
    const projectMethods = {
      listProjects: () => [],
      updateProject: (project: RuntimeProject) => project,
    } satisfies Pick<RuntimeStore, "listProjects" | "updateProject">;
    const values = new Map<string, string>();
    const checkpoints: IntegrationCheckpointStore = {
      get(projectId, integration, key) {
        return values.get(`${projectId}:${integration}:${key}`);
      },
      save(projectId, integration, key, value) {
        const id = `${projectId}:${integration}:${key}`;
        if (value === undefined) values.delete(id);
        else values.set(id, value);
      },
    };

    expect(projectMethods.listProjects()).toEqual([]);
    checkpoints.save("project-1", "sentry", "cursor", "next-1");
    expect(checkpoints.get("project-1", "sentry", "cursor")).toBe("next-1");
    checkpoints.save("project-1", "sentry", "cursor", undefined);
    expect(checkpoints.get("project-1", "sentry", "cursor")).toBeUndefined();
  });

  it("defines atomic Agent session operations on Runtime transactions", () => {
    const session: AgentSessionRecord = {
      agent: "codex",
      logicalSessionId: "logical-1",
      issueId: "issue-1",
      projectId: "project-1",
      lifecycle: "ACTIVE",
      updatedAt: "2026-08-21T03:00:00.000Z",
    };
    const operations = {
      getAgentSession: () => session,
      insertAgentSession: (record: AgentSessionRecord) => { void record; },
      retireAgentSession: (logicalSessionId: string, updatedAt: string) => {
        void logicalSessionId;
        void updatedAt;
      },
    } satisfies Pick<
      import("../../src/index.js").RuntimeTransaction,
      "getAgentSession" | "insertAgentSession" | "retireAgentSession"
    >;

    expect(operations.getAgentSession()).toBe(session);
  });
});
