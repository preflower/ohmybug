import { describe, expect, it } from "vitest";

import type { Assessment } from "@oh-my-bug/core";

import { CodexAgentAdapter } from "../src/codex-agent-adapter.js";
import { bindSession, FixtureClient, issue, MemorySessions, project } from "./helpers.js";

const assessment: Assessment = {
  revision: 1,
  contentHash: "a".repeat(64),
  verdict: "BUG",
  suggestedTitle: "Checkout fails",
  reasoning: "Reproduced",
  rootCause: "Null cart",
  solution: "Handle expiry",
};

describe("Codex repair", () => {
  it("implements an approved Feature assessment", async () => {
    const featureAssessment: Assessment = {
      ...assessment,
      verdict: "FEATURE",
      suggestedTitle: "Add CSV export",
      rootCause: undefined,
      solution: "Add an export action and CSV serializer.",
    };
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-feature", "thread-feature");
    const client = new FixtureClient([JSON.stringify({
      summary: "Added CSV export",
      evidence: [{ type: "screenshot", label: "Export action", relativePath: "export.png" }],
    })]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await expect(adapter.repair(
      { agent: "codex", sessionId: "logical-feature" },
      {
        issue: issue({ status: "REPAIRING", assessment: featureAssessment, repair: { iteration: 1 } }),
        project,
        assessment: featureAssessment,
        evidenceDirectory: "/private/intake/issue-1/1",
      },
    )).resolves.toMatchObject({ summary: "Added CSV export" });
    expect(client.prompts[0]).toContain("approved BUG or FEATURE change");
  });

  it("resumes the same native thread and returns path-only visual evidence", async () => {
    const client = new FixtureClient([JSON.stringify({
      summary: "Fixed",
      evidence: [{ type: "screenshot", label: "Proof", relativePath: "proof.png" }],
    })]);
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-1", "thread-1");
    const adapter = new CodexAgentAdapter({ client, sessions });
    const repairing = issue({
      projectPath: "/tmp/worktrees/CHK-1",
      status: "REPAIRING",
      assessment,
      repair: { iteration: 2 },
    });

    const result = await adapter.repair(
      { agent: "codex", sessionId: "logical-1" },
      {
        issue: repairing,
        project,
        assessment,
        evidenceDirectory: "/private/intake/issue-1/2",
        feedback: "Show the fixed result",
        continuation: {
          reason: "RUNTIME_INTERRUPTED",
          previousAttemptId: "attempt-before-restart",
        },
      },
    );

    expect(result).toEqual({
      summary: "Fixed",
      evidence: [{ type: "screenshot", label: "Proof", relativePath: "proof.png" }],
    });
    expect(client.resumes[0]).toMatchObject({
      threadId: "thread-1",
      options: {
        workingDirectory: repairing.projectPath,
        sandboxMode: "workspace-write",
        networkAccessEnabled: false,
      },
    });
    expect(client.prompts[0]).toContain("/private/intake/issue-1/2");
    expect(client.prompts[0]).toContain("Oh My Bug does not manage Git");
    expect(client.prompts[0]).toContain("Show the fixed result");
    expect(client.prompts[0]).toContain(
      "The previous turn was interrupted by a Runtime restart.",
    );
    expect(client.prompts[0]).toContain("Do not redo completed implementation work.");
    expect(client.prompts[0]).toContain("directly capture a real acceptance run");
    expect(client.prompts[0]).toContain(
      "the running application, an actual API request and response, or an executed benchmark",
    );
    expect(client.prompts[0]).toContain(
      "Never submit generated, reconstructed, mocked, or illustrative visuals.",
    );
  });

  it("rejects an empty evidence label with a stable error code", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-empty-label", "thread-empty-label");
    const adapter = new CodexAgentAdapter({
      sessions,
      client: new FixtureClient([JSON.stringify({
        summary: "Fixed",
        evidence: [{ type: "screenshot", label: "", relativePath: "proof.png" }],
      })]),
    });

    await expect(adapter.repair(
      { agent: "codex", sessionId: "logical-empty-label" },
      {
        issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 1 } }),
        project,
        assessment,
        evidenceDirectory: "/private/intake/issue-1/1",
      },
    )).rejects.toThrow("EVIDENCE_LABEL_REQUIRED");
  });

  it.each([
    "/absolute.png",
    "C:\\absolute.png",
    "../proof.png",
    "..\\proof.png",
    "nested/../../proof.png",
    "nested\\..\\..\\proof.png",
    "",
  ])(
    "rejects unsafe evidence path %j",
    async (relativePath) => {
      const sessions = new MemorySessions();
      await bindSession(sessions, "logical-1", "thread-1");
      const adapter = new CodexAgentAdapter({
        sessions,
        client: new FixtureClient([JSON.stringify({
          summary: "Fixed",
          evidence: [{ type: "screenshot", label: "Proof", relativePath }],
        })]),
      });

      await expect(adapter.repair(
        { agent: "codex", sessionId: "logical-1" },
        {
          issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 2 } }),
          project,
          assessment,
          evidenceDirectory: "/private/intake/issue-1/2",
        },
      )).rejects.toThrow(/EVIDENCE_PATH_(REQUIRED|ESCAPE)/);
    },
  );
});
