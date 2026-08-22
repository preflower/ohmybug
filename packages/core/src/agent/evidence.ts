import type { Delivery, VisualEvidence } from "./types.js";

export type EvidenceMediaKind = "image" | "video" | "unsupported";

export interface EvidenceInspection {
  evidenceId: string;
  repairIteration: number;
  exists: boolean;
  byteLength: number;
  mediaKind: EvidenceMediaKind;
  decodes: boolean;
  playable: boolean;
  hasMediaPayload: boolean;
}

export type EvidenceRejectionCode =
  | "NO_EVIDENCE"
  | "EVIDENCE_NOT_INSPECTED"
  | "STALE_ITERATION"
  | "FILE_MISSING"
  | "EMPTY_FILE"
  | "UNSUPPORTED_MEDIA"
  | "IMAGE_DECODE_FAILED"
  | "RECORDING_NOT_PLAYABLE"
  | "RECORDING_HAS_NO_MEDIA";

export interface EvidenceRejection {
  evidenceId?: string;
  code: EvidenceRejectionCode;
  message: string;
}

export type EvidenceGateResult =
  | { reviewable: true }
  | { reviewable: false; reasons: EvidenceRejection[] };

function inspectEvidence(
  evidence: VisualEvidence,
  currentRepairIteration: number,
  inspection: EvidenceInspection | undefined,
): EvidenceRejection[] {
  if (!inspection) {
    return [{
      evidenceId: evidence.evidenceId,
      code: "EVIDENCE_NOT_INSPECTED",
      message: "The visual evidence was not inspected.",
    }];
  }
  if (inspection.repairIteration !== currentRepairIteration) {
    return [{
      evidenceId: evidence.evidenceId,
      code: "STALE_ITERATION",
      message: "The visual evidence belongs to an older repair iteration.",
    }];
  }
  if (!inspection.exists) {
    return [{
      evidenceId: evidence.evidenceId,
      code: "FILE_MISSING",
      message: "The visual evidence file does not exist.",
    }];
  }
  if (!Number.isSafeInteger(inspection.byteLength) || inspection.byteLength <= 0) {
    return [{
      evidenceId: evidence.evidenceId,
      code: "EMPTY_FILE",
      message: "The visual evidence file is empty.",
    }];
  }

  if (evidence.type === "screenshot") {
    if (inspection.mediaKind !== "image") {
      return [{
        evidenceId: evidence.evidenceId,
        code: "UNSUPPORTED_MEDIA",
        message: "Screenshot evidence must contain a supported image.",
      }];
    }
    return inspection.decodes
      ? []
      : [{
          evidenceId: evidence.evidenceId,
          code: "IMAGE_DECODE_FAILED",
          message: "The screenshot cannot be decoded.",
        }];
  }

  if (inspection.mediaKind !== "video") {
    return [{
      evidenceId: evidence.evidenceId,
      code: "UNSUPPORTED_MEDIA",
      message: "Recording evidence must contain a supported video.",
    }];
  }
  if (!inspection.playable) {
    return [{
      evidenceId: evidence.evidenceId,
      code: "RECORDING_NOT_PLAYABLE",
      message: "The recording cannot be played.",
    }];
  }
  return inspection.hasMediaPayload
    ? []
    : [{
        evidenceId: evidence.evidenceId,
        code: "RECORDING_HAS_NO_MEDIA",
        message: "The recording contains no valid media payload.",
      }];
}

export function reviewVisualEvidence(
  delivery: Delivery,
  currentRepairIteration: number,
  inspections: EvidenceInspection[],
): EvidenceGateResult {
  if (delivery.evidence.length === 0) {
    return {
      reviewable: false,
      reasons: [{ code: "NO_EVIDENCE", message: "No visual evidence supplied." }],
    };
  }

  const byEvidenceId = new Map(
    inspections.map(
      (inspection) => [inspection.evidenceId, inspection] as const,
    ),
  );
  const reasons = delivery.evidence.flatMap((evidence) =>
    inspectEvidence(
      evidence,
      currentRepairIteration,
      byEvidenceId.get(evidence.evidenceId),
    ),
  );

  return reasons.length === 0
    ? { reviewable: true }
    : { reviewable: false, reasons };
}
