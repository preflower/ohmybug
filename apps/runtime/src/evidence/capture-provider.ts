import type { ProjectCommands, ProjectEvidenceCapture } from "@oh-my-bug/core";

export const EVIDENCE_CAPTURE_FAILURE_CODES = [
  "EVIDENCE_FILE_MISSING",
  "EVIDENCE_MEDIA_INVALID",
  "EVIDENCE_NOT_REVIEWABLE",
  "EVIDENCE_TARGET_UNREACHABLE",
  "EVIDENCE_CAPTURE_PERMISSION_DENIED",
  "EVIDENCE_CAPTURE_PROCESS_FAILED",
  "EVIDENCE_RETRY_LIMIT_REACHED",
] as const;

export type EvidenceCaptureFailureCode =
  (typeof EVIDENCE_CAPTURE_FAILURE_CODES)[number];

export class EvidenceCaptureError extends Error {
  constructor(
    readonly code: EvidenceCaptureFailureCode,
    readonly mode: ProjectEvidenceCapture["mode"],
    readonly target: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "EvidenceCaptureError";
  }
}

export interface EvidenceCaptureRequest {
  issueId: string;
  workspaceDirectory: string;
  intakeDirectory: string;
  commands: ProjectCommands;
  capture: ProjectEvidenceCapture;
  signal?: AbortSignal;
}

export interface EvidenceCaptureArtifact {
  type: "screenshot" | "recording";
  label: string;
  path: string;
}

export interface EvidenceCaptureProvider {
  capture(input: EvidenceCaptureRequest): Promise<EvidenceCaptureArtifact>;
}
