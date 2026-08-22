import { writeFileSync } from "node:fs";
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
