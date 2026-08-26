import { randomUUID } from "node:crypto";

import {
  integrationInputSchema,
  type IntegrationAdapter,
  type IntegrationInput,
} from "@oh-my-bug/core";

export type DingTalkRawData = Record<string, unknown>;

export interface DingTalkAdapterOptions {
  conversationFilterEnabled: boolean;
  conversationIds: string[];
  messageRule?: string;
  threadKeyField?: string;
  secretValues?: string[];
  id?: () => string;
  now?: () => Date;
}

export class DingTalkIntegrationAdapter
implements IntegrationAdapter<DingTalkRawData> {
  readonly name = "dingtalk";
  private readonly id: () => string;
  private readonly now: () => Date;

  constructor(private readonly options: DingTalkAdapterOptions) {
    this.id = options.id ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async adapt(rawData: DingTalkRawData): Promise<IntegrationInput<DingTalkRawData>> {
    const conversationId = requiredString(rawData.conversationId, "DINGTALK_CONVERSATION_ID_REQUIRED");
    if (
      this.options.conversationFilterEnabled
      && !this.options.conversationIds.includes(conversationId)
    ) {
      throw new Error("DINGTALK_CONVERSATION_NOT_ALLOWED");
    }
    const messageId = requiredString(rawData.msgId, "DINGTALK_MESSAGE_ID_REQUIRED");
    const text = rawData.text && typeof rawData.text === "object" && !Array.isArray(rawData.text)
      ? stringValue((rawData.text as Record<string, unknown>).content)
      : undefined;
    if (rawData.isInAtList !== true || !text) {
      throw new Error("DINGTALK_MENTION_REQUIRED");
    }
    if (this.options.messageRule && !includesIgnoreCase(text, this.options.messageRule)) {
      throw new Error("DINGTALK_MESSAGE_RULE_REJECTED");
    }
    const content = removeLeadingMention(text);
    if (!content) throw new Error("DINGTALK_CONTENT_REQUIRED");
    const occurredAt = typeof rawData.createAt === "number" && Number.isFinite(rawData.createAt)
      ? new Date(rawData.createAt).toISOString()
      : this.now().toISOString();
    const threadKey = this.options.threadKeyField
      ? stringValue(rawData[this.options.threadKeyField])
      : undefined;

    return integrationInputSchema.parse({
      id: this.id(),
      integration: this.name,
      inputKey: messageId,
      ...(threadKey ? { groupKey: threadKey } : {}),
      rawData: redactRecord(rawData, this.options.secretValues ?? []),
      data: { content, occurredAt },
      receivedAt: this.now().toISOString(),
    }) as IntegrationInput<DingTalkRawData>;
  }
}

function requiredString(value: unknown, code: string): string {
  const parsed = stringValue(value);
  if (!parsed) throw new Error(code);
  return parsed;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function includesIgnoreCase(value: string, search: string): boolean {
  return Boolean(search) && value.toLocaleLowerCase().includes(search.toLocaleLowerCase());
}

function removeLeadingMention(value: string): string {
  return value.replace(/^\s*@[^\s]+\s*/u, "").trim();
}

function redactRecord(value: Record<string, unknown>, secrets: string[]): Record<string, unknown> {
  return redactValue(value, secrets, 0) as Record<string, unknown>;
}

function redactValue(value: unknown, secrets: string[], depth: number): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") {
    let redacted = value.slice(0, 8_192)
      .replace(/([?&]access_token=)[^&"\\]+/gi, "$1[REDACTED]")
      .replace(/Authorization:\s*Bearer\s+[^\s"']+/gi, "Authorization: Bearer [REDACTED]");
    for (const secret of secrets.filter(Boolean)) redacted = redacted.split(secret).join("[REDACTED]");
    return redacted;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, secrets, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [
    key,
    /authorization|token|secret|password|webhook/i.test(key)
      ? "[REDACTED]"
      : redactValue(item, secrets, depth + 1),
  ]));
}
