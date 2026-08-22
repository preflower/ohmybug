import { randomUUID } from "node:crypto";

import {
  integrationInputSchema,
  type IntegrationAdapter,
  type IntegrationInput,
} from "@oh-my-bug/core";

export interface SentryRawData {
  [key: string]: unknown;
  issue: Record<string, unknown>;
  event: Record<string, unknown>;
}

export interface SentryAdapterOptions {
  id?: () => string;
  now?: () => Date;
  secretValues?: string[];
}

export class SentryIntegrationAdapter
implements IntegrationAdapter<SentryRawData> {
  readonly name = "sentry";
  private readonly id: () => string;
  private readonly now: () => Date;

  constructor(private readonly options: SentryAdapterOptions = {}) {
    this.id = options.id ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async adapt(rawData: SentryRawData): Promise<IntegrationInput<SentryRawData>> {
    const issueId = requiredString(rawData.issue.id, "SENTRY_ISSUE_ID_REQUIRED");
    const eventId = requiredString(rawData.event.eventID, "SENTRY_EVENT_ID_REQUIRED");
    const occurredAt = eventDateTime(rawData.event.dateCreated);
    const redacted = redactRecord(rawData, this.options.secretValues ?? []) as unknown as SentryRawData;
    const title = requiredString(redacted.issue.title, "SENTRY_TITLE_REQUIRED");
    const context = {
      issue: selectedRecord(redacted.issue, [
        "id", "culprit", "permalink", "project", "metadata",
      ]),
      occurrence: selectedRecord(redacted.event, [
        "eventID", "title", "message", "culprit", "location", "platform", "tags",
        "user", "contexts", "metadata", "projectID", "groupID", "event.type",
      ]),
    };
    const details = uniqueStrings([
      title,
      `Occurred at: ${occurredAt}`,
      stringValue(redacted.event.title),
      stringValue(redacted.event.message),
      stringValue(redacted.event.culprit),
      stringValue(redacted.event.location),
      metadataDetail(redacted.event.metadata),
      stringValue(redacted.issue.culprit),
      metadataDetail(redacted.issue.metadata),
      stringValue(redacted.issue.permalink),
    ]);

    return integrationInputSchema.parse({
      id: this.id(),
      integration: this.name,
      inputKey: eventId,
      groupKey: issueId,
      rawData: redacted,
      data: {
        content: details.join("\n"),
        summary: title,
        occurredAt,
        context,
      },
      receivedAt: this.now().toISOString(),
    }) as IntegrationInput<SentryRawData>;
  }
}

function metadataDetail(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const metadata = value as Record<string, unknown>;
  return [metadata.type, metadata.value, metadata.filename, metadata.function]
    .map(stringValue)
    .filter(Boolean)
    .join(": ") || undefined;
}

function eventDateTime(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("SENTRY_EVENT_TIMESTAMP_INVALID");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("SENTRY_EVENT_TIMESTAMP_INVALID");
  return date.toISOString();
}

function selectedRecord(
  value: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(keys
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, value[key]]));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function requiredString(value: unknown, code: string): string {
  const parsed = stringValue(value);
  if (!parsed) throw new Error(code);
  return parsed;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function redactRecord(value: Record<string, unknown>, secrets: string[]): Record<string, unknown> {
  return redactValue(value, secrets, 0) as Record<string, unknown>;
}

function redactValue(value: unknown, secrets: string[], depth: number): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return redactString(value.slice(0, 8_192), secrets);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, secrets, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [
    key,
    /authorization|token|secret|password/i.test(key)
      ? "[REDACTED]"
      : redactValue(item, secrets, depth + 1),
  ]));
}

function redactString(value: string, secrets: string[]): string {
  let redacted = value
    .replace(/Authorization:\s*Bearer\s+[^\s"']+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/([?&]access_token=)[^&"\\]+/gi, "$1[REDACTED]");
  for (const secret of secrets.filter(Boolean)) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted;
}
