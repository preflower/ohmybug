import { describe, expect, it } from "vitest";

import { rendererOperationNames, runtimeOperations } from "../../src/protocol/operations.js";
import { reviewedIssue } from "../helpers/runtime.js";

describe("Runtime protocol operation registry", () => {
  it("is the single ordered source of operation shape and renderer exposure", () => {
    expect(Object.keys(runtimeOperations)).toEqual([
      "health",
      "listIntegrationPlugins",
      "listWorkspaceProviders",
      "listProjects",
      "inspectProject",
      "inspectProjectBranches",
      "getProject",
      "createProject",
      "updateProject",
      "setIntegrationSecrets",
      "integrationHealth",
      "listIssues",
      "getIssue",
      "getIssueWorkspace",
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

  it("validates grouped project branch discovery", () => {
    const input = { path: "/repo", providerId: "git", refreshRemote: true };
    const output = {
      localBranches: ["main"],
      remoteBranches: ["origin/main"],
      remote: { name: "origin", url: "git@example.com:team/repo.git" },
    };

    expect(runtimeOperations.inspectProjectBranches.input.parse(input)).toEqual(input);
    expect(runtimeOperations.inspectProjectBranches.output.parse(output)).toEqual(output);
  });

  it("validates published branch information outside the Core Issue", () => {
    const issue = reviewedIssue({ status: "COMPLETED", resolution: "FIXED" });

    expect(runtimeOperations.approveDelivery.output.parse({
      issue,
      branch: { name: "ohmybug/omb-2", commit: "abc123", remote: "origin" },
    })).toEqual({
      issue,
      branch: { name: "ohmybug/omb-2", commit: "abc123", remote: "origin" },
    });
    expect(() => runtimeOperations.approveDelivery.output.parse({
      ...issue,
      branch: { name: "ohmybug/omb-2", commit: "abc123" },
    })).toThrow();
  });

  it("validates nullable Issue workspace metadata", () => {
    expect(runtimeOperations.getIssueWorkspace.output.parse({
      providerId: "git",
      status: "READY",
      branch: "ohmybug/omb-1",
    })).toEqual({
      providerId: "git",
      status: "READY",
      branch: "ohmybug/omb-1",
    });
    expect(runtimeOperations.getIssueWorkspace.output.parse(null)).toBeNull();
  });

  it("validates evidence capture project configuration", () => {
    const input = {
      path: "/repo/payments",
      key: "PAY",
      commands: {
        start: "pnpm dev --host 127.0.0.1",
        acceptanceUrl: "http://localhost:4173/payment",
        evidenceCapture: { mode: "browser", label: "Payment page", timeoutMs: 15_000 },
      },
    } as const;

    expect(runtimeOperations.createProject.input.parse(input)).toEqual(input);
    expect(() => runtimeOperations.createProject.input.parse({
      ...input,
      commands: {
        ...input.commands,
        acceptanceUrl: "https://example.com/payment",
      },
    })).toThrow(/ACCEPTANCE_URL_MUST_BE_LOCALHOST/);
  });
});
