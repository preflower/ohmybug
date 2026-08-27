import { useState } from "react";

import type { AgentEventDto } from "../api/types.js";

function currentSessionEvents(
  events: AgentEventDto[],
  sessionId?: string,
  allowUnconfirmedLegacy = true,
): AgentEventDto[] {
  if (!sessionId) return events;
  const taggedEvents = events.filter((event) => typeof event.data.logicalSessionId === "string");
  if (taggedEvents.length) {
    const currentSessionStart = events.findIndex((event) => event.data.logicalSessionId === sessionId);
    if (currentSessionStart < 0) return [];
    return events.slice(currentSessionStart).filter((event) => (
      typeof event.data.logicalSessionId !== "string"
      || event.data.logicalSessionId === sessionId
    ));
  }
  const rebuiltAt = events.findLastIndex((event) => (
    event.type === "AGENT_SESSION_REBUILT"
    && event.data.newLogicalSessionId === sessionId
  ));
  if (rebuiltAt >= 0) return events.slice(rebuiltAt + 1);
  return allowUnconfirmedLegacy ? events : [];
}

function terminalExecutionEvents(events: AgentEventDto[]): AgentEventDto[] {
  return events.filter((event) => (
    event.type === "MESSAGE"
    || event.type === "COMMAND"
    || event.type === "RUNTIME_INTERRUPTED"
    || (event.type.startsWith("AGENT_") && !event.type.startsWith("AGENT_SESSION_"))
  ));
}

export function currentExecutionEvents(
  events: AgentEventDto[],
  sessionId?: string,
  allowUnconfirmedLegacy = true,
): AgentEventDto[] {
  const sessionEvents = currentSessionEvents(events, sessionId, allowUnconfirmedLegacy);
  const boundary = sessionEvents.findLastIndex((event) => (
    event.type === "AGENT_TURN_COMPLETED"
    || event.type === "AGENT_ERROR"
    || event.type === "RUNTIME_INTERRUPTED"
    || event.type === "ISSUE_PAUSED"
    || event.type === "ISSUE_CANCELED"
  ));
  let executionEvents = sessionEvents.slice(boundary + 1);
  if (boundary >= 0) {
    const nextTurn = executionEvents.findIndex((event) => event.type === "AGENT_TURN_STARTED");
    if (nextTurn < 0) return [];
    executionEvents = executionEvents.slice(nextTurn);
  }
  return terminalExecutionEvents(executionEvents);
}

function hasAttributableSessionEvent(events: AgentEventDto[], sessionId?: string): boolean {
  if (!sessionId) return true;
  return events.some((event) => (
    event.data.logicalSessionId === sessionId
    || (event.type === "AGENT_SESSION_REBUILT" && event.data.newLogicalSessionId === sessionId)
  ));
}

export function useCurrentExecutionEvents(
  events: AgentEventDto[],
  issueId?: string,
  sessionId?: string,
): AgentEventDto[] {
  const [selection, setSelection] = useState<{
    issueId?: string;
    sessionId?: string;
    blockedLegacySession?: string;
  }>({ issueId, sessionId });
  let blockedLegacySession = selection.blockedLegacySession;
  if (selection.issueId === issueId && selection.sessionId !== sessionId) {
    blockedLegacySession = sessionId;
  } else if (selection.issueId !== issueId) {
    blockedLegacySession = undefined;
  }
  if (
    blockedLegacySession === sessionId
    && hasAttributableSessionEvent(events, sessionId)
  ) {
    blockedLegacySession = undefined;
  }
  if (
    selection.issueId !== issueId
    || selection.sessionId !== sessionId
    || selection.blockedLegacySession !== blockedLegacySession
  ) {
    setSelection({ issueId, sessionId, blockedLegacySession });
  }
  return currentExecutionEvents(events, sessionId, blockedLegacySession !== sessionId);
}

export function hasExecutionEvents(events: AgentEventDto[], active: boolean): boolean {
  return active && events.some((event) => (
    event.actor === "AGENT"
    && event.type !== "AGENT_TURN_COMPLETED"
  ));
}

export function hasCurrentSessionExecution(
  events: AgentEventDto[],
  active: boolean,
  sessionId?: string,
): boolean {
  return hasExecutionEvents(currentExecutionEvents(events, sessionId), active);
}
