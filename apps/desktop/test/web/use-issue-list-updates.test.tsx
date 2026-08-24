// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../src/web/api/client.js";
import type { AgentEventDto, IssueDto } from "../../src/web/api/types.js";
import { useIssueListUpdates } from "../../src/web/issues/use-issue-list-updates.js";

const issue: IssueDto = {
  id: "issue-background",
  projectId: "project-1",
  identifier: "CHK-1",
  title: "Background issue",
  titleSource: "integration",
  status: "REPAIRING",
  inputs: [],
  revision: 1,
  createdAt: "2026-08-20T09:00:00.000Z",
  updatedAt: "2026-08-20T09:00:00.000Z",
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Issue list updates", () => {
  it("ignores a refresh that completes after its subscription is removed", async () => {
    vi.useFakeTimers();
    let listener: ((events: AgentEventDto[], cursor: number) => void) | undefined;
    let resolveSnapshot!: (value: IssueDto) => void;
    const snapshot = new Promise<IssueDto>((resolve) => {
      resolveSnapshot = resolve;
    });
    vi.spyOn(api, "subscribeIssueEvents").mockImplementation((_id, _cursor, next) => {
      listener = next;
      return () => undefined;
    });
    vi.spyOn(api, "issue").mockReturnValue(snapshot);
    const onUpdated = vi.fn();
    const { unmount } = renderHook(() =>
      useIssueListUpdates([issue], undefined, onUpdated)
    );

    act(() => listener?.([{
      id: "event-1",
      issueId: issue.id,
      sequence: 1,
      type: "REPAIR_STARTED",
      actor: "SYSTEM",
      data: {},
      occurredAt: "2026-08-20T09:01:00.000Z",
    }], 1));
    await act(() => vi.advanceTimersByTimeAsync(200));
    unmount();
    await act(async () => {
      resolveSnapshot({ ...issue, revision: 2 });
      await snapshot;
    });

    expect(onUpdated).not.toHaveBeenCalled();
  });
});
