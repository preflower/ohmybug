import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const AGENT_PRIVATE_TEMP_PREFIX = ".oh-my-bug-tmp-";
const ownerMarker = ".oh-my-bug-owned-temp";
const ownerMarkerContent = "oh-my-bug-agent-private-temp-v1\n";

export function markAgentPrivateTemp(path: string): void {
  writeFileSync(join(path, ownerMarker), ownerMarkerContent, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

export function ensureAgentPrivateTemp(workingDirectory: string, sessionId: string): string {
  if (!sessionId.trim()) throw new Error("AGENT_SESSION_ID_REQUIRED");
  const digest = createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
  const path = join(workingDirectory, `${AGENT_PRIVATE_TEMP_PREFIX}${digest}`);
  try {
    mkdirSync(path, { mode: 0o700 });
    markAgentPrivateTemp(path);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const metadata = lstatSync(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("AGENT_PRIVATE_TEMP_UNSAFE", { cause: error });
    }
    if (readFileSync(join(path, ownerMarker), "utf8") !== ownerMarkerContent) {
      throw new Error("AGENT_PRIVATE_TEMP_UNSAFE", { cause: error });
    }
    chmodSync(path, 0o700);
  }
  return path;
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}
