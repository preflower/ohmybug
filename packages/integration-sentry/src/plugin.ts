import type {
  IntegrationPlugin,
  IntegrationPluginContext,
  IntegrationPluginManifest,
  ProjectIntegrationConfiguration,
} from "@oh-my-bug/core";

import { SentryIntegrationAdapter } from "./sentry-adapter.js";
import { SentryClient, type SentryConfig } from "./sentry-client.js";
import { SentryPoller, type SentryIssueClient } from "./sentry-poller.js";

export interface SentryPluginOptions {
  client?: SentryIssueClient;
  intervalMs?: number;
  jitter?: () => number;
}

const manifest = {
  id: "sentry",
  name: "Sentry",
  configFields: [
    { key: "organization", type: "string", label: "Organization", required: true },
    { key: "project", type: "string", label: "Project", required: true },
    { key: "environment", type: "string", label: "Environment", required: false },
    { key: "query", type: "string", label: "Query", required: false },
  ],
  secretFields: [{ key: "token", label: "Auth token", required: true }],
} as const satisfies IntegrationPluginManifest;

export function sentryPlugin(options: SentryPluginOptions = {}): IntegrationPlugin {
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
        client: options.client ?? new SentryClient(),
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
  context: IntegrationPluginContext,
  key: string,
  code: string,
): string {
  return requiredString(context.secrets[key], code);
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
  return /^SENTRY_(CONFIG|SECRET)_[A-Z_]+(?::[a-zA-Z0-9]+)?$/.test(message)
    ? message
    : "INTEGRATION_START_FAILED";
}
