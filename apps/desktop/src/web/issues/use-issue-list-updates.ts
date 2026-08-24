import { useEffect } from "react";

import { api } from "../api/client.js";
import type { IssueDto } from "../api/types.js";

const terminalStatuses = new Set<IssueDto["status"]>([
  "COMPLETED",
  "CLOSED",
  "CANCELED",
]);

export function useIssueListUpdates(
  issues: IssueDto[],
  selectedId: string | undefined,
  onUpdated: (issue: IssueDto) => void,
): void {
  const subscriptionKey = issues
    .filter((issue) => issue.id !== selectedId && !terminalStatuses.has(issue.status))
    .map((issue) => issue.id)
    .sort()
    .join("\u0000");

  useEffect(() => {
    if (!subscriptionKey) return;
    const unsubscribers = subscriptionKey.split("\u0000").map((issueId) => {
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = api.subscribeIssueEvents(issueId, 0, (events) => {
        if (!active || events.length === 0) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          void api.issue(issueId).then((issue) => {
            if (active) onUpdated(issue);
          }).catch(() => undefined);
        }, 200);
      });
      return () => {
        active = false;
        if (timer) clearTimeout(timer);
        unsubscribe();
      };
    });
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [onUpdated, subscriptionKey]);
}
