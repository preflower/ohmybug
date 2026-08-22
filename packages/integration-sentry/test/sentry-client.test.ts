import { describe, expect, it, vi } from "vitest";

import { SentryClient } from "../src/sentry-client.js";

describe("Sentry client", () => {
  it("preserves the configured issue discovery filters and bearer authentication", async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify([{ id: "issue-1" }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://sentry.io/api/0/organizations/acme/issues/?cursor=next>; rel="next"; results="true"',
        },
      });
    });
    const client = new SentryClient(fetcher);

    const page = await client.listIssues({
      organization: "acme",
      project: "checkout",
      environment: "production",
      query: "is:unresolved",
    }, "sentry-secret", "current");

    const [request, init] = fetcher.mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.pathname).toBe("/api/0/organizations/acme/issues/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      cursor: "current",
      environment: "production",
      project: "checkout",
      query: "is:unresolved",
    });
    expect(String(request)).not.toContain("sentry-secret");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sentry-secret");
    expect(page.nextCursor).toBe("next");
  });

  it("lists issue events from the official organization endpoint and treats the cursor as opaque", async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify([{
        eventID: "event-b",
        dateCreated: "2026-08-20T09:00:00Z",
        title: "TypeError",
      }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: [
            '<https://sentry.io/api/0/organizations/acme/issues/991122/events/?cursor=previous>; rel="previous"; results="false"',
            '<https://sentry.io/api/0/organizations/acme/issues/991122/events/?cursor=next%3A0%3A%2B%2F%3D>; title="newer, events"; rel="next"; results="true"',
          ].join(", "),
        },
      });
    });
    const client = new SentryClient(fetcher);

    const page = await client.listIssueEvents(
      { organization: "acme", project: "checkout" },
      "sentry-secret",
      "991122",
      "current:0:+/=",
    );

    const [request, init] = fetcher.mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.pathname).toBe("/api/0/organizations/acme/issues/991122/events/");
    expect(url.searchParams.get("cursor")).toBe("current:0:+/=");
    expect(url.searchParams.has("page")).toBe(false);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sentry-secret");
    expect(page).toEqual({
      events: [{
        eventID: "event-b",
        dateCreated: "2026-08-20T09:00:00Z",
        title: "TypeError",
      }],
      nextCursor: "next:0:+/=",
    });
  });

  it.each([
    { label: "object", payload: { eventID: "event-a" } },
    { label: "primitive entry", payload: [{ eventID: "event-a" }, null] },
    { label: "array entry", payload: [[{ eventID: "event-a" }]] },
  ])("rejects a successful issue-events response containing $label", async ({ payload }) => {
    const client = new SentryClient(async () => Response.json(payload));

    await expect(client.listIssueEvents(
      { organization: "acme", project: "checkout" },
      "secret",
      "991122",
    )).rejects.toThrow("SENTRY_RESPONSE_INVALID");
  });

  it("fails closed when a results-bearing next link has no cursor", async () => {
    const client = new SentryClient(async () => new Response("[]", {
      headers: {
        link: '<https://sentry.io/api/0/organizations/acme/issues/991122/events/>; rel="next"; results="true"',
      },
    }));

    await expect(client.listIssueEvents(
      { organization: "acme", project: "checkout" },
      "secret",
      "991122",
    )).rejects.toThrow("SENTRY_PAGINATION_INVALID");
  });

  it("rejects a successful issue discovery response that is not an array of objects", async () => {
    const client = new SentryClient(async () => Response.json({ id: "not-an-array" }));

    await expect(client.listIssues({ organization: "acme", project: "checkout" }, "secret"))
      .rejects.toThrow("SENTRY_RESPONSE_INVALID");
  });
});
