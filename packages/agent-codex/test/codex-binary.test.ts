import { execFile as nodeExecFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  EXPECTED_CODEX_VERSION,
  verifyCodexBinary,
  verifyGeneratedProtocolContract,
  type ResolvedCodexBinary,
} from "../src/codex-binary.js";
import { createTempDir } from "./helpers.js";

describe("pinned Codex binary contract", () => {
  it("accepts only the exact pinned CLI version", async () => {
    const binary: ResolvedCodexBinary = {
      executablePath: "/opt/codex",
      packageVersion: EXPECTED_CODEX_VERSION,
    };
    const execFile = vi.fn((_file, _args, callback) => {
      callback(null, `codex-cli ${EXPECTED_CODEX_VERSION}\n`, "");
    }) as unknown as typeof nodeExecFile;

    await expect(verifyCodexBinary(binary, execFile)).resolves.toBeUndefined();
    expect(execFile).toHaveBeenCalledWith("/opt/codex", ["--version"], expect.any(Function));
  });

  it("rejects an executable whose version differs from its protocol", async () => {
    const binary: ResolvedCodexBinary = {
      executablePath: "/opt/codex",
      packageVersion: EXPECTED_CODEX_VERSION,
    };
    const execFile = vi.fn((_file, _args, callback) => {
      callback(null, "codex-cli 0.149.0\n", "");
    }) as unknown as typeof nodeExecFile;

    await expect(verifyCodexBinary(binary, execFile))
      .rejects.toThrow("CODEX_PROTOCOL_VERSION_MISMATCH");
  });

  it("requires every method used by the Runtime in the generated schema", async () => {
    const temporary = await createTempDir("oh-my-bug-codex-protocol-");
    const schemaPath = join(temporary.path, "schema.json");
    const versionPath = join(temporary.path, "version.json");
    try {
      await writeFile(schemaPath, JSON.stringify({
        methods: [
          "initialize",
          "thread/start",
          "thread/resume",
          "thread/read",
          "turn/start",
          "turn/steer",
          "turn/interrupt",
        ],
      }));
      await writeFile(versionPath, JSON.stringify({
        codexCliVersion: EXPECTED_CODEX_VERSION,
        schemaFile: "schema.json",
      }));

      await expect(verifyGeneratedProtocolContract(schemaPath, versionPath))
        .resolves.toBeUndefined();

      const schema = JSON.parse(await readFile(schemaPath, "utf8")) as { methods: string[] };
      schema.methods = schema.methods.filter((method) => method !== "turn/steer");
      await writeFile(schemaPath, JSON.stringify(schema));
      await expect(verifyGeneratedProtocolContract(schemaPath, versionPath))
        .rejects.toThrow("CODEX_PROTOCOL_METHOD_MISSING:turn/steer");
    } finally {
      await temporary.cleanup();
    }
  });

  it("declares exact package versions and generated runtime assets", async () => {
    const packageRoot = resolve(dirname(import.meta.dirname));
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
      ohMyBug?: { runtimeAssets?: string[] };
    };

    expect(manifest.dependencies).toMatchObject({
      "@openai/codex": "0.148.0",
      ws: "8.21.3",
      zod: "4.4.3",
    });
    expect(manifest.ohMyBug?.runtimeAssets).toEqual([
      "protocol/codex_app_server_protocol.schemas.json",
      "protocol/version.json",
    ]);
  });
});
