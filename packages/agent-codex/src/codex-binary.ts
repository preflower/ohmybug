import { execFile as nodeExecFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

export const EXPECTED_CODEX_VERSION = "0.148.0";

const REQUIRED_APP_SERVER_METHODS = [
  "initialize",
  "thread/start",
  "thread/resume",
  "thread/read",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
] as const;

export interface ResolvedCodexBinary {
  executablePath: string;
  packageVersion: string;
}

export function resolveCodexBinary(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): ResolvedCodexBinary {
  const require = createRequire(import.meta.url);
  const codexPackage = require.resolve("@openai/codex/package.json");
  const manifest = JSON.parse(readFileSync(codexPackage, "utf8")) as { version?: unknown };
  if (manifest.version !== EXPECTED_CODEX_VERSION) {
    throw new Error("CODEX_PROTOCOL_VERSION_MISMATCH");
  }
  const nativePackageName = nativeCodexPackageName(platform, arch);
  const nativePackage = require.resolve(`${nativePackageName}/package.json`);
  return {
    executablePath: join(
      dirname(nativePackage),
      "vendor",
      codexTargetTriple(platform, arch),
      "bin",
      platform === "win32" ? "codex.exe" : "codex",
    ),
    packageVersion: manifest.version,
  };
}

export async function verifyCodexBinary(
  resolved: ResolvedCodexBinary,
  execFile: typeof nodeExecFile = nodeExecFile,
): Promise<void> {
  if (resolved.packageVersion !== EXPECTED_CODEX_VERSION) {
    throw new Error("CODEX_PROTOCOL_VERSION_MISMATCH");
  }
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(resolved.executablePath, ["--version"], (error, output) => {
      if (error) reject(error);
      else resolve(output);
    });
  });
  if (stdout.trim() !== `codex-cli ${EXPECTED_CODEX_VERSION}`) {
    throw new Error("CODEX_PROTOCOL_VERSION_MISMATCH");
  }
}

export async function verifyGeneratedProtocolContract(
  schemaPath: string,
  expectedVersionPath: string,
): Promise<void> {
  const version = JSON.parse(await readFile(expectedVersionPath, "utf8")) as {
    codexCliVersion?: unknown;
    schemaFile?: unknown;
  };
  if (
    version.codexCliVersion !== EXPECTED_CODEX_VERSION ||
    version.schemaFile !== basename(schemaPath)
  ) {
    throw new Error("CODEX_PROTOCOL_VERSION_MISMATCH");
  }
  const serialized = JSON.stringify(JSON.parse(await readFile(schemaPath, "utf8")));
  for (const method of REQUIRED_APP_SERVER_METHODS) {
    if (!serialized.includes(`\"${method}\"`)) {
      throw new Error(`CODEX_PROTOCOL_METHOD_MISSING:${method}`);
    }
  }
}

function nativeCodexPackageName(platform: NodeJS.Platform, arch: string): string {
  const suffix = platform === "darwin" && arch === "arm64" ? "darwin-arm64"
    : platform === "darwin" && arch === "x64" ? "darwin-x64"
      : platform === "linux" && arch === "arm64" ? "linux-arm64"
        : platform === "linux" && arch === "x64" ? "linux-x64"
          : platform === "win32" && arch === "arm64" ? "win32-arm64"
            : platform === "win32" && arch === "x64" ? "win32-x64"
              : undefined;
  if (!suffix) throw new Error(`CODEX_PLATFORM_UNSUPPORTED:${platform}-${arch}`);
  return `@openai/codex-${suffix}`;
}

function codexTargetTriple(platform: NodeJS.Platform, arch: string): string {
  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (platform === "linux") {
    return arch === "arm64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
  }
  if (platform === "win32") {
    return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  throw new Error(`CODEX_PLATFORM_UNSUPPORTED:${platform}-${arch}`);
}
