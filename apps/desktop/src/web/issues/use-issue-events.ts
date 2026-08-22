import { useEffect, useState } from "react";

import { api } from "../api/client.js";
import type { AgentEventDto } from "../api/types.js";

export function useIssueEvents(
  issueId: string | undefined,
  onSnapshot: () => void | Promise<void>
): AgentEventDto[] {
  const [byIssue, setByIssue] = useState<Record<string, AgentEventDto[]>>({});

  useEffect(() => {
    if (!issueId) return;
    let closed = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const merge = (incoming: AgentEventDto[]) => {
      if (closed || incoming.length === 0) return;
      setByIssue((current) => ({ ...current, [issueId]: mergeEvents(current[issueId] ?? [], incoming) }));
      const timer = setTimeout(() => void onSnapshot(), 200);
      timers.add(timer);
    };
    const unsubscribe = api.subscribeIssueEvents(issueId, 0, merge);
    return () => {
      closed = true;
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
    };
  }, [issueId, onSnapshot]);

  return issueId ? byIssue[issueId] ?? [] : [];
}

function mergeEvents(current: AgentEventDto[], incoming: AgentEventDto[]): AgentEventDto[] {
  const events = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) events.set(event.id, event);
  return [...events.values()].sort((left, right) => left.sequence - right.sequence);
}
