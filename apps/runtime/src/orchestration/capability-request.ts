import type { AgentCapabilityRequest } from "@oh-my-bug/core";

const secretAssignment = /((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)\s*[=:]\s*)([^\s"']+)/gi;
const bearerToken = /(bearer\s+)([^\s"']+)/gi;

function safeText(value: string, maxLength: number): string {
  return value
    .trim()
    .replace(secretAssignment, "$1[REDACTED]")
    .replace(bearerToken, "$1[REDACTED]")
    .slice(0, maxLength);
}

export function publicCapabilityRequest(
  request: AgentCapabilityRequest,
): AgentCapabilityRequest {
  return {
    capabilities: [...new Set(request.capabilities)],
    reason: safeText(request.reason, 4_000),
    ...(request.blockedCommand
      ? { blockedCommand: safeText(request.blockedCommand, 2_000) }
      : {}),
    ...(request.requestedBy
      ? {
          requestedBy: {
            type: request.requestedBy.type,
            ...(request.requestedBy.id
              ? { id: safeText(request.requestedBy.id, 200) }
              : {}),
          },
        }
      : {}),
  };
}
