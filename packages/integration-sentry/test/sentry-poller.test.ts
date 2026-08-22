import { describe, expect, it, vi } from "vitest";

import type { IntegrationCheckpointStore, IntegrationInput } from "@oh-my-bug/core";

import { SentryIntegrationAdapter } from "../src/sentry-adapter.js";
import { SentryPoller, type SentryIssueClient } from "../src/sentry-poller.js";

class MemoryCheckpoints implements IntegrationCheckpointStore {
  readonly values = new Map<string, string>();
  private failingKey?: string;

  get(projectId: string, integration: string, key: string) {
    return this.values.get(`${projectId}:${integration}:${key}`);
  }

  save(projectId: string, integration: string, key: string, value: string | undefined) {
    if (key === this.failingKey) {
      this.failingKey = undefined;
      throw new Error("CHECKPOINT_WRITE_FAILED");
    }
    const id = `${projectId}:${integration}:${key}`;
    if (value === undefined) this.values.delete(id);
    else this.values.set(id, value);
  }

  failNextSave(key: string) {
    this.failingKey = key;
  }
}

const issue = {
  id: "991122",
  title: "TypeError: cart is null",
  culprit: "checkout.submit",
  permalink: "https://sentry.example/issues/991122/",
  metadata: { filename: "src/checkout.ts", function: "submit" },
};

function event(eventID: string, minute: number, extra: Record<string, unknown> = {}) {
  return {
    eventID,
    dateCreated: `2026-08-20T09:${String(minute).padStart(2, "0")}:00.000Z`,
    title: "TypeError",
    message: `occurrence ${eventID}`,
    ...extra,
  };
}

function createPoller(options: {
  checkpoints: MemoryCheckpoints;
  client: SentryIssueClient;
  onInput?: (input: IntegrationInput) => Promise<void>;
}) {
  return new SentryPoller({
    projectId: "project-1",
    config: {
      organization: "acme",
      project: "checkout",
      environment: "production",
      query: "is:unresolved",
    },
    token: "secret",
    client: options.client,
    adapter: new SentryIntegrationAdapter({
      id: () => "input-1",
      now: () => new Date("2026-08-20T10:00:00.000Z"),
    }),
    checkpoints: options.checkpoints,
    onInput: options.onInput ?? (async () => undefined),
    jitter: () => 0,
    now: () => new Date("2026-08-20T10:00:00.000Z"),
  });
}

describe("Sentry poller", () => {
  it("accepts only the newest event on first observation and establishes its durable watermark", async () => {
    const checkpoints = new MemoryCheckpoints();
    checkpoints.save("project-1", "sentry", "cursor", "discovery-current");
    const client = {
      listIssues: vi.fn(async () => ({ issues: [issue], nextCursor: "discovery-next" })),
      listIssueEvents: vi.fn(async () => ({
        events: [event("event-b", 2), event("event-a", 1)],
      })),
    };
    const accepted: IntegrationInput[] = [];
    const poller = createPoller({
      checkpoints,
      client,
      onInput: async (input) => { accepted.push(input); },
    });

    await poller.pollOnce();

    expect(client.listIssues).toHaveBeenCalledWith({
      organization: "acme",
      project: "checkout",
      environment: "production",
      query: "is:unresolved",
    }, "secret", "discovery-current");
    expect(client.listIssueEvents).toHaveBeenCalledWith(
      expect.anything(), "secret", issue.id, undefined,
    );
    expect(accepted.map((input) => input.inputKey)).toEqual(["event-b"]);
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-b");
    expect(checkpoints.get("project-1", "sentry", "cursor")).toBe("discovery-next");
    expect(poller.health()).toEqual({
      state: "connected",
      lastSuccessAt: "2026-08-20T10:00:00.000Z",
    });
    expect(Object.isFrozen(poller.health())).toBe(true);
  });

  it("delivers every newer event oldest-first before advancing the watermark", async () => {
    const checkpoints = new MemoryCheckpoints();
    checkpoints.save("project-1", "sentry", `event-watermark:${issue.id}`, "event-a");
    const client = {
      listIssues: vi.fn(async () => ({ issues: [issue] })),
      listIssueEvents: vi.fn(async () => ({
        events: [event("event-c", 3), event("event-b", 2), event("event-a", 1)],
      })),
    };
    const accepted: string[] = [];
    const poller = createPoller({
      checkpoints,
      client,
      onInput: async (input) => { accepted.push(input.inputKey); },
    });

    await poller.pollOnce();

    expect(accepted).toEqual(["event-b", "event-c"]);
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-c");
  });

  it("walks multiple newest-first pages to the prior watermark and de-duplicates event IDs", async () => {
    const checkpoints = new MemoryCheckpoints();
    checkpoints.save("project-1", "sentry", `event-watermark:${issue.id}`, "event-a");
    const listIssueEvents = vi.fn(async (
      _config: unknown,
      _token: string,
      _issueId: string,
      cursor?: string,
    ) => cursor === undefined
      ? { events: [event("event-d", 4), event("event-c", 3)], nextCursor: "opaque:page:2" }
      : { events: [event("event-c", 3), event("event-b", 2), event("event-a", 1)] });
    const client = {
      listIssues: vi.fn(async () => ({ issues: [issue] })),
      listIssueEvents,
    };
    const accepted: string[] = [];
    const poller = createPoller({
      checkpoints,
      client,
      onInput: async (input) => { accepted.push(input.inputKey); },
    });

    await poller.pollOnce();

    expect(listIssueEvents.mock.calls.map((call) => call[3])).toEqual([
      undefined,
      "opaque:page:2",
    ]);
    expect(accepted).toEqual(["event-b", "event-c", "event-d"]);
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-d");
  });

  it("keeps the old watermark and exactly redelivers the batch after an intake failure", async () => {
    const checkpoints = new MemoryCheckpoints();
    checkpoints.save("project-1", "sentry", `event-watermark:${issue.id}`, "event-a");
    const client = {
      listIssues: vi.fn(async () => ({ issues: [issue] })),
      listIssueEvents: vi.fn(async () => ({
        events: [event("event-c", 3), event("event-b", 2), event("event-a", 1)],
      })),
    };
    const attempted: string[] = [];
    let fail = true;
    const poller = createPoller({
      checkpoints,
      client,
      onInput: async (input) => {
        attempted.push(input.inputKey);
        if (input.inputKey === "event-c" && fail) {
          fail = false;
          throw new Error("SQLITE_BUSY");
        }
      },
    });

    await expect(poller.pollOnce()).rejects.toThrow("SQLITE_BUSY");
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-a");

    await expect(poller.pollOnce()).resolves.toBeUndefined();

    expect(attempted).toEqual(["event-b", "event-c", "event-b", "event-c"]);
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-c");
  });

  it("redelivers the accepted batch when saving its newest watermark fails", async () => {
    const checkpoints = new MemoryCheckpoints();
    const watermarkKey = `event-watermark:${issue.id}`;
    checkpoints.save("project-1", "sentry", watermarkKey, "event-a");
    checkpoints.save("project-1", "sentry", "cursor", "discovery-current");
    checkpoints.failNextSave(watermarkKey);
    const client = {
      listIssues: vi.fn(async () => ({ issues: [issue], nextCursor: "discovery-next" })),
      listIssueEvents: vi.fn(async () => ({
        events: [event("event-c", 3), event("event-b", 2), event("event-a", 1)],
      })),
    };
    const accepted: string[] = [];
    const poller = createPoller({
      checkpoints,
      client,
      onInput: async (input) => { accepted.push(input.inputKey); },
    });

    await expect(poller.pollOnce()).rejects.toThrow("CHECKPOINT_WRITE_FAILED");

    expect(accepted).toEqual(["event-b", "event-c"]);
    expect(checkpoints.get("project-1", "sentry", watermarkKey)).toBe("event-a");
    expect(checkpoints.get("project-1", "sentry", "cursor")).toBe("discovery-current");
    expect(poller.health()).toMatchObject({
      state: "backoff",
      lastError: "CHECKPOINT_WRITE_FAILED",
    });

    await poller.pollOnce();

    expect(accepted).toEqual(["event-b", "event-c", "event-b", "event-c"]);
    expect(checkpoints.get("project-1", "sentry", watermarkKey)).toBe("event-c");
    expect(checkpoints.get("project-1", "sentry", "cursor")).toBe("discovery-next");
  });

  it("resumes from the durable per-issue watermark after a poller restart", async () => {
    const checkpoints = new MemoryCheckpoints();
    const firstClient = {
      listIssues: vi.fn(async () => ({ issues: [issue] })),
      listIssueEvents: vi.fn(async () => ({ events: [event("event-a", 1)] })),
    };
    const firstAccepted: string[] = [];
    await createPoller({
      checkpoints,
      client: firstClient,
      onInput: async (input) => { firstAccepted.push(input.inputKey); },
    }).pollOnce();

    const restartedClient = {
      listIssues: vi.fn(async () => ({ issues: [issue] })),
      listIssueEvents: vi.fn(async () => ({
        events: [event("event-c", 3), event("event-b", 2), event("event-a", 1)],
      })),
    };
    const restartedAccepted: string[] = [];
    await createPoller({
      checkpoints,
      client: restartedClient,
      onInput: async (input) => { restartedAccepted.push(input.inputKey); },
    }).pollOnce();

    expect(firstAccepted).toEqual(["event-a"]);
    expect(restartedAccepted).toEqual(["event-b", "event-c"]);
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-c");
  });

  it("does not partially intake when the previous watermark is absent from all available pages", async () => {
    const checkpoints = new MemoryCheckpoints();
    checkpoints.save("project-1", "sentry", `event-watermark:${issue.id}`, "event-old");
    checkpoints.save("project-1", "sentry", "cursor", "discovery-current");
    const client = {
      listIssues: vi.fn(async () => ({ issues: [issue], nextCursor: "discovery-next" })),
      listIssueEvents: vi.fn(async (
        _config: unknown,
        _token: string,
        _issueId: string,
        cursor?: string,
      ) => cursor === undefined
        ? { events: [event("event-c", 3), event("event-b", 2)], nextCursor: "page-2" }
        : { events: [event("event-a", 1)] }),
    };
    const onInput = vi.fn(async () => undefined);
    const poller = createPoller({ checkpoints, client, onInput });

    await expect(poller.pollOnce()).rejects.toThrow("SENTRY_EVENT_WATERMARK_NOT_FOUND");

    expect(onInput).not.toHaveBeenCalled();
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-old");
    expect(checkpoints.get("project-1", "sentry", "cursor")).toBe("discovery-current");
    expect(poller.health()).toMatchObject({
      state: "backoff",
      lastError: "SENTRY_EVENT_WATERMARK_NOT_FOUND",
    });
  });

  it("fails closed at the bounded event-page scan when a watermark cannot be reached", async () => {
    const checkpoints = new MemoryCheckpoints();
    checkpoints.save("project-1", "sentry", `event-watermark:${issue.id}`, "event-old");
    let page = 0;
    const listIssueEvents = vi.fn(async () => {
      page += 1;
      return {
        events: [event(`event-${page}`, page % 60)],
        nextCursor: `cursor-${page}`,
      };
    });
    const client = {
      listIssues: vi.fn(async () => ({ issues: [issue] })),
      listIssueEvents,
    };
    const onInput = vi.fn(async () => undefined);

    await expect(createPoller({ checkpoints, client, onInput }).pollOnce())
      .rejects.toThrow("SENTRY_EVENT_WATERMARK_NOT_FOUND");

    expect(listIssueEvents).toHaveBeenCalledTimes(20);
    expect(onInput).not.toHaveBeenCalled();
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-old");
  });

  it("detects a repeated opaque page cursor without looping or advancing the watermark", async () => {
    const checkpoints = new MemoryCheckpoints();
    checkpoints.save("project-1", "sentry", `event-watermark:${issue.id}`, "event-old");
    const listIssueEvents = vi.fn(async () => ({
      events: [event("event-c", 3)],
      nextCursor: "repeat-cursor",
    }));
    const client = {
      listIssues: vi.fn(async () => ({ issues: [issue] })),
      listIssueEvents,
    };
    const onInput = vi.fn(async () => undefined);

    await expect(createPoller({ checkpoints, client, onInput }).pollOnce())
      .rejects.toThrow("SENTRY_EVENT_PAGE_LOOP");

    expect(listIssueEvents).toHaveBeenCalledTimes(2);
    expect(onInput).not.toHaveBeenCalled();
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-old");
  });

  it("rejects an empty event ID before any intake or watermark change", async () => {
    const checkpoints = new MemoryCheckpoints();
    checkpoints.save("project-1", "sentry", `event-watermark:${issue.id}`, "event-a");
    const client = {
      listIssues: vi.fn(async () => ({ issues: [issue] })),
      listIssueEvents: vi.fn(async () => ({
        events: [event("  ", 2), event("event-a", 1)],
      })),
    };
    const onInput = vi.fn(async () => undefined);

    await expect(createPoller({ checkpoints, client, onInput }).pollOnce())
      .rejects.toThrow("SENTRY_EVENT_ID_REQUIRED");

    expect(onInput).not.toHaveBeenCalled();
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-a");
  });

  it("validates every event timestamp before beginning sequential intake", async () => {
    const checkpoints = new MemoryCheckpoints();
    checkpoints.save("project-1", "sentry", `event-watermark:${issue.id}`, "event-a");
    const client = {
      listIssues: vi.fn(async () => ({ issues: [issue] })),
      listIssueEvents: vi.fn(async () => ({
        events: [
          event("event-c", 3),
          event("event-b", 2, { dateCreated: "not-a-timestamp" }),
          event("event-a", 1),
        ],
      })),
    };
    const onInput = vi.fn(async () => undefined);

    await expect(createPoller({ checkpoints, client, onInput }).pollOnce())
      .rejects.toThrow("SENTRY_EVENT_TIMESTAMP_INVALID");

    expect(onInput).not.toHaveBeenCalled();
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-a");
  });

  it("continues independent issues but keeps source health failed when one issue fails", async () => {
    const otherIssue = { ...issue, id: "445566", title: "ReferenceError" };
    const checkpoints = new MemoryCheckpoints();
    checkpoints.save("project-1", "sentry", `event-watermark:${issue.id}`, "event-old");
    checkpoints.save("project-1", "sentry", "cursor", "discovery-current");
    const client = {
      listIssues: vi.fn(async () => ({
        issues: [issue, otherIssue],
        nextCursor: "discovery-next",
      })),
      listIssueEvents: vi.fn(async (
        _config: unknown,
        _token: string,
        issueId: string,
      ) => issueId === issue.id
        ? { events: [event("event-c", 3)] }
        : { events: [event("other-a", 4)] }),
    };
    const accepted: string[] = [];
    const poller = createPoller({
      checkpoints,
      client,
      onInput: async (input) => { accepted.push(input.inputKey); },
    });

    await expect(poller.pollOnce()).rejects.toThrow("SENTRY_EVENT_WATERMARK_NOT_FOUND");

    expect(accepted).toEqual(["other-a"]);
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${issue.id}`))
      .toBe("event-old");
    expect(checkpoints.get("project-1", "sentry", `event-watermark:${otherIssue.id}`))
      .toBe("other-a");
    expect(checkpoints.get("project-1", "sentry", "cursor")).toBe("discovery-current");
    expect(poller.health()).toMatchObject({
      state: "backoff",
      lastError: "SENTRY_EVENT_WATERMARK_NOT_FOUND",
    });
  });
});
