import { describe, expect, it } from "vitest";

import { rendererOperationNames, runtimeOperations } from "../../src/protocol/operations.js";
import { reviewedIssue } from "../helpers/runtime.js";

describe("Runtime protocol operation registry", () => {
  it.each([
    "request-approval",
    "auto-review",
    "full-access",
  ] as const)("accepts the %s project permission mode", (permissionMode) => {
    expect(runtimeOperations.createProject.input.parse({
      path: "/repo",
      key: "APP",
      permissionMode,
    })).toMatchObject({ permissionMode });
  });

  it("rejects unknown project permission modes", () => {
    expect(() => runtimeOperations.createProject.input.parse({
      path: "/repo",
      key: "APP",
      permissionMode: "unrestricted",
    })).toThrow();
  });

  it("is the single ordered source of operation shape and renderer exposure", () => {
    expect(Object.keys(runtimeOperations)).toEqual([
      "health",
      "listIntegrationPlugins",
      "listWorkspaceProviders",
      "listProjects",
      "inspectProject",
      "inspectProjectBranches",
      "getProject",
      "saveProjectSettings",
      "createProject",
      "updateProject",
      "setIntegrationSecrets",
      "integrationHealth",
      "testSavedIntegration",
      "listIssues",
      "getIssue",
      "agentTerminalAvailability",
      "resolveAgentTerminalLaunchTarget",
      "getIssueWorkspace",
      "submitManual",
      "submitReview",
      "approveAssessment",
      "approveBugAssessment",
      "confirmNotABug",
      "confirmDuplicate",
      "requestReassessment",
      "rejectDelivery",
      "approveDelivery",
      "retryIssue",
      "rebuildAgentSession",
      "grantIssueCapabilities",
      "pauseIssue",
      "resumeIssue",
      "cancelIssue",
      "issueEvents",
      "readEvidence",
      "shutdown",
    ]);
    expect(rendererOperationNames).not.toContain("shutdown");
    expect(rendererOperationNames).not.toContain("health");
    expect(rendererOperationNames).toContain("rebuildAgentSession");
    expect(rendererOperationNames).toContain("grantIssueCapabilities");
    expect(rendererOperationNames).toContain("readEvidence");
    expect(rendererOperationNames).toContain("agentTerminalAvailability");
    expect(rendererOperationNames).not.toContain("resolveAgentTerminalLaunchTarget");
  });

  it("keeps terminal availability public and launch details main-only", () => {
    const input = { id: "issue-1" };
    expect(runtimeOperations.agentTerminalAvailability.input.parse(input)).toEqual(input);
    expect(runtimeOperations.agentTerminalAvailability.output.parse({ available: true }))
      .toEqual({ available: true });
    expect(runtimeOperations.agentTerminalAvailability.output.parse({
      available: false,
      reason: "SESSION_NOT_READY",
    })).toEqual({ available: false, reason: "SESSION_NOT_READY" });
    expect(() => runtimeOperations.agentTerminalAvailability.output.parse({
      available: false,
      reason: "SESSION_NOT_READY",
      remoteUrl: "unix:///private/socket",
    })).toThrow();

    const target = {
      agent: "codex",
      providerThreadId: "0198e8dc-6de0-7c10-81ce-6c6544bc1bf7",
      executablePath: "/Applications/Oh My Bug.app/Contents/Resources/codex",
      remoteUrl: "unix:///private/run/codex-app-server.sock",
      workingDirectory: "/repo/worktree",
      permissionMode: "auto-review",
    } as const;
    expect(runtimeOperations.resolveAgentTerminalLaunchTarget.output.parse(target)).toEqual(target);
    expect(() => runtimeOperations.resolveAgentTerminalLaunchTarget.output.parse({
      ...target,
      extraArgument: "--dangerously-bypass-approvals-and-sandbox",
    })).toThrow();
  });

  it("validates strict saved Integration tests", () => {
    const input = { projectId: "project-1", integrationId: "sentry" };
    const output = {
      title: "连接成功",
      details: [{ label: "Project", value: "checkout" }],
      testedAt: "2026-08-26T02:00:00.000Z",
    };
    expect(runtimeOperations.testSavedIntegration.input.parse(input)).toEqual(input);
    expect(runtimeOperations.testSavedIntegration.output.parse(output)).toEqual(output);
    expect(() => runtimeOperations.testSavedIntegration.input.parse({ ...input, token: "secret" }))
      .toThrow();
    expect(() => runtimeOperations.testSavedIntegration.output.parse({ ...output, token: "secret" }))
      .toThrow();
  });

  it("validates optimistic generic review submission", () => {
    const input = {
      id: "issue-1",
      input: {
        expectedRevision: 7,
        requestId: "review-1",
        choiceId: "continue",
        feedback: "Preserve both compatible changes",
      },
    };

    expect(runtimeOperations.submitReview.input.parse(input)).toEqual(input);
    expect(() => runtimeOperations.submitReview.input.parse({
      id: "issue-1",
      input: { requestId: "review-1", choiceId: "continue" },
    })).toThrow();
  });

  it("validates optimistic capability grant input", () => {
    const input = {
      id: "issue-1",
      expectedRevision: 7,
      requestId: "request-1",
    };

    expect(runtimeOperations.grantIssueCapabilities.input.parse(input)).toEqual(input);
    expect(() => runtimeOperations.grantIssueCapabilities.input.parse({
      id: "issue-1",
      requestId: "request-1",
    })).toThrow();
  });

  it("validates explicit Issue pause and resume inputs", () => {
    const input = { id: "issue-1" };
    expect(runtimeOperations.pauseIssue.input.parse(input)).toEqual(input);
    expect(runtimeOperations.resumeIssue.input.parse(input)).toEqual(input);
  });

  it("validates grouped project branch discovery", () => {
    const input = { path: "/repo", providerId: "git", refreshRemote: true };
    const output = {
      localBranches: ["main"],
      remoteBranches: ["origin/main"],
      fetchRemote: { name: "origin", url: "git@example.com:team/repo.git" },
      publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
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

  it("validates one project-settings save with grouped secret patches", () => {
    const create = {
      mode: "create",
      project: {
        path: "/repo",
        key: "OMB",
        integrations: {
          dingtalk: { enabled: true, config: { conversationIds: ["cid-1"] } },
        },
      },
      secretPatches: {
        dingtalk: { clientId: "client-id", clientSecret: "client-secret" },
      },
    } as const;
    const update = {
      ...create,
      mode: "update",
      id: "project-1",
      expectedRevision: 3,
    } as const;

    expect(runtimeOperations.saveProjectSettings.input.parse(create)).toEqual(create);
    expect(runtimeOperations.saveProjectSettings.input.parse(update)).toEqual(update);
    expect(() => runtimeOperations.saveProjectSettings.input.parse({
      ...update,
      expectedRevision: 0,
    })).toThrow();
    expect(() => runtimeOperations.saveProjectSettings.input.parse({
      ...create,
      extra: true,
    })).toThrow();
  });
});
