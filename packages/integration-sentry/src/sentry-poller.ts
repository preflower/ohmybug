import type {
  IntegrationCheckpointStore,
  IntegrationInput,
} from "@oh-my-bug/core";

import type { SentryIntegrationAdapter } from "./sentry-adapter.js";
import type { SentryConfig, SentryEventPage, SentryPage } from "./sentry-client.js";

const MAX_EVENT_PAGES_PER_ISSUE = 20;

export type IntegrationState = "stopped" | "connecting" | "connected" | "backoff";
export interface IntegrationHealth {
  state: IntegrationState;
  lastSuccessAt?: string;
  lastError?: string;
  nextRetryAt?: string;
}

export interface SentryIssueClient {
  listIssues(config: SentryConfig, token: string, cursor?: string): Promise<SentryPage>;
  listIssueEvents(
    config: SentryConfig,
    token: string,
    issueId: string,
    cursor?: string,
  ): Promise<SentryEventPage>;
}

export interface SentryPollerOptions {
  projectId: string;
  config: SentryConfig;
  token: string;
  client: SentryIssueClient;
  adapter: SentryIntegrationAdapter;
  checkpoints: IntegrationCheckpointStore;
  onInput(input: IntegrationInput): Promise<void>;
  intervalMs?: number;
  jitter?: () => number;
  now?: () => Date;
}

export class SentryPoller {
  private status: IntegrationHealth = { state: "stopped" };
  private failures = 0;

  constructor(private readonly options: SentryPollerOptions) {}

  async pollOnce(): Promise<void> {
    const cursor = this.options.checkpoints.get(this.options.projectId, "sentry", "cursor");
    try {
      const page = await this.options.client.listIssues(
        this.options.config,
        this.options.token,
        cursor,
      );
      let issueError: unknown;
      for (const payload of page.issues) {
        try {
          await this.pollIssue(payload);
        } catch (error) {
          issueError ??= error;
        }
      }
      if (issueError !== undefined) throw issueError;
      if (page.nextCursor !== cursor) {
        this.options.checkpoints.save(
          this.options.projectId,
          "sentry",
          "cursor",
          page.nextCursor,
        );
      }
      this.failures = 0;
      this.status = { state: "connected", lastSuccessAt: this.now().toISOString() };
    } catch (error) {
      this.failures += 1;
      const retryMs = this.backoffMs();
      this.status = {
        state: "backoff",
        lastError: redactError(error, this.options.token),
        nextRetryAt: new Date(this.now().getTime() + retryMs).toISOString(),
      };
      throw error;
    }
  }

  async start(signal: AbortSignal): Promise<void> {
    this.status = { state: "connecting" };
    while (!signal.aborted) {
      try {
        await this.pollOnce();
      } catch {
        // The health snapshot owns diagnostics; the loop owns retry timing.
      }
      await wait(this.failures ? this.backoffMs() : (this.options.intervalMs ?? 60_000), signal);
    }
    this.status = { ...this.status, state: "stopped", nextRetryAt: undefined };
  }

  health(): Readonly<IntegrationHealth> {
    return Object.freeze({ ...this.status });
  }

  private backoffMs(): number {
    const base = Math.min(60_000, 1_000 * 2 ** Math.max(0, this.failures - 1));
    return Math.round(base * (1 + (this.options.jitter?.() ?? Math.random()) * 0.2));
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async pollIssue(issue: Record<string, unknown>): Promise<void> {
    const issueId = requiredString(issue.id, "SENTRY_ISSUE_ID_REQUIRED");
    const checkpointKey = `event-watermark:${issueId}`;
    const watermark = this.options.checkpoints.get(
      this.options.projectId,
      "sentry",
      checkpointKey,
    );
    const batch = await this.collectEvents(issueId, watermark);
    const inputs: IntegrationInput[] = [];
    for (const event of [...batch.events].reverse()) {
      inputs.push(await this.options.adapter.adapt({ issue, event }));
    }
    for (const input of inputs) await this.options.onInput(input);
    if (batch.newestEventId !== undefined && batch.newestEventId !== watermark) {
      this.options.checkpoints.save(
        this.options.projectId,
        "sentry",
        checkpointKey,
        batch.newestEventId,
      );
    }
  }

  private async collectEvents(
    issueId: string,
    watermark: string | undefined,
  ): Promise<{ events: Array<Record<string, unknown>>; newestEventId?: string }> {
    const events: Array<Record<string, unknown>> = [];
    const eventIds = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let newestEventId: string | undefined;

    for (let pageNumber = 0; pageNumber < MAX_EVENT_PAGES_PER_ISSUE; pageNumber += 1) {
      const page = await this.options.client.listIssueEvents(
        this.options.config,
        this.options.token,
        issueId,
        cursor,
      );
      for (const event of page.events) {
        const eventId = requiredString(event.eventID, "SENTRY_EVENT_ID_REQUIRED");
        newestEventId ??= eventId;
        if (watermark === undefined) return { events: [event], newestEventId };
        if (eventId === watermark) return { events, newestEventId };
        if (!eventIds.has(eventId)) {
          eventIds.add(eventId);
          events.push(event);
        }
      }

      if (page.nextCursor === undefined) {
        if (watermark !== undefined) throw new Error("SENTRY_EVENT_WATERMARK_NOT_FOUND");
        return { events: [], newestEventId };
      }
      if (cursors.has(page.nextCursor)) throw new Error("SENTRY_EVENT_PAGE_LOOP");
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    throw new Error("SENTRY_EVENT_WATERMARK_NOT_FOUND");
  }
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function redactError(error: unknown, secret: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return secret ? message.split(secret).join("[REDACTED]") : message;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
