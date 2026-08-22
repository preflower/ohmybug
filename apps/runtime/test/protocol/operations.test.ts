import { describe, expect, it } from "vitest";

import { rendererOperationNames, runtimeOperations } from "../../src/protocol/operations.js";

describe("Runtime protocol operation registry", () => {
  it("is the single ordered source of operation shape and renderer exposure", () => {
    expect(Object.keys(runtimeOperations)).toEqual([
      "health",
      "listIntegrationPlugins",
      "listWorkspaceProviders",
      "listProjects",
      "inspectProject",
      "getProject",
      "createProject",
      "updateProject",
      "setIntegrationSecrets",
      "integrationHealth",
      "listIssues",
      "getIssue",
      "submitManual",
      "approveAssessment",
      "approveBugAssessment",
      "confirmNotABug",
      "confirmDuplicate",
      "requestReassessment",
      "rejectDelivery",
      "approveDelivery",
      "retryIssue",
      "rebuildAgentSession",
      "cancelIssue",
      "issueEvents",
      "readEvidence",
      "shutdown",
    ]);
    expect(rendererOperationNames).not.toContain("shutdown");
    expect(rendererOperationNames).not.toContain("health");
    expect(rendererOperationNames).toContain("rebuildAgentSession");
    expect(rendererOperationNames).toContain("readEvidence");
  });
});
