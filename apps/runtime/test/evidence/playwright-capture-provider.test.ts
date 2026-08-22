import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import type { EvidenceCaptureRequest } from "../../src/evidence/capture-provider.js";
import { PlaywrightEvidenceCaptureProvider } from "../../src/evidence/playwright-capture-provider.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/evidence",
);

describe("PlaywrightEvidenceCaptureProvider", () => {
  let temporaryDirectory: string;
  let intakeDirectory: string;
  const provider = new PlaywrightEvidenceCaptureProvider();

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "omb-evidence-provider-"));
    intakeDirectory = join(temporaryDirectory, "intake");
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("captures a ready localhost page and cleans up its own server", async () => {
    const port = await reservePort();
    const request: EvidenceCaptureRequest = {
      issueId: "issue-browser",
      workspaceDirectory: fixtureDirectory,
      intakeDirectory,
      commands: {
        start: `PORT=${port} node browser-server.cjs`,
        acceptanceUrl: `http://127.0.0.1:${port}`,
      },
      capture: { mode: "browser", label: "Browser proof", timeoutMs: 5_000 },
    };

    const artifact = await provider.capture(request);

    expect(artifact).toMatchObject({ type: "screenshot", label: "Browser proof" });
    await expect(access(artifact.path)).resolves.toBeUndefined();
    await expect(fetch(request.commands.acceptanceUrl!)).rejects.toThrow();
  });

  it("captures the first Electron window", async () => {
    const request: EvidenceCaptureRequest = {
      issueId: "issue-electron",
      workspaceDirectory: fixtureDirectory,
      intakeDirectory,
      commands: {},
      capture: {
        mode: "electron",
        label: "Electron proof",
        electronEntry: "electron-main.cjs",
        timeoutMs: 10_000,
      },
    };

    const artifact = await provider.capture(request);

    expect(artifact.type).toBe("screenshot");
    expect((await stat(artifact.path)).size).toBeGreaterThan(0);
  });

  it("passes one controlled output path to command capture", async () => {
    const request = commandRequest("node write-png.cjs");

    const artifact = await provider.capture(request);

    expect(dirname(artifact.path)).toBe(intakeDirectory);
    expect((await stat(artifact.path)).size).toBeGreaterThan(0);
  });

  it.each([
    ["unreachable", "EVIDENCE_TARGET_UNREACHABLE"],
    ["permission", "EVIDENCE_CAPTURE_PERMISSION_DENIED"],
    ["non-zero", "EVIDENCE_CAPTURE_PROCESS_FAILED"],
    ["missing", "EVIDENCE_FILE_MISSING"],
    ["escaped", "EVIDENCE_CAPTURE_PERMISSION_DENIED"],
  ] as const)("maps %s capture failure to %s", async (kind, code) => {
    const request = await failureRequest(kind);
    await expect(provider.capture(request)).rejects.toMatchObject({ code });
  });

  function commandRequest(command: string): EvidenceCaptureRequest {
    return {
      issueId: "issue-command",
      workspaceDirectory: fixtureDirectory,
      intakeDirectory,
      commands: {},
      capture: { mode: "command", label: "Command proof", command, timeoutMs: 2_000 },
    };
  }

  async function failureRequest(
    kind: "unreachable" | "permission" | "non-zero" | "missing" | "escaped",
  ): Promise<EvidenceCaptureRequest> {
    if (kind === "unreachable") {
      const port = await reservePort();
      return {
        issueId: "issue-unreachable",
        workspaceDirectory: fixtureDirectory,
        intakeDirectory,
        commands: {
          start: "node -e \"process.exit(0)\"",
          acceptanceUrl: `http://127.0.0.1:${port}`,
        },
        capture: { mode: "browser", label: "Browser proof", timeoutMs: 300 },
      };
    }
    if (kind === "permission") return commandRequest("./write-png.cjs");
    if (kind === "non-zero") return commandRequest("node -e \"process.exit(2)\"");
    if (kind === "missing") return commandRequest("node -e \"process.exit(0)\"");
    const escapedPath = join(temporaryDirectory, "escaped.png");
    return commandRequest(
      `node -e "const f=require('fs');f.symlinkSync('${escapedPath}',process.env.OH_MY_BUG_EVIDENCE_PATH);f.writeFileSync('${escapedPath}','escaped')"`,
    );
  }
});

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("PORT_REQUIRED");
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return address.port;
}
