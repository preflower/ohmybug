import type {
  IntegrationCheckpointStore,
  IntegrationInput,
  IntegrationPluginContext,
} from "@oh-my-bug/core";
import { describe, expect, it, vi } from "vitest";

import { sentryPlugin, type SentryPluginClient } from "../src/plugin.js";
import { SentryPoller } from "../src/sentry-poller.js";

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
      description: "从指定 Sentry 项目接收 Issue 和事件。",
      sections: [
        {
          id: "connection",
          label: "连接配置",
          description: "用于定位项目并读取事件。",
        },
        {
          id: "validation",
          label: "连接验证",
          description: "仅使用已保存的配置和凭证。",
          connectionTest: true,
        },
        {
          id: "filters",
          label: "过滤规则",
          description: "限制进入 Oh My Bug 的 Sentry Issue。",
          summary: {
            fields: [
              { key: "environment", emptyValue: "全部环境" },
              { key: "query", emptyValue: "未解决 Issue", valuePrefix: "Query: " },
            ],
            separator: " · ",
          },
          collapsed: true,
        },
      ],
      configFields: [
        {
          key: "organization",
          type: "string",
          label: "Organization",
          description: "Sentry Organization ID 或 slug。",
          placeholder: "acme",
          required: true,
          section: "connection",
        },
        {
          key: "project",
          type: "string",
          label: "Project",
          description: "Sentry Project ID 或 slug。",
          placeholder: "checkout",
          required: true,
          section: "connection",
        },
        {
          key: "environment",
          type: "string",
          label: "Environment",
          placeholder: "production",
          required: false,
          section: "filters",
        },
        {
          key: "query",
          type: "string",
          label: "Query",
          description: "留空时使用 Sentry 默认查询 is:unresolved。",
          placeholder: "is:unresolved level:error",
          required: false,
          section: "filters",
        },
      ],
      secretFields: [
        {
          key: "token",
          label: "Auth token",
          description: "需要 event:read 权限；请勿填写 DSN。",
          placeholder: "sntrys_…",
          required: true,
          section: "connection",
        },
      ],
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
    const client: SentryPluginClient = {
      listIssues: vi.fn(async () => ({ issues: [{ id: "991122", title: "Checkout failed" }] })),
      listIssueEvents: vi.fn(async () => ({
        events: [{ eventID: "event-1", dateCreated: "2026-08-21T00:00:00.000Z" }],
      })),
      testConnection: vi.fn(async () => undefined),
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

  it("tests a disabled saved configuration and returns only public identifiers", async () => {
    const client = {
      listIssues: vi.fn(async () => ({ issues: [] })),
      listIssueEvents: vi.fn(async () => ({ events: [] })),
      testConnection: vi.fn(async () => undefined),
    };
    const plugin = sentryPlugin({ client });
    const testContext = context({
      configuration: { ...context().configuration, enabled: false },
    });

    await expect(plugin.testConnection?.({
      projectId: testContext.projectId,
      configuration: testContext.configuration,
      secrets: testContext.secrets,
      now: testContext.now,
    })).resolves.toEqual({
      title: "连接成功",
      details: [
        { label: "Organization", value: "acme" },
        { label: "Project", value: "checkout" },
      ],
      testedAt: "2026-08-21T00:00:00.000Z",
    });
    expect(client.testConnection).toHaveBeenCalledWith({
      organization: "acme",
      project: "checkout",
      environment: "production",
      query: "is:unresolved",
    }, "token-value");
  });

  it.each([
    [400, "SENTRY_CONNECTION_FILTER_INVALID"],
    [401, "SENTRY_CONNECTION_TOKEN_INVALID"],
    [403, "SENTRY_CONNECTION_PERMISSION_DENIED"],
    [404, "SENTRY_CONNECTION_RESOURCE_NOT_FOUND"],
    [500, "SENTRY_CONNECTION_FAILED"],
  ])("maps HTTP %s to %s without secret bytes", async (status, expected) => {
    const plugin = sentryPlugin({
      client: {
        listIssues: vi.fn(async () => ({ issues: [] })),
        listIssueEvents: vi.fn(async () => ({ events: [] })),
        testConnection: vi.fn(async () => { throw new Error(`SENTRY_HTTP_${status}`); }),
      },
    });
    await expect(plugin.testConnection?.({
      projectId: "project-1",
      configuration: context().configuration,
      secrets: { token: "token-value" },
      now: context().now,
    })).rejects.toThrow(expected);
    expect(plugin.publicError(new Error(expected))).toBe(expected);
    expect(plugin.publicError(new Error(expected))).not.toContain("token-value");
  });

  it("maps fetch failures to a stable network error", async () => {
    const plugin = sentryPlugin({
      client: {
        listIssues: vi.fn(async () => ({ issues: [] })),
        listIssueEvents: vi.fn(async () => ({ events: [] })),
        testConnection: vi.fn(async () => { throw new TypeError("token-value failed"); }),
      },
    });

    await expect(plugin.testConnection?.({
      projectId: "project-1",
      configuration: context().configuration,
      secrets: { token: "token-value" },
      now: context().now,
    })).rejects.toThrow("SENTRY_CONNECTION_NETWORK");
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
