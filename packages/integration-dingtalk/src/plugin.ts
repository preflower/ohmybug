import type {
  IntegrationPlugin,
  IntegrationPluginContext,
  IntegrationPluginManifest,
  ProjectIntegrationConfiguration,
} from "@oh-my-bug/core";

import { DingTalkIntegrationAdapter } from "./dingtalk-adapter.js";
import {
  OfficialDingTalkClientFactory,
  type DingTalkClientFactory,
} from "./dingtalk-client.js";
import { DingTalkStream } from "./dingtalk-stream.js";

export interface DingTalkPluginOptions {
  clientFactory?: DingTalkClientFactory;
  baseRetryMs?: number;
  jitter?(delayMs: number): number;
  wait?(delayMs: number, signal: AbortSignal): Promise<void>;
}

const manifest = {
  id: "dingtalk",
  name: "DingTalk",
  description: "从指定群聊接收消息并创建 Issue。",
  sections: [
    {
      id: "credentials",
      label: "应用凭证",
      description: "凭证仅保存在这台电脑的系统钥匙串中。",
    },
    { id: "rules", label: "接收规则" },
    {
      id: "advanced",
      label: "高级设置",
      description: "关键词过滤与消息归并",
      collapsed: true,
    },
  ],
  configFields: [
    {
      key: "conversationIds",
      type: "string[]",
      label: "群聊 ID",
      description: "仅处理来自这些群聊且 @ 机器人的消息。",
      required: true,
      section: "rules",
    },
    {
      key: "messageRule",
      type: "string",
      label: "消息关键词",
      required: false,
      section: "advanced",
    },
    {
      key: "threadKeyField",
      type: "string",
      label: "消息归并字段",
      required: false,
      section: "advanced",
    },
  ],
  secretFields: [
    { key: "clientId", label: "Client ID", required: true, section: "credentials" },
    { key: "clientSecret", label: "Client Secret", required: true, section: "credentials" },
  ],
} as const satisfies IntegrationPluginManifest;

export function dingTalkPlugin(options: DingTalkPluginOptions = {}): IntegrationPlugin {
  return {
    manifest,
    validate: validateDingTalkConfiguration,
    async create(context) {
      validateDingTalkConfiguration(context.configuration);
      if (!context.configuration.enabled) throw new Error("INTEGRATION_DISABLED");
      const clientId = requiredSecret(context, "clientId", "DINGTALK_SECRET_CLIENT_ID_REQUIRED");
      const clientSecret = requiredSecret(
        context,
        "clientSecret",
        "DINGTALK_SECRET_CLIENT_SECRET_REQUIRED",
      );
      const config = dingTalkConfig(context.configuration);
      const client = (options.clientFactory ?? new OfficialDingTalkClientFactory())
        .create(clientId, clientSecret);
      return new DingTalkStream({
        client,
        adapter: new DingTalkIntegrationAdapter({
          ...config,
          id: context.id,
          now: context.now,
          secretValues: [clientId, clientSecret],
        }),
        onInput: context.onInput,
        now: context.now,
        secretValues: [clientId, clientSecret],
        baseRetryMs: options.baseRetryMs,
        jitter: options.jitter,
        wait: options.wait,
      });
    },
    publicError: publicDingTalkError,
  };
}

function validateDingTalkConfiguration(configuration: ProjectIntegrationConfiguration): void {
  assertAllowed(Object.keys(configuration.config), [
    "conversationIds", "mention", "messageRule", "threadKeyField",
  ], "DINGTALK_CONFIG_UNKNOWN_FIELD");
  assertAllowed(
    Object.keys(configuration.secretRefs),
    ["clientId", "clientSecret"],
    "DINGTALK_SECRET_UNKNOWN_FIELD",
  );
  if (!configuration.enabled) return;
  dingTalkConfig(configuration);
  requiredString(configuration.secretRefs.clientId, "DINGTALK_SECRET_CLIENT_ID_REQUIRED");
  requiredString(
    configuration.secretRefs.clientSecret,
    "DINGTALK_SECRET_CLIENT_SECRET_REQUIRED",
  );
}

function dingTalkConfig(configuration: ProjectIntegrationConfiguration): {
  conversationIds: string[];
  messageRule?: string;
  threadKeyField?: string;
} {
  const rawIds = configuration.config.conversationIds;
  if (!Array.isArray(rawIds)) throw new Error("DINGTALK_CONFIG_CONVERSATION_IDS_INVALID");
  const conversationIds = rawIds.map((value) => value.trim());
  if (
    conversationIds.length === 0 ||
    conversationIds.some((value) => !value) ||
    new Set(conversationIds).size !== conversationIds.length
  ) {
    throw new Error("DINGTALK_CONFIG_CONVERSATION_IDS_INVALID");
  }
  const messageRule = optionalString(
    configuration.config.messageRule,
    "DINGTALK_CONFIG_MESSAGE_RULE_INVALID",
  );
  const threadKeyField = optionalString(
    configuration.config.threadKeyField,
    "DINGTALK_CONFIG_THREAD_KEY_FIELD_INVALID",
  );
  return {
    conversationIds,
    ...(messageRule ? { messageRule } : {}),
    ...(threadKeyField ? { threadKeyField } : {}),
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

function publicDingTalkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^DINGTALK_(CONFIG|SECRET)_[A-Z_]+(?::[a-zA-Z0-9]+)?$/.test(message)
    ? message
    : "INTEGRATION_START_FAILED";
}
