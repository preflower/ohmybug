import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  EXPECTED_CODEX_VERSION,
  resolveCodexBinary,
  verifyCodexBinary,
  verifyGeneratedProtocolContract,
} from "../packages/agent-codex/src/codex-binary.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolRoot = join(projectRoot, "packages/agent-codex/protocol");
const schemaName = "codex_app_server_protocol.schemas.json";

async function generate(): Promise<void> {
  const binary = resolveCodexBinary();
  await verifyCodexBinary(binary);
  const temporary = await mkdtemp(join(tmpdir(), "oh-my-bug-codex-schema-"));
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      execFile(
        binary.executablePath,
        ["app-server", "generate-json-schema", "--out", temporary],
        (error) => error ? rejectPromise(error) : resolvePromise(),
      );
    });
    await mkdir(protocolRoot, { recursive: true });
    const schemaPath = join(protocolRoot, schemaName);
    const versionPath = join(protocolRoot, "version.json");
    await copyFile(join(temporary, schemaName), schemaPath);
    await writeFile(versionPath, `${JSON.stringify({
      codexCliVersion: EXPECTED_CODEX_VERSION,
      schemaFile: schemaName,
    }, null, 2)}\n`);
    await verifyGeneratedProtocolContract(schemaPath, versionPath);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generate().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
