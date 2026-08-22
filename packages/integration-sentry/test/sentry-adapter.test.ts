import { describe, expect, it } from "vitest";

import { SentryIntegrationAdapter } from "../src/sentry-adapter.js";

const issue = {
  id: "991122",
  title: "TypeError: cart is null",
  culprit: "checkout.submit",
  permalink: "https://sentry.example/issues/991122/",
  lastSeen: "2026-08-20T09:05:00.000Z",
  metadata: { filename: "src/checkout.ts", function: "submit" },
};

const event = {
  eventID: "event-a",
  dateCreated: "2026-08-20T08:58:00.000Z",
  title: "TypeError",
  message: "cart lookup failed",
  culprit: "checkout.submit",
  location: "src/checkout.ts:42",
  platform: "javascript",
  tags: [{ key: "environment", value: "production" }],
  metadata: { type: "TypeError", value: "cart is null" },
};

describe("Sentry integration adapter", () => {
  it("uses the stable occurrence ID, groups by issue, and merges issue and event details", async () => {
    const adapter = new SentryIntegrationAdapter({
      id: () => "input-1",
      now: () => new Date("2026-08-20T10:00:00.000Z"),
    });

    const first = await adapter.adapt({ issue, event });
    const second = await adapter.adapt({ issue, event: { ...event, eventID: "event-b" } });
    const redelivery = await adapter.adapt({ issue, event });

    expect(first).toMatchObject({
      integration: "sentry",
      inputKey: "event-a",
      groupKey: "991122",
      rawData: { issue, event },
      data: {
        summary: issue.title,
        occurredAt: event.dateCreated,
        context: {
          issue: expect.objectContaining({ culprit: issue.culprit, permalink: issue.permalink }),
          occurrence: expect.objectContaining({
            eventID: event.eventID,
            location: event.location,
            platform: event.platform,
            tags: event.tags,
          }),
        },
      },
    });
    expect(first.data.content).toContain(issue.title);
    expect(first.data.content).toContain(event.dateCreated);
    expect(first.data.content).toContain(event.message);
    expect(first.data.content).toContain(event.location);
    expect(second.inputKey).toBe("event-b");
    expect(second.groupKey).toBe(first.groupKey);
    expect(redelivery.inputKey).toBe(first.inputKey);
  });

  it("redacts credentials from rawData, content, summary, and normalized context", async () => {
    const adapter = new SentryIntegrationAdapter({
      id: () => "input-1",
      secretValues: ["sentry-secret"],
    });

    const input = await adapter.adapt({
      issue: {
        ...issue,
        title: "TypeError sentry-secret",
        permalink: "https://sentry.example/?access_token=sentry-secret",
        metadata: { authorization: "Bearer sentry-secret", value: "sentry-secret" },
      },
      event: {
        ...event,
        message: "Authorization: Bearer sentry-secret",
        contexts: { request: { token: "sentry-secret" } },
      },
    });

    expect(JSON.stringify(input)).not.toContain("sentry-secret");
    expect(input.data.content).toContain("[REDACTED]");
  });

  it.each([
    { label: "missing", event: { ...event, eventID: undefined } },
    { label: "empty", event: { ...event, eventID: "  " } },
  ])("rejects a $label eventID instead of inventing an occurrence identity", async (fixture) => {
    const adapter = new SentryIntegrationAdapter();

    await expect(adapter.adapt({ issue, event: fixture.event }))
      .rejects.toThrow("SENTRY_EVENT_ID_REQUIRED");
  });

  it.each([
    { label: "missing", dateCreated: undefined },
    { label: "empty", dateCreated: "" },
    { label: "invalid", dateCreated: "not-a-timestamp" },
  ])("rejects a $label event timestamp instead of using receipt time", async (fixture) => {
    const adapter = new SentryIntegrationAdapter();

    await expect(adapter.adapt({ issue, event: { ...event, dateCreated: fixture.dateCreated } }))
      .rejects.toThrow("SENTRY_EVENT_TIMESTAMP_INVALID");
  });
});
