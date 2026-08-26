export interface SentryConfig {
  organization: string;
  project: string;
  environment?: string;
  query?: string;
}

export interface SentryPage {
  issues: Array<Record<string, unknown>>;
  nextCursor?: string;
}

export interface SentryEventPage {
  events: Array<Record<string, unknown>>;
  nextCursor?: string;
}

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class SentryClient {
  constructor(private readonly fetcher: Fetcher = fetch) {}

  async listIssues(config: SentryConfig, token: string, cursor?: string): Promise<SentryPage> {
    const url = issueListUrl(config);
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await this.fetcher(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`SENTRY_HTTP_${response.status}`);
    const issues = await records(response);
    return { issues, nextCursor: nextCursor(response.headers.get("link")) };
  }

  async testConnection(config: SentryConfig, token: string): Promise<void> {
    const url = issueListUrl(config);
    url.searchParams.set("limit", "1");
    const response = await this.fetcher(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`SENTRY_HTTP_${response.status}`);
    await records(response);
  }

  async listIssueEvents(
    config: SentryConfig,
    token: string,
    issueId: string,
    cursor?: string,
  ): Promise<SentryEventPage> {
    const url = new URL(
      `/api/0/organizations/${encodeURIComponent(config.organization)}` +
        `/issues/${encodeURIComponent(issueId)}/events/`,
      "https://sentry.io",
    );
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await this.fetcher(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`SENTRY_HTTP_${response.status}`);
    const events = await records(response);
    return { events, nextCursor: nextCursor(response.headers.get("link")) };
  }
}

function issueListUrl(config: SentryConfig): URL {
  const url = new URL(
    `/api/0/organizations/${encodeURIComponent(config.organization)}/issues/`,
    "https://sentry.io",
  );
  url.searchParams.set("project", config.project);
  if (config.environment) url.searchParams.set("environment", config.environment);
  if (config.query) url.searchParams.set("query", config.query);
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function records(response: Response): Promise<Array<Record<string, unknown>>> {
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || payload.some((entry) => !isRecord(entry))) {
    throw new Error("SENTRY_RESPONSE_INVALID");
  }
  return payload;
}

function nextCursor(link: string | null): string | undefined {
  if (!link) return undefined;
  for (const entry of splitHeader(link, ",")) {
    const targetEnd = entry.indexOf(">");
    if (!entry.trimStart().startsWith("<") || targetEnd < 0) continue;
    const parameters = linkParameters(entry.slice(targetEnd + 1));
    const relations = parameters.get("rel")?.split(/\s+/) ?? [];
    if (!relations.includes("next") || parameters.get("results")?.toLowerCase() !== "true") {
      continue;
    }
    try {
      const target = entry.slice(entry.indexOf("<") + 1, targetEnd);
      const cursor = new URL(target, "https://sentry.io").searchParams.get("cursor");
      if (cursor) return cursor;
    } catch {
      // A results-bearing next link must be usable or pagination would silently stop.
    }
    throw new Error("SENTRY_PAGINATION_INVALID");
  }
  return undefined;
}

function linkParameters(value: string): Map<string, string> {
  const parameters = new Map<string, string>();
  for (const part of splitHeader(value, ";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim().toLowerCase();
    const rawValue = part.slice(separator + 1).trim();
    if (!key || !rawValue) continue;
    parameters.set(key, unquote(rawValue));
  }
  return parameters;
}

function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  return value.slice(1, -1).replace(/\\(.)/g, "$1");
}

function splitHeader(value: string, separator: "," | ";"): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let inTarget = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === "<") inTarget = true;
    if (!quoted && character === ">") inTarget = false;
    if (!quoted && !inTarget && character === separator) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}
