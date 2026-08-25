import type {
  IntegrationCheckpointStore,
  IntegrationInput,
  IntegrationPluginContext,
} from "@oh-my-bug/core";
import { describe, expect, it, vi } from "vitest";

import { sentryPlugin } from "../src/plugin.js";
import { SentryPoller, type SentryIssueClient } from "../src/sentry-poller.js";

class MemoryCheckpoints implements IntegrationCheckpointStore {
  readonly values = new Map<string, string>();
  get(projectId: string, integration: string, key: string) {
    return this.values.get(`${projectId}:${integration}:${key}`);
  }
  save(projectId: string, integration: string, key: string, value: string | undefined) {
    const id = `${projectId}:${integration}:${key}`;
    if (value === undefined) this.values.delete(id);
    else this.values.set(id, value);
  }
}

function context(overrides: Partial<IntegrationPluginContext> = {}): IntegrationPluginContext {
  return {
    projectId: "project-1",
    configuration: {
      enabled: true,
      config: {
        organization: "acme",
        project: "checkout",
        environment: "production",
        query: "is:unresolved",
      },
      secretRefs: { token: "secret-ref" },
    },
    secrets: { token: "token-value" },
    checkpoints: new MemoryCheckpoints(),
    onInput: async () => undefined,
    id: () => "input-1",
    now: () => new Date("2026-08-21T00:00:00.000Z"),
    ...overrides,
  };
}

describe("Sentry plugin", () => {
  it("owns its serializable manifest", () => {
    expect(sentryPlugin().manifest).toEqual({
      id: "sentry",
      name: "Sentry",
      icon: "sentry",
      configFields: [
        { key: "organization", type: "string", label: "Organization", required: true },
        { key: "project", type: "string", label: "Project", required: true },
        { key: "environment", type: "string", label: "Environment", required: false },
        { key: "query", type: "string", label: "Query", required: false },
      ],
      secretFields: [{ key: "token", label: "Auth token", required: true }],
    });
    expect(JSON.parse(JSON.stringify(sentryPlugin().manifest))).toEqual(sentryPlugin().manifest);
  });

  it("validates exact config and secret-ref keys", () => {
    const plugin = sentryPlugin();
    expect(() => plugin.validate(context().configuration)).not.toThrow();
    expect(() => plugin.validate({
      ...context().configuration,
      config: { ...context().configuration.config, endpoint: "https://example.test" },
    })).toThrow("SENTRY_CONFIG_UNKNOWN_FIELD:endpoint");
    expect(() => plugin.validate({
      ...context().configuration,
      secretRefs: { token: "secret-ref", password: "other" },
    })).toThrow("SENTRY_SECRET_UNKNOWN_FIELD:password");
  });

  it("constructs a source with config, secret, checkpoints and normalization", async () => {
    const client: SentryIssueClient = {
      listIssues: vi.fn(async () => ({ issues: [{ id: "991122", title: "Checkout failed" }] })),
      listIssueEvents: vi.fn(async () => ({
        events: [{ eventID: "event-1", dateCreated: "2026-08-21T00:00:00.000Z" }],
      })),
    };
    const accepted: IntegrationInput[] = [];
    const plugin = sentryPlugin({ client });
    const source = await plugin.create(context({
      onInput: async (input) => { accepted.push(input); },
    }));

    expect(source).toBeInstanceOf(SentryPoller);
    if (!(source instanceof SentryPoller)) throw new Error("EXPECTED_SENTRY_POLLER");
    await source.pollOnce();

    expect(client.listIssues).toHaveBeenCalledWith({
      organization: "acme",
      project: "checkout",
      environment: "production",
      query: "is:unresolved",
    }, "token-value", undefined);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ integration: "sentry", inputKey: "event-1" });
  });

  it("returns only stable public errors and never secret bytes", () => {
    const plugin = sentryPlugin();
    expect(plugin.publicError(new Error("SENTRY_CONFIG_ORGANIZATION_REQUIRED")))
      .toBe("SENTRY_CONFIG_ORGANIZATION_REQUIRED");
    expect(plugin.publicError(new Error("token-value exploded")))
      .toBe("INTEGRATION_START_FAILED");
    expect(plugin.publicError(new Error("token-value exploded"))).not.toContain("token-value");
  });
});
