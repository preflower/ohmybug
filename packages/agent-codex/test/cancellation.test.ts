import { describe, expect, it, vi } from "vitest";

import type { CodexClient, CodexThread } from "../src/codex-client.js";
import { CodexAgentAdapter } from "../src/codex-agent-adapter.js";
import { bindSession, FixtureClient, issue, MemorySessions, project } from "./helpers.js";

describe("Codex cancellation", () => {
  it.each(["RUNTIME_STOPPING", "USER_CANCELED", "USER_PAUSED"] as const)(
    "aborts the active turn with the %s reason",
    async (reason) => {
    let turnSignal: AbortSignal | undefined;
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const thread: CodexThread = {
      id: "thread-1",
      dispose: async () => undefined,
      runStreamed: async (_prompt, options) => {
        turnSignal = options.signal;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "thread.started" as const, threadId: "thread-1" };
            started();
            await new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => resolve(), { once: true }));
            throw new Error("SDK_ABORTED");
          },
        };
      },
    };
    const client: CodexClient = { startThread: () => thread, resumeThread: () => thread };
    const sessions = new MemorySessions();
    await bindSession(sessions);
    const adapter = new CodexAgentAdapter({ client, sessions, id: () => "logical-1" });
    const current = issue();
    const session = { agent: "codex" as const, sessionId: "logical-1" };
    const assessment = adapter.assess(session, { issue: current, project });
    await running;

    await adapter.cancel(session, reason);

    expect(turnSignal?.aborted).toBe(true);
    await expect(assessment).rejects.toMatchObject({
      code: "AGENT_TURN_INTERRUPTED",
      reason,
    });
  });

  for (const stage of ["Assessment", "Repair"] as const) {
    it(`keeps ${stage} running until it is explicitly canceled`, async () => {
      vi.useFakeTimers();
      const sessions = new MemorySessions();
      await bindSession(sessions);
      const client = new FixtureClient([{ waitForAbort: true, error: new Error("SDK_ABORTED") }]);
      const adapter = new CodexAgentAdapter({ sessions, client });
      const session = { agent: "codex" as const, sessionId: "logical-1" };
      const current = issue();
      const assessment = {
        revision: current.revision,
        contentHash: "a".repeat(64),
        verdict: "BUG" as const,
        suggestedTitle: "Checkout fails",
        reasoning: "Reproduced",
        rootCause: "Null cart",
        solution: "Handle expiry",
      };
      const operation = stage === "Assessment"
        ? adapter.assess(session, { issue: current, project })
        : adapter.repair(session, {
            issue: {
              ...current,
              status: "REPAIRING",
              assessment,
              repair: { iteration: 1 },
            },
            project,
            assessment,
            evidenceDirectory: "/repo/checkout/evidence",
          });
      const settled = operation.catch((error: unknown) => error);

      try {
        await vi.advanceTimersByTimeAsync(900_001);
        expect(client.signals).toHaveLength(1);
        expect(client.signals[0]?.aborted).toBe(false);
      } finally {
        await adapter.cancel(session, "USER_CANCELED");
        vi.useRealTimers();
      }
      await expect(settled).resolves.toMatchObject({
        code: "AGENT_TURN_INTERRUPTED",
        reason: "USER_CANCELED",
      });
    });
  }
});
