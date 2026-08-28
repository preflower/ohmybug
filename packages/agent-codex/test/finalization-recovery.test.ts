import { describe, expect, it } from "vitest";

import type { AgentActivityUpdate, FinalizationRecoveryInput } from "@oh-my-bug/core";

import { CodexAgentAdapter } from "../src/codex-agent-adapter.js";
import {
  finalizationRecoveryOutputSchema,
  finalizationRecoveryResultOutputSchema,
  parseFinalizationRecoveryOutput,
} from "../src/finalization-recovery-output.js";
import { finalizationRecoveryPrompt } from "../src/finalization-recovery-prompt.js";
import { bindSession, FixtureClient, issue, MemorySessions, project } from "./helpers.js";

function recoveryInput(): FinalizationRecoveryInput {
  return {
    issue: issue({
      status: "FINALIZATION_RECOVERY",
      finalizationRecovery: {
        automaticAttempts: 1,
        attemptId: "recovery-1",
        fingerprintRef: "fingerprint-1",
      },
    }),
    project,
    diagnostic: {
      providerId: "git",
      step: "add",
      code: "GIT_ADD_FAILED",
      exitCode: 128,
      message: "git add failed",
      stderr: "fatal: index.lock exists",
      relatedPaths: [".git/index.lock"],
    },
    workspaceStatus: " M packages/core/src/index.ts\n?? .oh-my-bug-tmp-123/",
    fingerprintSummary: "HEAD and tracked delivery files unchanged",
    recoveryKind: "GENERATED_ARTIFACT_CLEANUP",
  };
}

describe("Codex finalization recovery", () => {
  it("defines and parses a bounded strict recovery result", () => {
    expect(finalizationRecoveryResultOutputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(finalizationRecoveryOutputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(finalizationRecoveryOutputSchema).not.toHaveProperty("anyOf");
    expect(parseFinalizationRecoveryOutput({
      summary: "Removed the stale temporary artifact",
      diagnosis: "A generated temp directory blocked the Git add step",
      disposition: "RECOVERED",
      affectedPaths: [".oh-my-bug-tmp-123"],
    })).toEqual({
      summary: "Removed the stale temporary artifact",
      diagnosis: "A generated temp directory blocked the Git add step",
      disposition: "RECOVERED",
      affectedPaths: [".oh-my-bug-tmp-123"],
    });
    expect(() => parseFinalizationRecoveryOutput({
      summary: "Unsafe",
      diagnosis: "Would rewrite history",
      disposition: "UNSAFE",
      affectedPaths: ["../outside"],
    })).toThrow("FINALIZATION_RECOVERY_PATH_ESCAPE");
    expect(() => parseFinalizationRecoveryOutput({
      summary: "Unsafe",
      diagnosis: "Would rewrite history",
      disposition: "RETRY_ANYWAY",
      affectedPaths: [],
    })).toThrow("FINALIZATION_RECOVERY_DISPOSITION_INVALID");
    expect(() => parseFinalizationRecoveryOutput({
      summary: "Unsafe",
      diagnosis: "Would rewrite history",
      disposition: "UNSAFE",
      affectedPaths: [],
      extra: true,
    })).toThrow("CODEX_OUTPUT_UNKNOWN_FIELD");
    expect(() => parseFinalizationRecoveryOutput({
      summary: "Too many paths",
      diagnosis: "Broad mutation",
      disposition: "UNSAFE",
      affectedPaths: Array.from({ length: 51 }, (_, index) => `tmp/${index}`),
    })).toThrow("FINALIZATION_RECOVERY_PATHS_INVALID");
  });

  it("runs exactly one workspace-write, network-disabled recovery turn", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-recovery", "thread-recovery");
    const client = new FixtureClient([JSON.stringify({
      outcome: "RESULT",
      result: {
        summary: "Removed the stale lock",
        diagnosis: "An abandoned lock blocked staging",
        disposition: "RECOVERED",
        affectedPaths: [".git/index.lock"],
      },
      capabilityRequest: null,
    })]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await expect(adapter.recoverFinalization!(
      { agent: "codex", sessionId: "logical-recovery" },
      recoveryInput(),
    )).resolves.toEqual({
      summary: "Removed the stale lock",
      diagnosis: "An abandoned lock blocked staging",
      disposition: "RECOVERED",
      affectedPaths: [".git/index.lock"],
    });
    expect(client.prompts).toHaveLength(1);
    expect(client.resumes[0]?.options).toMatchObject({
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
      approvalPolicy: "never",
    });
  });

  it.each([
    ["auto-review", "workspace-write", false, "on-request", "auto_review"],
    ["full-access", "danger-full-access", true, "never", undefined],
  ] as const)(
    "applies the %s project permission mode to finalization recovery",
    async (permissionMode, sandboxMode, networkAccessEnabled, approvalPolicy, approvalsReviewer) => {
      const sessionId = `logical-recovery-${permissionMode}`;
      const sessions = new MemorySessions();
      await bindSession(sessions, sessionId, `thread-recovery-${permissionMode}`);
      const client = new FixtureClient([JSON.stringify({
        outcome: "RESULT",
        result: {
          summary: "Recovered",
          diagnosis: "The workspace is ready",
          disposition: "RECOVERED",
          affectedPaths: [],
        },
        capabilityRequest: null,
      })]);
      const adapter = new CodexAgentAdapter({ client, sessions });

      await adapter.recoverFinalization!(
        { agent: "codex", sessionId },
        {
          ...recoveryInput(),
          project: { ...project, permissionMode },
        },
      );

      expect(client.resumes[0]?.options).toMatchObject({
        sandboxMode,
        networkAccessEnabled,
        approvalPolicy,
      });
      if (approvalsReviewer) {
        expect(client.resumes[0]?.options).toMatchObject({ approvalsReviewer });
      } else {
        expect(client.resumes[0]?.options).not.toHaveProperty("approvalsReviewer");
      }
    },
  );

  it("constrains the AI to surgical workspace repair and no Git publication", () => {
    const prompt = finalizationRecoveryPrompt(recoveryInput());

    expect(prompt).toContain("single automatic recovery attempt");
    expect(prompt).toContain("Do not commit, merge, push, release, rewrite branches, or rewrite history");
    expect(prompt).toContain("Do not change product behavior");
    expect(prompt).toContain("Remove untracked generated content");
    expect(prompt).toContain("Restore tracked generated content exactly to HEAD");
    expect(prompt).toContain("never delete tracked generated content");
    expect(prompt).toContain("every generated root listed in the fingerprint summary");
    expect(prompt).toContain("GIT_ADD_FAILED");
    expect(prompt).toContain(".oh-my-bug-tmp-123");
    expect(prompt).toContain("HEAD and tracked delivery files unchanged");
  });

  it("continues a preserved finalization recovery after a user pause", () => {
    const prompt = finalizationRecoveryPrompt({
      ...recoveryInput(),
      continuation: { reason: "USER_RESUMED" },
    });

    expect(prompt).toContain("paused by the user");
    expect(prompt).toContain("preserved recovery workspace");
  });

  it("gives prepared merge conflicts structured context without Git mutation authority", () => {
    const prompt = finalizationRecoveryPrompt({
      ...recoveryInput(),
      diagnostic: {
        providerId: "git",
        step: "merge",
        code: "GIT_AUTO_MERGE_CONFLICT",
        message: "Automatic merge found a content conflict",
        relatedPaths: ["apps/desktop/src/web/issues/issue-detail.tsx"],
      },
      recoveryKind: "MERGE_CONFLICT",
      merge: {
        kind: "MERGE_CONFLICT",
        baseBranch: "main",
        baseCommit: "a".repeat(40),
        issueBranch: "ohmybug/ohmybug-21",
        issueCommit: "b".repeat(40),
        conflictPaths: ["apps/desktop/src/web/issues/issue-detail.tsx"],
        mergeMessages: ["CONFLICT (content): Merge conflict in issue-detail.tsx"],
        mergePrepared: true,
      },
      workspaceStatus: "UU apps/desktop/src/web/issues/issue-detail.tsx",
      fingerprintSummary: "prepared merge with 1 conflict path",
    });

    expect(prompt).toContain("Resolve the Provider-prepared content conflicts");
    expect(prompt).toContain("ohmybug/ohmybug-21");
    expect(prompt).toContain("apps/desktop/src/web/issues/issue-detail.tsx");
    expect(prompt).toContain("CONFLICT (content)");
    expect(prompt).toContain("Never run git add, git commit, git merge, git rebase, git reset, git clean, or git push");
    expect(prompt).toContain("REVALIDATION_REQUIRED whenever source content changed");
    expect(prompt).not.toContain("every generated root listed");
  });

  it("explains a clean advanced-base merge session without inventing conflicts", () => {
    const prompt = finalizationRecoveryPrompt({
      ...recoveryInput(),
      recoveryKind: "MERGE_CONFLICT",
      merge: {
        kind: "MERGE_CONFLICT",
        baseBranch: "main",
        baseCommit: "a".repeat(40),
        issueBranch: "ohmybug/ohmybug-21",
        issueCommit: "b".repeat(40),
        conflictPaths: [],
        mergeMessages: ["Prepared a renewed merge against the advanced base"],
        mergePrepared: true,
      },
    });

    expect(prompt).toContain("advanced base");
    expect(prompt).toContain("no unresolved content conflict");
    expect(prompt).not.toContain("Inspect every conflict path");
  });

  it("keeps inspection-only merge environment recovery non-mutating", () => {
    const prompt = finalizationRecoveryPrompt({
      ...recoveryInput(),
      recoveryKind: "MERGE_ENVIRONMENT",
      merge: {
        kind: "MERGE_ENVIRONMENT",
        baseBranch: "main",
        issueBranch: "ohmybug/ohmybug-21",
        issueCommit: "b".repeat(40),
        conflictPaths: [],
        mergeMessages: ["The base checkout is dirty"],
        mergePrepared: false,
      },
    });

    expect(prompt).toContain("Diagnose this merge environment or policy failure");
    expect(prompt).toContain("inspection-only");
    expect(prompt).toContain("Do not edit the base checkout, refs, hooks, Git configuration, permissions, or repository policy");
  });

  it("reports recovery activity as a distinct finalization stage", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-recovery", "thread-recovery");
    const activities: AgentActivityUpdate[] = [];
    const client = new FixtureClient([JSON.stringify({
      outcome: "RESULT",
      result: {
        summary: "No safe automatic change",
        diagnosis: "The repository state diverged",
        disposition: "UNSAFE",
        affectedPaths: [],
      },
      capabilityRequest: null,
    })]);
    const adapter = new CodexAgentAdapter({
      client,
      sessions,
      reportActivity: (activity) => { activities.push(activity); },
    });

    await adapter.recoverFinalization!(
      { agent: "codex", sessionId: "logical-recovery" },
      recoveryInput(),
    );

    expect(activities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "FINALIZATION_RECOVERY",
        type: "AGENT_TURN_COMPLETED",
        message: "Codex 已完成交付恢复",
      }),
    ]));
  });

  it("uses the existing typed capability pause flow", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-recovery", "thread-recovery");
    const client = new FixtureClient([JSON.stringify({
      outcome: "CAPABILITY_REQUIRED",
      result: null,
      capabilityRequest: {
        capabilities: ["HOST_EXECUTION"],
        reason: "Inspect a host-owned lock file",
        blockedCommand: "stat .git/index.lock",
        requestedBy: null,
      },
    })]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await expect(adapter.recoverFinalization!(
      { agent: "codex", sessionId: "logical-recovery" },
      recoveryInput(),
    )).rejects.toMatchObject({
      code: "AGENT_CAPABILITY_REQUIRED",
      request: { capabilities: ["HOST_EXECUTION"] },
    });
  });
});
