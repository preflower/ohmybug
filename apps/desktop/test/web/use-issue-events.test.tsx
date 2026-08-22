// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../src/web/api/client.js";
import type { AgentEventDto } from "../../src/web/api/types.js";
import { useIssueEvents } from "../../src/web/issues/use-issue-events.js";

const historicalEvent: AgentEventDto = {
  id: "issue-1:1",
  issueId: "issue-1",
  sequence: 1,
  actor: "SYSTEM",
  type: "ISSUE_CREATED",
  occurredAt: "2026-08-19T09:00:00.000Z",
  data: { message: "Issue created" },
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Issue event history", () => {
  it("restores persisted Runtime events after the renderer reloads", async () => {
    localStorage.setItem("oh-my-bug:event-cursor:issue-1", "1");
    vi.spyOn(api, "subscribeIssueEvents").mockImplementation((_issueId, cursor, listener) => {
      const events = cursor < historicalEvent.sequence ? [historicalEvent] : [];
      listener(events, historicalEvent.sequence);
      return () => undefined;
    });

    const onSnapshot = vi.fn();
    const { result } = renderHook(() => useIssueEvents("issue-1", onSnapshot));

    await waitFor(() => expect(result.current).toEqual([historicalEvent]));
  });
});
