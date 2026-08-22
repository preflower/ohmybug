import { describe, expect, it } from "vitest";

import {
  reviewVisualEvidence,
  type EvidenceInspection,
  type Delivery,
} from "../../src/index.js";

const screenshotDelivery: Delivery = {
  summary: "支付页已恢复",
  evidence: [
    {
      type: "screenshot",
      label: "支付页正常打开",
      evidenceId: `sha256-${"a".repeat(64)}`,
    },
  ],
};

function inspection(
  overrides: Partial<EvidenceInspection> = {},
): EvidenceInspection {
  return {
    evidenceId: `sha256-${"a".repeat(64)}`,
    repairIteration: 2,
    exists: true,
    byteLength: 1024,
    mediaKind: "image",
    decodes: true,
    playable: false,
    hasMediaPayload: true,
    ...overrides,
  };
}

describe("visual evidence gate", () => {
  it("accepts a decodable screenshot from the current repair iteration", () => {
    expect(
      reviewVisualEvidence(screenshotDelivery, 2, [inspection()]),
    ).toEqual({ reviewable: true });
  });

  it("accepts a playable recording with media payload", () => {
    const delivery: Delivery = {
      summary: "性能恢复",
      evidence: [
        {
          type: "recording",
          label: "性能面板录屏",
          evidenceId: `sha256-${"b".repeat(64)}`,
        },
      ],
    };

    expect(
      reviewVisualEvidence(delivery, 3, [
        inspection({
          evidenceId: `sha256-${"b".repeat(64)}`,
          repairIteration: 3,
          mediaKind: "video",
          decodes: false,
          playable: true,
        }),
      ]),
    ).toEqual({ reviewable: true });
  });

  it.each([
    { inspections: [], code: "NO_EVIDENCE" },
    { inspections: [inspection({ exists: false })], code: "FILE_MISSING" },
    { inspections: [inspection({ byteLength: 0 })], code: "EMPTY_FILE" },
    { inspections: [inspection({ byteLength: Number.NaN })], code: "EMPTY_FILE" },
    {
      inspections: [inspection({ repairIteration: 1 })],
      code: "STALE_ITERATION",
    },
    {
      inspections: [inspection({ mediaKind: "unsupported" })],
      code: "UNSUPPORTED_MEDIA",
    },
    {
      inspections: [inspection({ decodes: false })],
      code: "IMAGE_DECODE_FAILED",
    },
  ] as const)(
    "rejects unusable screenshot facts with $code",
    ({ inspections, code }) => {
      const delivery =
        code === "NO_EVIDENCE"
          ? { summary: "支付页已恢复", evidence: [] }
          : screenshotDelivery;

      expect(reviewVisualEvidence(delivery, 2, [...inspections])).toMatchObject({
        reviewable: false,
        reasons: expect.arrayContaining([expect.objectContaining({ code })]),
      });
    },
  );

  it("rejects evidence that was not inspected", () => {
    expect(reviewVisualEvidence(screenshotDelivery, 2, [])).toMatchObject({
      reviewable: false,
      reasons: [
        expect.objectContaining({ code: "EVIDENCE_NOT_INSPECTED" }),
      ],
    });
  });

  it.each([
    { playable: false, hasMediaPayload: true, code: "RECORDING_NOT_PLAYABLE" },
    { playable: true, hasMediaPayload: false, code: "RECORDING_HAS_NO_MEDIA" },
  ] as const)("rejects unusable recording facts with $code", (testCase) => {
    const delivery: Delivery = {
      summary: "性能恢复",
      evidence: [
        {
          type: "recording",
          label: "性能面板录屏",
          evidenceId: `sha256-${"b".repeat(64)}`,
        },
      ],
    };

    expect(
      reviewVisualEvidence(delivery, 3, [
        inspection({
          evidenceId: `sha256-${"b".repeat(64)}`,
          repairIteration: 3,
          mediaKind: "video",
          playable: testCase.playable,
          hasMediaPayload: testCase.hasMediaPayload,
        }),
      ]),
    ).toMatchObject({
      reviewable: false,
      reasons: [expect.objectContaining({ code: testCase.code })],
    });
  });
});
