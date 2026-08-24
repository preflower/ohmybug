import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  AgentTurnInterruptedError,
  assessmentSchema,
  canonicalHash,
  type AgentAdapter,
  type AgentPlugin,
  type AgentPluginContext,
  type AgentInterruptionReason,
  type AgentSessionRef,
  type AssessInput,
  type Assessment,
  type CreateSessionInput,
  type EvidenceCaptureInput,
  type EvidenceCaptureResult,
  type FinalizationRecoveryInput,
  type FinalizationRecoveryResult,
  type RepairInput,
  type RepairResult,
} from "@oh-my-bug/core";
import sharp from "sharp";

export interface DemoAgentAdapterOptions extends AgentPluginContext {
  now?: () => Date;
  delayMs?: number;
  unavailableOnce?: boolean;
  agentId?: string;
  finalizationRecoveryResult?: FinalizationRecoveryResult;
}

interface ActiveTurn {
  abort: AbortController;
  done: Promise<void>;
  finish(): void;
}

export class DemoAgentAdapter implements AgentAdapter {
  private readonly active = new Map<string, ActiveTurn>();
  private readonly now: () => Date;
  private readonly agentId: string;
  private sessionSequence = 0;
  private unavailablePending: boolean;

  constructor(private readonly options: DemoAgentAdapterOptions) {
    this.now = options.now ?? (() => new Date());
    this.agentId = options.agentId ?? "demo";
    this.unavailablePending = options.unavailableOnce ?? false;
  }

  async createSession(input: CreateSessionInput): Promise<AgentSessionRef> {
    if (input.issue.projectId !== input.project.id) throw new Error("SESSION_PROJECT_MISMATCH");
    return { agent: this.agentId, sessionId: `demo-${input.issue.id}-${++this.sessionSequence}` };
  }

  async assess(session: AgentSessionRef, input: AssessInput): Promise<Assessment> {
    this.assertSession(session, input.issue.id);
    return this.runTurn(session, async (signal) => {
      await this.prepareNativeSession(session, input.issue.id, input.project.id);
      await this.wait(signal);
      const content = {
        verdict: "BUG" as const,
        suggestedTitle: input.issue.title,
        reasoning: "The deterministic demo Agent reproduced the reported failure.",
        rootCause: "The reported path does not handle the failing state before continuing.",
        solution: "Add an explicit guard and return a recoverable result.",
      };
      return assessmentSchema.parse({
        revision: Math.max(1, input.issue.revision),
        contentHash: canonicalHash(content),
        ...content,
      });
    });
  }

  async repair(session: AgentSessionRef, input: RepairInput): Promise<RepairResult> {
    this.assertSession(session, input.issue.id);
    return this.runTurn(session, async (signal) => {
      await this.prepareNativeSession(session, input.issue.id, input.project.id);
      await this.wait(signal);
      return {
        summary: "The failing path now returns a recoverable result.",
        evidence: [],
      };
    });
  }

  async captureEvidence(
    session: AgentSessionRef,
    input: EvidenceCaptureInput,
  ): Promise<EvidenceCaptureResult> {
    this.assertSession(session, input.issue.id);
    return this.runTurn(session, async (signal) => {
      await this.prepareNativeSession(session, input.issue.id, input.project.id);
      await this.wait(signal);
      await mkdir(input.evidenceDirectory, { recursive: true });
      const relativePath = "checkout-acceptance.png";
      await sharp(Buffer.from(demoEvidenceSvg)).png().toFile(join(input.evidenceDirectory, relativePath));
      return {
        evidence: [{ type: "screenshot", label: "Checkout acceptance", relativePath }],
      };
    });
  }

  async recoverFinalization(
    session: AgentSessionRef,
    input: FinalizationRecoveryInput,
  ): Promise<FinalizationRecoveryResult> {
    this.assertSession(session, input.issue.id);
    return this.runTurn(session, async (signal) => {
      await this.prepareNativeSession(session, input.issue.id, input.project.id);
      await this.wait(signal);
      return this.options.finalizationRecoveryResult ?? {
        summary: "The demo Agent did not make an automatic recovery change.",
        diagnosis: "No deterministic finalization recovery fixture was configured.",
        disposition: "UNSAFE",
        affectedPaths: [],
      };
    });
  }

  async cancel(
    session: AgentSessionRef,
    reason: AgentInterruptionReason,
  ): Promise<void> {
    this.assertRef(session);
    const active = this.active.get(session.sessionId);
    if (!active) return;
    active.abort.abort(new AgentTurnInterruptedError(reason));
    await active.done;
  }

  private async prepareNativeSession(
    session: AgentSessionRef,
    issueId: string,
    projectId: string,
  ): Promise<void> {
    const record = await this.options.sessions.get(session.sessionId);
    if (
      !record ||
      record.lifecycle !== "ACTIVE" ||
      record.agent !== this.agentId ||
      record.issueId !== issueId ||
      record.projectId !== projectId
    ) throw new Error("AGENT_SESSION_CONTEXT_MISMATCH");
    if (this.unavailablePending) {
      this.unavailablePending = false;
      throw new Error("AGENT_SESSION_UNAVAILABLE");
    }
    const providerSessionId = `demo-native-${session.sessionId}`;
    if (record.providerSessionId && record.providerSessionId !== providerSessionId) {
      throw new Error("AGENT_SESSION_MISMATCH");
    }
    if (!record.providerSessionId) {
      await this.options.sessions.save({
        ...record,
        providerSessionId,
        updatedAt: this.now().toISOString(),
      });
    }
  }

  private async runTurn<T>(
    session: AgentSessionRef,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.active.has(session.sessionId)) throw new Error("AGENT_SESSION_BUSY");
    const abort = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    this.active.set(session.sessionId, { abort, done, finish });
    try {
      return await run(abort.signal);
    } catch (error) {
      if (abort.signal.aborted) {
        throw abort.signal.reason instanceof Error
          ? abort.signal.reason
          : new Error("RUN_CANCELED", { cause: error });
      }
      throw error;
    } finally {
      this.active.delete(session.sessionId);
      finish();
    }
  }

  private async wait(signal: AbortSignal): Promise<void> {
    const delayMs = this.options.delayMs ?? 0;
    if (signal.aborted) throw new Error("RUN_CANCELED");
    if (delayMs <= 0) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, delayMs);
      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new Error("RUN_CANCELED"));
      }, { once: true });
    });
  }

  private assertSession(session: AgentSessionRef, issueId: string): void {
    this.assertRef(session);
    if (!session.sessionId.startsWith(`demo-${issueId}-`)) {
      throw new Error("AGENT_SESSION_CONTEXT_MISMATCH");
    }
  }

  private assertRef(session: AgentSessionRef): void {
    if (session.agent !== this.agentId || !session.sessionId.startsWith("demo-")) {
      throw new Error("INVALID_DEMO_SESSION");
    }
  }
}

export function demoAgent(
  options: Pick<
    DemoAgentAdapterOptions,
    "agentId" | "delayMs" | "now" | "unavailableOnce" | "finalizationRecoveryResult"
  > = {},
): AgentPlugin {
  return {
    id: options.agentId ?? "demo",
    create(context) {
      return new DemoAgentAdapter({ ...context, ...options });
    },
  };
}

const demoEvidenceSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#111115"/>
  <rect x="80" y="64" width="1120" height="592" rx="12" fill="#17171c" stroke="#292932" stroke-width="2"/>
  <circle cx="144" cy="274" r="32" fill="#45a978"/>
  <path d="M129 274l10 10 20-22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="200" y="282" fill="#f2f2f5" font-family="Arial,sans-serif" font-size="40" font-weight="600">Checkout recovered</text>
  <text x="112" y="350" fill="#aaaab4" font-family="Arial,sans-serif" font-size="23">The failing path now returns a recoverable response.</text>
</svg>`;
