import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type {
  AgentAdapter,
  AgentInterruptionReason,
  AgentSessionRef,
  Assessment,
  EvidenceInspection,
  EvidenceInspector,
  EvidenceStore,
  RepairResult,
  VisualEvidence,
} from "@oh-my-bug/core";
import sharp from "sharp";

import type {
  EvidenceCaptureArtifact,
  EvidenceCaptureProvider,
  EvidenceCaptureRequest,
} from "../../src/evidence/capture-provider.js";

export const evidenceId = `sha256-${"b".repeat(64)}`;
export const fakeAssessment: Assessment = {
  revision: 1,
  contentHash: "a".repeat(64),
  verdict: "BUG",
  suggestedTitle: "支付页无法打开",
  reasoning: "问题可复现",
  rootCause: "路由缺失",
  solution: "恢复路由",
};
export const delivery = {
  summary: "支付页已恢复",
  evidence: [{ type: "screenshot" as const, label: "支付页", evidenceId }],
};
export const repairResult: Extract<RepairResult, { kind: "DELIVERY_READY" }> = {
  kind: "DELIVERY_READY",
  summary: delivery.summary,
  evidence: [{ type: "screenshot", label: "支付页", relativePath: "proof.png" }],
  verification: [{ command: "pnpm test", outcome: "PASSED", summary: "Passed" }],
};

export class FakeAgent implements AgentAdapter {
  readonly id = "fake";
  private nextSession = 1;
  createdSessions: AgentSessionRef[] = [];
  assessSessions: string[] = [];
  assessInputs: Parameters<AgentAdapter["assess"]>[1][] = [];
  repairSessions: string[] = [];
  repairInputs: Parameters<AgentAdapter["repair"]>[1][] = [];
  evidenceSessions: string[] = [];
  evidenceInputs: Parameters<AgentAdapter["captureEvidence"]>[1][] = [];
  canceledSessions: string[] = [];
  cancellations: Array<{
    sessionId: string;
    reason: AgentInterruptionReason;
  }> = [];
  assessError?: Error;
  repairError?: Error;
  evidenceError?: Error;
  nextAssessment: Assessment = fakeAssessment;
  nextRepairResult: RepairResult = repairResult;
  nextEvidenceResult: Awaited<ReturnType<AgentAdapter["captureEvidence"]>> = {
    evidence: repairResult.evidence,
  };

  async createSession(): Promise<AgentSessionRef> {
    const session = { agent: this.id, sessionId: `session-${this.nextSession++}` };
    this.createdSessions.push(session);
    return session;
  }

  async assess(
    session: AgentSessionRef,
    input: Parameters<AgentAdapter["assess"]>[1],
  ): Promise<Assessment> {
    this.assessSessions.push(session.sessionId);
    this.assessInputs.push(input);
    if (this.assessError) throw this.assessError;
    return this.nextAssessment;
  }

  async repair(
    session: AgentSessionRef,
    input: Parameters<AgentAdapter["repair"]>[1],
  ): Promise<RepairResult> {
    this.repairSessions.push(session.sessionId);
    this.repairInputs.push(input);
    if (this.repairError) throw this.repairError;
    await mkdir(input.evidenceDirectory, { recursive: true });
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#45a978" },
    }).png().toFile(join(input.evidenceDirectory, "proof.png"));
    return this.nextRepairResult;
  }

  async captureEvidence(
    session: AgentSessionRef,
    input: Parameters<AgentAdapter["captureEvidence"]>[1],
  ): Promise<Awaited<ReturnType<AgentAdapter["captureEvidence"]>>> {
    this.evidenceSessions.push(session.sessionId);
    this.evidenceInputs.push(input);
    if (this.evidenceError) throw this.evidenceError;
    await mkdir(input.evidenceDirectory, { recursive: true });
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#45a978" },
    }).png().toFile(join(input.evidenceDirectory, "proof.png"));
    return this.nextEvidenceResult;
  }

  async cancel(
    session: AgentSessionRef,
    reason: AgentInterruptionReason,
  ): Promise<void> {
    this.canceledSessions.push(session.sessionId);
    this.cancellations.push({ sessionId: session.sessionId, reason });
  }
}


export class FakeEvidenceStore implements EvidenceStore, EvidenceInspector {
  prepared: Array<{
    issueId: string;
    repairIteration: number;
    workspaceDirectory: string;
  }> = [];
  imported: Parameters<EvidenceStore["import"]>[0][] = [];
  cleaned = 0;
  prepareError?: Error;
  importError?: Error;
  inspectError?: Error;
  nextInspection: EvidenceInspection = {
    evidenceId,
    repairIteration: 1,
    exists: true,
    byteLength: 100,
    mediaKind: "image",
    decodes: true,
    playable: false,
    hasMediaPayload: true,
  };

  async prepareIntake(
    issueId: string,
    repairIteration: number,
    workspaceDirectory: string,
  ) {
    if (this.prepareError) throw this.prepareError;
    this.prepared.push({ issueId, repairIteration, workspaceDirectory });
    return {
      directory: `/tmp/evidence/${issueId}/${repairIteration}`,
      cleanup: async () => { this.cleaned += 1; },
    };
  }

  async import(input: Parameters<EvidenceStore["import"]>[0]): Promise<VisualEvidence> {
    this.imported.push(input);
    if (this.importError) throw this.importError;
    return { type: input.type, label: input.label, evidenceId };
  }

  async read() {
    return { bytes: new Uint8Array([1]), mimeType: "image/png", label: "支付页" };
  }

  async inspect(
    _issueId: string,
    repairIteration: number,
    requestedEvidenceId: string,
  ): Promise<EvidenceInspection> {
    if (this.inspectError) throw this.inspectError;
    return { ...this.nextInspection, evidenceId: requestedEvidenceId, repairIteration };
  }
}

export class FakeEvidenceCaptureProvider implements EvidenceCaptureProvider {
  inputs: EvidenceCaptureRequest[] = [];
  error?: Error;

  async capture(input: EvidenceCaptureRequest): Promise<EvidenceCaptureArtifact> {
    this.inputs.push(input);
    if (this.error) throw this.error;
    await mkdir(input.intakeDirectory, { recursive: true });
    const path = join(input.intakeDirectory, "host-proof.png");
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#45a978" },
    }).png().toFile(path);
    return { type: "screenshot", label: input.capture.label, path };
  }
}
