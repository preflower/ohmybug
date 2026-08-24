import { describe, expect, it } from "vitest";

import type { Assessment, RepairInput } from "@oh-my-bug/core";

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

function input(): RepairInput {
  return {
    issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 1 } }),
    project,
    assessment,
    evidenceDirectory: "/private/intake/issue-1/1",
  };
}

describe("Codex Repair network baseline", () => {
  it("enables network inside the default workspace-write Repair sandbox", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-network", "thread-network");
    const client = new FixtureClient([
      JSON.stringify({ summary: "Implemented", evidence: [] }),
    ]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await adapter.repair(
      { agent: "codex", sessionId: "logical-network" },
      input(),
    );

    expect(client.resumes[0]?.options).toMatchObject({
      sandboxMode: "workspace-write",
      networkAccessEnabled: true,
    });
    expect(client.prompts[0]).toContain(
      'Capabilities already available in this stage: ["NETWORK_ACCESS"]',
    );
  });

  it("continues instead of pausing for a redundant Repair network request", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-redundant", "thread-redundant");
    const client = new FixtureClient([
      JSON.stringify({
        outcome: "CAPABILITY_REQUIRED",
        capabilities: ["NETWORK_ACCESS"],
        reason: "Install dependencies",
        blockedCommand: "pnpm install",
        requestedBy: null,
      }),
      JSON.stringify({ summary: "Implemented", evidence: [] }),
    ]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await expect(adapter.repair(
      { agent: "codex", sessionId: "logical-redundant" },
      input(),
    )).resolves.toEqual({ summary: "Implemented", evidence: [] });
    expect(client.prompts).toHaveLength(2);
    expect(client.prompts[1]).toContain("already available in this stage");
  });
});
