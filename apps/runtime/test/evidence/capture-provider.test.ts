import { describe, expect, it } from "vitest";

import { EvidenceCaptureError } from "../../src/evidence/capture-provider.js";

describe("EvidenceCaptureError", () => {
  it("exposes a stable public code without child-process diagnostics", () => {
    const diagnostic = "secret stderr from child process";
    const error = new EvidenceCaptureError(
      "EVIDENCE_CAPTURE_PROCESS_FAILED",
      "command",
      "capture command",
      { cause: new Error(diagnostic) },
    );

    expect(error).toMatchObject({
      name: "EvidenceCaptureError",
      code: "EVIDENCE_CAPTURE_PROCESS_FAILED",
      mode: "command",
      target: "capture command",
    });
    expect(error.message).toBe("EVIDENCE_CAPTURE_PROCESS_FAILED");
    expect(error.message).not.toContain(diagnostic);
  });
});
