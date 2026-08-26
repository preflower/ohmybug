import type {
  IntegrationPlugin,
  IntegrationPluginContext,
  IntegrationPluginManifest,
  ProjectIntegrationConfiguration,
} from "@oh-my-bug/core";

import { SentryIntegrationAdapter } from "./sentry-adapter.js";
import { SentryClient, type SentryConfig } from "./sentry-client.js";
import { SentryPoller, type SentryIssueClient } from "./sentry-poller.js";

export interface SentryPluginClient extends SentryIssueClient {
  testConnection(config: SentryConfig, token: string): Promise<void>;
}

export interface SentryPluginOptions {
  client?: SentryPluginClient;
  intervalMs?: number;
  jitter?: () => number;
}

const manifest = {
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
} as const satisfies IntegrationPluginManifest;

export function sentryPlugin(options: SentryPluginOptions = {}): IntegrationPlugin {
  const client = options.client ?? new SentryClient();
  return {
    manifest,
    validate: validateSentryConfiguration,
    async create(context) {
      validateSentryConfiguration(context.configuration);
      if (!context.configuration.enabled) throw new Error("INTEGRATION_DISABLED");
      const token = requiredSecret(context, "token", "SENTRY_SECRET_TOKEN_REQUIRED");
      const config = sentryConfig(context.configuration);
      return new SentryPoller({
        projectId: context.projectId,
        config,
        token,
        client,
        adapter: new SentryIntegrationAdapter({
          id: context.id,
          now: context.now,
          secretValues: [token],
        }),
        checkpoints: context.checkpoints,
        onInput: context.onInput,
        intervalMs: options.intervalMs,
        jitter: options.jitter,
        now: context.now,
      });
    },
    async testConnection(context) {
      const config = sentryConfig(context.configuration);
      const token = requiredSecret(context, "token", "SENTRY_SECRET_TOKEN_REQUIRED");
      try {
        await client.testConnection(config, token);
      } catch (error) {
        throw new Error(sentryConnectionError(error));
      }
      return {
        title: "连接成功",
        details: [
          { label: "Organization", value: config.organization },
          { label: "Project", value: config.project },
        ],
        testedAt: context.now().toISOString(),
      };
    },
    publicError: publicSentryError,
  };
}

function validateSentryConfiguration(configuration: ProjectIntegrationConfiguration): void {
  assertAllowed(Object.keys(configuration.config), [
    "organization", "project", "environment", "query",
  ], "SENTRY_CONFIG_UNKNOWN_FIELD");
  assertAllowed(Object.keys(configuration.secretRefs), ["token"], "SENTRY_SECRET_UNKNOWN_FIELD");
  if (!configuration.enabled) return;
  sentryConfig(configuration);
  requiredString(configuration.secretRefs.token, "SENTRY_SECRET_TOKEN_REQUIRED");
}

function sentryConfig(configuration: ProjectIntegrationConfiguration): SentryConfig {
  const organization = requiredString(
    configuration.config.organization,
    "SENTRY_CONFIG_ORGANIZATION_REQUIRED",
  );
  const project = requiredString(configuration.config.project, "SENTRY_CONFIG_PROJECT_REQUIRED");
  const environment = optionalString(
    configuration.config.environment,
    "SENTRY_CONFIG_ENVIRONMENT_INVALID",
  );
  const query = optionalString(configuration.config.query, "SENTRY_CONFIG_QUERY_INVALID");
  return {
    organization,
    project,
    ...(environment ? { environment } : {}),
    ...(query ? { query } : {}),
  };
}

function requiredSecret(
  context: Pick<IntegrationPluginContext, "secrets">,
  key: string,
  code: string,
): string {
  return requiredString(context.secrets[key], code);
}

function sentryConnectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "SENTRY_HTTP_400") return "SENTRY_CONNECTION_FILTER_INVALID";
  if (message === "SENTRY_HTTP_401") return "SENTRY_CONNECTION_TOKEN_INVALID";
  if (message === "SENTRY_HTTP_403") return "SENTRY_CONNECTION_PERMISSION_DENIED";
  if (message === "SENTRY_HTTP_404") return "SENTRY_CONNECTION_RESOURCE_NOT_FOUND";
  if (error instanceof TypeError) return "SENTRY_CONNECTION_NETWORK";
  return "SENTRY_CONNECTION_FAILED";
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function optionalString(value: unknown, code: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, code);
}

function assertAllowed(values: string[], allowed: string[], code: string): void {
  const unknown = values.find((value) => !allowed.includes(value));
  if (unknown) throw new Error(`${code}:${unknown}`);
}

function publicSentryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^SENTRY_(CONFIG|SECRET|CONNECTION)_[A-Z_]+(?::[a-zA-Z0-9]+)?$/.test(message)
    ? message
    : "INTEGRATION_START_FAILED";
}
