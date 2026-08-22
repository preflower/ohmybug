import { spawn } from "node:child_process";
import { mkdtemp, open, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertMediaContent,
  readBounded,
  recoverStaleMediaProbeDirectories,
} from "../../src/evidence/media-inspector.js";
import { createTempDir } from "../helpers.js";

describe("evidence media inspection", () => {
  it("enforces the byte limit while reading from an opened descriptor", async () => {
    const temporary = await createTempDir("oh-my-bug-evidence-read-limit-");
    try {
      const path = join(temporary.path, "growing.bin");
      await writeFile(path, "12345");
      const handle = await open(path, "r");
      try {
        await expect(readBounded(handle, 4)).rejects.toThrow("EVIDENCE_SIZE_OR_TYPE_INVALID");
      } finally {
        await handle.close();
      }
    } finally {
      await temporary.cleanup();
    }
  });

  it("decodes supported image bytes and rejects mismatched content", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    await expect(assertMediaContent(png, "image/png")).resolves.toBeUndefined();
    await expect(assertMediaContent(Buffer.from("not an image"), "image/png"))
      .rejects.toThrow("EVIDENCE_CONTENT_TYPE_INVALID");
    await expect(assertMediaContent(Buffer.from("report"), "text/plain"))
      .rejects.toThrow("EVIDENCE_CONTENT_TYPE_INVALID");
  });

  it("caps the media parser WebAssembly memory", async () => {
    const probeScript = fileURLToPath(
      new URL("../../src/evidence/media-probe-child.mjs", import.meta.url),
    );
    const output = await new Promise<string>((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [probeScript], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, OH_MY_BUG_MEDIA_PROBE_SELF_TEST: "1" },
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", rejectPromise);
      child.on("close", (code) => {
        if (code !== 0) {
          rejectPromise(new Error(Buffer.concat(stderr).toString("utf8")));
          return;
        }
        resolvePromise(Buffer.concat(stdout).toString("utf8"));
      });
    });

    expect(JSON.parse(output)).toMatchObject({
      originalMemoryMaximumPages: 32768,
      memoryMinimumPages: expect.any(Number),
      memoryMaximumPages: 2048,
      growthBeyondLimitRejected: true,
    });
  });

  it("recovers only stale owned media probe directories", async () => {
    const stale = await mkdtemp(join(tmpdir(), "oh-my-bug-media-probe-"));
    await writeFile(join(stale, ".oh-my-bug-owner.json"), JSON.stringify({
      version: 1,
      parentPid: 2_147_483_647,
      createdAt: new Date(0).toISOString(),
    }));

    await recoverStaleMediaProbeDirectories();

    await expect(stat(stale)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
