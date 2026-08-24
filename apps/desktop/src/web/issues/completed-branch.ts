import type { AgentEventDto, BranchInfoDto } from "../api/types.js";

export function completedBranchFromEvents(
  events: AgentEventDto[],
): BranchInfoDto | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "ISSUE_COMPLETED") continue;
    const value = event.data.branch;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const candidate = value as Record<string, unknown>;
    if (!nonEmpty(candidate.name) || !nonEmpty(candidate.commit)) continue;
    return {
      name: candidate.name,
      commit: candidate.commit,
      ...(nonEmpty(candidate.remote) ? { remote: candidate.remote } : {}),
    };
  }
  return undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
