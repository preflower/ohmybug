# Sentry Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Sentry project settings page around required connection fields, collapsed optional filters, and a secret-safe test of the persisted Sentry configuration.

**Architecture:** Extend the existing Integration manifest and plugin contract with a generic connection-test section and a strict public result. Runtime owns persisted project and Keychain lookup through one `testSavedIntegration` operation; the renderer receives only public result fields and renders a reusable Integration test component. Sentry remains responsible for its HTTP request and stable error mapping.

**Tech Stack:** TypeScript 6, React 19, Zod 4, Vitest 4, Testing Library, Electron typed preload bridge, Sentry REST API, project semantic CSS tokens.

---

## File map

- `packages/core/src/integration/plugin.ts`: manifest presentation schema, connection-test result schema, and plugin test context.
- `packages/core/test/integration/plugin.test.ts`: serialization and rejection cases for summaries and connection-test sections.
- `apps/runtime/src/integrations/registry.ts`: registration-time consistency between Manifest and plugin implementation.
- `apps/runtime/test/integration-registry.test.ts`: mismatched capability rejection.
- `packages/integration-sentry/src/sentry-client.ts`: read-only `limit=1` access probe.
- `packages/integration-sentry/src/plugin.ts`: grouped Sentry Manifest, connection test, and stable public errors.
- `packages/integration-sentry/test/sentry-client.test.ts`: request and response behavior.
- `packages/integration-sentry/test/plugin.test.ts`: public result, disabled Integration support, and redaction.
- `apps/runtime/src/protocol/schema-definitions.ts`: strict operation input/output schemas.
- `apps/runtime/src/protocol/types.ts`: Runtime API input/output types.
- `apps/runtime/src/protocol/operations.ts`: renderer-callable `testSavedIntegration` operation.
- `apps/runtime/src/service.ts`: persisted configuration and Keychain lookup.
- `apps/runtime/test/protocol/operations.test.ts`: protocol schema coverage.
- `apps/runtime/test/protocol/service.test.ts`: persisted-only data flow and non-mutation coverage.
- `apps/desktop/src/electron/desktop-api.ts`: named preload method.
- `apps/desktop/src/web/api/types.ts`: renderer result alias.
- `apps/desktop/src/web/api/transport.ts`: product transport method.
- `apps/desktop/src/web/api/desktop-transport.ts`: bridge mapping.
- `apps/desktop/src/web/api/browser-development-transport.ts`: deterministic local preview result.
- `apps/desktop/src/web/api/client.ts`: unavailable transport entry.
- `apps/desktop/test/electron/desktop-api.test.ts`: frozen named bridge coverage.
- `apps/desktop/test/electron/e2e/security.spec.ts`: packaged renderer bridge allowlist.
- `apps/desktop/test/web/transport.test.ts`: renderer transport mapping.
- `apps/desktop/test/web/browser-development-client.test.ts`: deterministic preview behavior.
- `apps/desktop/src/web/projects/integration-connection-test.tsx`: reusable async test state and public error copy.
- `apps/desktop/src/web/projects/integration-fields.tsx`: Manifest-driven placement and dynamic summary rendering.
- `apps/desktop/src/web/projects/project-form.tsx`: saved project ID and dirty-state wiring.
- `apps/desktop/src/web/app.tsx`: API callback wiring.
- `apps/desktop/src/web/styles/global.css`: dense section, result, responsive, and theme-safe styling.
- `apps/desktop/scripts/dev-browser-snapshot.ts`: valid deterministic Sentry settings for visual QA.
- `apps/desktop/test/web/projects.test.tsx`: UI behavior, late response, summary, and secret-safety coverage.
- `test/e2e/runtime-protocol-fixture.ts`: browser acceptance Manifest and deterministic connection result.
- `test/e2e/projects.spec.ts`: user-facing Sentry configuration acceptance.
- `docs/configuration.md`: required fields, optional defaults, and saved-config test behavior.

### Task 1: Extend the generic Integration contract

**Files:**
- Modify: `packages/core/test/integration/plugin.test.ts`
- Modify: `packages/core/src/integration/plugin.ts`
- Modify: `apps/runtime/test/integration-registry.test.ts`
- Modify: `apps/runtime/src/integrations/registry.ts`

- [ ] **Step 1: Write failing Core schema tests**

Add these cases to `packages/core/test/integration/plugin.test.ts`:

```ts
it("serializes a connection-test section and config-derived summary", () => {
  const manifest: IntegrationPluginManifest = {
    id: "fixture",
    name: "Fixture",
    sections: [
      { id: "connection", label: "Connection" },
      { id: "validation", label: "Validation", connectionTest: true },
      {
        id: "filters",
        label: "Filters",
        collapsed: true,
        summary: {
          fields: [
            { key: "environment", emptyValue: "All environments" },
            { key: "query", emptyValue: "Unresolved issues", valuePrefix: "Query: " },
          ],
          separator: " · ",
        },
      },
    ],
    configFields: [
      { key: "environment", type: "string", label: "Environment", required: false, section: "filters" },
      { key: "query", type: "string", label: "Query", required: false, section: "filters" },
    ],
    secretFields: [{ key: "token", label: "Token", required: true, section: "connection" }],
  };

  expect(integrationPluginManifestSchema.parse(manifest)).toEqual(manifest);
});

it("rejects duplicate connection tests and invalid summary field references", () => {
  const base = {
    id: "fixture",
    name: "Fixture",
    configFields: [{ key: "environment", type: "string", label: "Environment", required: false }],
    secretFields: [{ key: "token", label: "Token", required: true }],
  } as const;

  expect(() => integrationPluginManifestSchema.parse({
    ...base,
    sections: [
      { id: "first", label: "First", connectionTest: true },
      { id: "second", label: "Second", connectionTest: true },
    ],
  })).toThrow(/DUPLICATE_INTEGRATION_CONNECTION_TEST/);
  expect(() => integrationPluginManifestSchema.parse({
    ...base,
    sections: [{
      id: "filters",
      label: "Filters",
      summary: { fields: [{ key: "missing", emptyValue: "Any" }] },
    }],
  })).toThrow(/INTEGRATION_SUMMARY_FIELD_NOT_FOUND/);
  expect(() => integrationPluginManifestSchema.parse({
    ...base,
    sections: [{
      id: "filters",
      label: "Filters",
      summary: { fields: [{ key: "token", emptyValue: "Any" }] },
    }],
  })).toThrow(/INTEGRATION_SUMMARY_SECRET_FORBIDDEN/);
});

it("validates strict public connection-test results", () => {
  const result = {
    title: "Connected",
    details: [{ label: "Project", value: "checkout" }],
    testedAt: "2026-08-26T02:00:00.000Z",
  };
  expect(integrationConnectionTestResultSchema.parse(result)).toEqual(result);
  expect(() => integrationConnectionTestResultSchema.parse({ ...result, token: "secret" })).toThrow();
  expect(() => integrationConnectionTestResultSchema.parse({ ...result, testedAt: "today" })).toThrow();
});
```

- [ ] **Step 2: Run the Core test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/core test -- test/integration/plugin.test.ts
```

Expected: FAIL because `connectionTest`, config-derived summaries, and `integrationConnectionTestResultSchema` do not exist.

- [ ] **Step 3: Implement the strict schemas and types**

In `packages/core/src/integration/plugin.ts`, replace the static-only summary schema and extend the section schema:

```ts
const staticIntegrationSummarySchema = z.object({
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
}).strict();

const configIntegrationSummarySchema = z.object({
  fields: z.array(z.object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
    emptyValue: z.string().trim().min(1),
    valuePrefix: z.string().min(1).optional(),
  }).strict()).min(1),
  separator: z.string().min(1).optional(),
}).strict();

export const integrationSectionSchema = z.object({
  id: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  summary: z.union([
    staticIntegrationSummarySchema,
    configIntegrationSummarySchema,
  ]).optional(),
  collapsed: z.boolean().optional(),
  connectionTest: z.boolean().optional(),
}).strict();

export const integrationConnectionTestResultSchema = z.object({
  title: z.string().trim().min(1).max(120),
  details: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(240),
  }).strict()).max(8),
  testedAt: z.iso.datetime(),
}).strict();
```

Extend `integrationPluginManifestSchema.superRefine` after collecting sections:

```ts
const configKeys = new Set(manifest.configFields.map(({ key }) => key));
const secretKeys = new Set(manifest.secretFields.map(({ key }) => key));
let connectionTests = 0;
for (const [index, section] of (manifest.sections ?? []).entries()) {
  if (section.connectionTest) connectionTests += 1;
  if (section.summary && "fields" in section.summary) {
    for (const [fieldIndex, field] of section.summary.fields.entries()) {
      if (secretKeys.has(field.key)) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "summary", "fields", fieldIndex, "key"],
          message: "INTEGRATION_SUMMARY_SECRET_FORBIDDEN",
        });
      } else if (!configKeys.has(field.key)) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "summary", "fields", fieldIndex, "key"],
          message: "INTEGRATION_SUMMARY_FIELD_NOT_FOUND",
        });
      }
    }
  }
}
if (connectionTests > 1) {
  context.addIssue({
    code: "custom",
    path: ["sections"],
    message: "DUPLICATE_INTEGRATION_CONNECTION_TEST",
  });
}
```

Add the public types and optional plugin method:

```ts
export type IntegrationConnectionTestResult = z.infer<
  typeof integrationConnectionTestResultSchema
>;

export interface IntegrationPluginConnectionTestContext {
  projectId: string;
  configuration: ProjectIntegrationConfiguration;
  secrets: Readonly<Record<string, string>>;
  now(): Date;
}

export interface IntegrationPlugin {
  readonly manifest: IntegrationPluginManifest;
  validate(configuration: ProjectIntegrationConfiguration): void;
  create(context: IntegrationPluginContext): Promise<ManagedIntegrationSource>;
  testConnection?(
    context: IntegrationPluginConnectionTestContext,
  ): Promise<IntegrationConnectionTestResult>;
  publicError(error: unknown): string;
}
```

- [ ] **Step 4: Run the Core test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Write failing registry consistency tests**

Add to `apps/runtime/test/integration-registry.test.ts`:

```ts
it("rejects a mismatch between connection-test presentation and implementation", () => {
  const presentationOnly = plugin("presentation-only");
  presentationOnly.manifest.sections = [
    { id: "validation", label: "Validation", connectionTest: true },
  ];
  expect(() => new IntegrationRegistry([presentationOnly]))
    .toThrow("INTEGRATION_CONNECTION_TEST_IMPLEMENTATION_REQUIRED:presentation-only");

  const implementationOnly = {
    ...plugin("implementation-only"),
    testConnection: async () => ({
      title: "Connected",
      details: [],
      testedAt: "2026-08-26T02:00:00.000Z",
    }),
  };
  expect(() => new IntegrationRegistry([implementationOnly]))
    .toThrow("INTEGRATION_CONNECTION_TEST_SECTION_REQUIRED:implementation-only");
});
```

- [ ] **Step 6: Run the registry test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test -- test/integration-registry.test.ts
```

Expected: FAIL because the registry accepts mismatched plugins.

- [ ] **Step 7: Enforce registration-time consistency**

Inside the constructor loop in `apps/runtime/src/integrations/registry.ts`, before adding the entry:

```ts
const connectionTestSections = plugin.manifest.sections
  ?.filter((section) => section.connectionTest).length ?? 0;
if (connectionTestSections === 1 && !plugin.testConnection) {
  throw new Error(`INTEGRATION_CONNECTION_TEST_IMPLEMENTATION_REQUIRED:${id}`);
}
if (connectionTestSections === 0 && plugin.testConnection) {
  throw new Error(`INTEGRATION_CONNECTION_TEST_SECTION_REQUIRED:${id}`);
}
```

- [ ] **Step 8: Run Core and registry tests, then commit**

Run:

```bash
pnpm --filter @oh-my-bug/core test -- test/integration/plugin.test.ts
pnpm --filter @oh-my-bug/runtime test -- test/integration-registry.test.ts
```

Expected: both PASS.

Commit:

```bash
git add packages/core/src/integration/plugin.ts packages/core/test/integration/plugin.test.ts apps/runtime/src/integrations/registry.ts apps/runtime/test/integration-registry.test.ts
git commit -m "feat(integrations): declare saved connection tests"
```

### Task 2: Add the read-only Sentry access probe

**Files:**
- Modify: `packages/integration-sentry/test/sentry-client.test.ts`
- Modify: `packages/integration-sentry/src/sentry-client.ts`
- Modify: `packages/integration-sentry/test/plugin.test.ts`
- Modify: `packages/integration-sentry/src/plugin.ts`

- [ ] **Step 1: Write the failing client probe tests**

Add to `packages/integration-sentry/test/sentry-client.test.ts`:

```ts
it("tests saved access with one read-only issue request", async () => {
  const fetcher = vi.fn(async () => Response.json([]));
  const client = new SentryClient(fetcher);

  await expect(client.testConnection({
    organization: "acme",
    project: "checkout",
    environment: "production",
    query: "level:error",
  }, "sentry-secret")).resolves.toBeUndefined();

  const [request, init] = fetcher.mock.calls[0]!;
  const url = new URL(String(request));
  expect(url.pathname).toBe("/api/0/organizations/acme/issues/");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    environment: "production",
    limit: "1",
    project: "checkout",
    query: "level:error",
  });
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sentry-secret");
  expect(String(request)).not.toContain("sentry-secret");
});

it("rejects malformed successful probe responses", async () => {
  const client = new SentryClient(async () => Response.json({ id: "not-an-array" }));
  await expect(client.testConnection(
    { organization: "acme", project: "checkout" },
    "secret",
  )).rejects.toThrow("SENTRY_RESPONSE_INVALID");
});
```

- [ ] **Step 2: Run the client test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/integration-sentry test -- test/sentry-client.test.ts
```

Expected: FAIL because `SentryClient.testConnection` is missing.

- [ ] **Step 3: Implement the shared issue URL and probe**

In `packages/integration-sentry/src/sentry-client.ts`, extract URL creation and add the method:

```ts
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

async testConnection(config: SentryConfig, token: string): Promise<void> {
  const url = issueListUrl(config);
  url.searchParams.set("limit", "1");
  const response = await this.fetcher(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`SENTRY_HTTP_${response.status}`);
  await records(response);
}
```

Update `listIssues` to start with `const url = issueListUrl(config);`, then append cursor as it does today.

- [ ] **Step 4: Run the client test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Write failing Sentry plugin tests**

In `packages/integration-sentry/test/plugin.test.ts`, extend the fixture client with `testConnection: vi.fn(async () => undefined)` and add:

```ts
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
```

- [ ] **Step 6: Run the plugin test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/integration-sentry test -- test/plugin.test.ts
```

Expected: FAIL because the grouped Manifest and plugin connection test are missing.

- [ ] **Step 7: Implement the grouped Manifest and connection test**

In `packages/integration-sentry/src/plugin.ts`:

1. Define the complete client contract and use it in options:

```ts
export interface SentryPluginClient extends SentryIssueClient {
  testConnection(config: SentryConfig, token: string): Promise<void>;
}

export interface SentryPluginOptions {
  client?: SentryPluginClient;
  intervalMs?: number;
  jitter?: () => number;
}
```

2. Construct `const client = options.client ?? new SentryClient()` once inside `sentryPlugin`.
3. Replace the Manifest with the exact sections, descriptions, placeholders, dynamic filter summary, and field assignments from the approved spec.
4. Add the optional plugin method implementation:

```ts
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
```

Use a context-compatible secret helper:

```ts
function requiredSecret(
  context: Pick<IntegrationPluginContext, "secrets">,
  key: string,
  code: string,
): string {
  return requiredString(context.secrets[key], code);
}
```

Add the stable mapper and permit public connection errors:

```ts
function sentryConnectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "SENTRY_HTTP_400") return "SENTRY_CONNECTION_FILTER_INVALID";
  if (message === "SENTRY_HTTP_401") return "SENTRY_CONNECTION_TOKEN_INVALID";
  if (message === "SENTRY_HTTP_403") return "SENTRY_CONNECTION_PERMISSION_DENIED";
  if (message === "SENTRY_HTTP_404") return "SENTRY_CONNECTION_RESOURCE_NOT_FOUND";
  if (error instanceof TypeError) return "SENTRY_CONNECTION_NETWORK";
  return "SENTRY_CONNECTION_FAILED";
}

function publicSentryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^SENTRY_(CONFIG|SECRET|CONNECTION)_[A-Z_]+(?::[a-zA-Z0-9]+)?$/.test(message)
    ? message
    : "INTEGRATION_START_FAILED";
}
```

- [ ] **Step 8: Run the Sentry package tests and typecheck, then commit**

Run:

```bash
pnpm --filter @oh-my-bug/integration-sentry test
pnpm --filter @oh-my-bug/integration-sentry typecheck
```

Expected: all tests PASS and TypeScript exits 0.

Commit:

```bash
git add packages/integration-sentry/src/sentry-client.ts packages/integration-sentry/src/plugin.ts packages/integration-sentry/test/sentry-client.test.ts packages/integration-sentry/test/plugin.test.ts
git commit -m "feat(sentry): test persisted API access"
```

### Task 3: Add the persisted-only Runtime operation

**Files:**
- Modify: `apps/runtime/test/protocol/operations.test.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/operations.ts`
- Modify: `apps/runtime/test/protocol/service.test.ts`
- Modify: `apps/runtime/src/service.ts`

- [ ] **Step 1: Write the failing protocol schema test**

Add to `apps/runtime/test/protocol/operations.test.ts`:

```ts
it("validates strict saved Integration tests", () => {
  const input = { projectId: "project-1", integrationId: "sentry" };
  const output = {
    title: "连接成功",
    details: [{ label: "Project", value: "checkout" }],
    testedAt: "2026-08-26T02:00:00.000Z",
  };
  expect(runtimeOperations.testSavedIntegration.input.parse(input)).toEqual(input);
  expect(runtimeOperations.testSavedIntegration.output.parse(output)).toEqual(output);
  expect(() => runtimeOperations.testSavedIntegration.input.parse({ ...input, token: "secret" }))
    .toThrow();
  expect(() => runtimeOperations.testSavedIntegration.output.parse({ ...output, token: "secret" }))
    .toThrow();
});
```

Also add `"testSavedIntegration"` to the expected operation-name array at the top of this test file.

- [ ] **Step 2: Run the protocol test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test -- test/protocol/operations.test.ts
```

Expected: FAIL because the operation is not registered.

- [ ] **Step 3: Implement protocol input, output, and dispatch**

In `apps/runtime/src/protocol/schema-definitions.ts`, import `integrationConnectionTestResultSchema` from Core and export:

```ts
export const testSavedIntegrationInputSchema = z.object({
  projectId: identifierSchema,
  integrationId: identifierSchema,
}).strict();
export { integrationConnectionTestResultSchema };
```

In `apps/runtime/src/protocol/types.ts`, import `IntegrationConnectionTestResult` and add:

```ts
testSavedIntegration(input: {
  projectId: string;
  integrationId: string;
}): Promise<IntegrationConnectionTestResult>;
```

In `apps/runtime/src/protocol/operations.ts`, import the two schemas and register after `integrationHealth`:

```ts
testSavedIntegration: operation({
  input: testSavedIntegrationInputSchema,
  output: integrationConnectionTestResultSchema,
  renderer: true,
  invoke: (service, input) => service.testSavedIntegration(input),
}),
```

- [ ] **Step 4: Run the protocol test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Write the failing Runtime service test**

Update `fixturePlugin()` in `apps/runtime/test/protocol/service.test.ts` to declare one `connectionTest: true` section and return only public saved values:

```ts
sections: [{ id: "validation", label: "Validation", connectionTest: true }],
async testConnection(context) {
  return {
    title: "Connected",
    details: [
      { label: "Workspace", value: String(context.configuration.config.workspace) },
      { label: "Token", value: context.secrets.token ? "configured" : "missing" },
    ],
    testedAt: context.now().toISOString(),
  };
},
```

Add this test:

```ts
it("tests only persisted Integration config and Keychain secrets without mutation", async () => {
  const { root, service, store, secrets } = await harness();
  const projectDirectory = join(root, "checkout");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));
  const saved = await service.saveProjectSettings({
    mode: "create",
    project: {
      path: projectDirectory,
      key: "CHK",
      integrations: {
        fixture: { enabled: false, config: { workspace: "saved-workspace" } },
      },
    },
    secretPatches: { fixture: { token: "saved-token", secret: "saved-secret" } },
  });
  const before = store.getProject(saved.id);

  await expect(service.testSavedIntegration({
    projectId: saved.id,
    integrationId: "fixture",
  })).resolves.toEqual({
    title: "Connected",
    details: [
      { label: "Workspace", value: "saved-workspace" },
      { label: "Token", value: "configured" },
    ],
    testedAt: now,
  });
  expect(store.getProject(saved.id)).toEqual(before);
  expect(await secrets.get(`integration-secret:${saved.id}:fixture:token`))
    .toBe("saved-token");
});
```

Add a malicious fixture plugin whose test result includes `context.secrets.token` in a detail value, then assert rejection with `INTEGRATION_CONNECTION_TEST_SECRET_EXPOSURE` and assert the thrown message does not contain `saved-token`. Add a second malicious result with an unknown `token` property and assert `INTEGRATION_CONNECTION_TEST_RESULT_INVALID` without the token bytes.

Add exact rejection assertions:

```ts
await expect(service.testSavedIntegration({
  projectId: "missing",
  integrationId: "fixture",
})).rejects.toThrow("PROJECT_NOT_FOUND");
await expect(service.testSavedIntegration({
  projectId: saved.id,
  integrationId: "missing",
})).rejects.toThrow("PROJECT_INTEGRATION_NOT_FOUND");
await expect(service.testSavedIntegration({
  projectId: saved.id,
  integrationId: "fixture-without-test",
})).rejects.toThrow("INTEGRATION_CONNECTION_TEST_UNSUPPORTED");
for (const error of ["PROJECT_NOT_FOUND", "PROJECT_INTEGRATION_NOT_FOUND", "INTEGRATION_CONNECTION_TEST_UNSUPPORTED"]) {
  expect(error).not.toContain("saved-token");
}
```

Register `fixture-without-test` with no test section and no `testConnection`, and include a disabled saved configuration for it in the project fixture before the unsupported assertion.

- [ ] **Step 6: Run the service test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test -- test/protocol/service.test.ts
```

Expected: FAIL because `RuntimeService.testSavedIntegration` is missing.

- [ ] **Step 7: Implement persisted lookup and safe plugin dispatch**

Add to `apps/runtime/src/service.ts`:

```ts
async testSavedIntegration(input: {
  projectId: string;
  integrationId: string;
}): Promise<IntegrationConnectionTestResult> {
  this.assertAccepting();
  const project = this.requireProject(input.projectId);
  const configuration = project.integrations?.[input.integrationId];
  if (!configuration) throw new Error("PROJECT_INTEGRATION_NOT_FOUND");
  const plugin = this.dependencies.integrationRegistry.require(input.integrationId);
  if (!plugin.testConnection) throw new Error("INTEGRATION_CONNECTION_TEST_UNSUPPORTED");

  const entries: Array<readonly [string, string]> = [];
  for (const field of plugin.manifest.secretFields) {
    const ref = configuration.secretRefs[field.key];
    if (!ref) continue;
    const value = await this.dependencies.secrets.get(ref);
    if (value !== null) entries.push([field.key, value]);
  }
  try {
    const candidate = await plugin.testConnection({
      projectId: project.id,
      configuration: structuredClone(configuration),
      secrets: Object.freeze(Object.fromEntries(entries)),
      now: this.dependencies.now,
    });
    let result: IntegrationConnectionTestResult;
    try {
      result = integrationConnectionTestResultSchema.parse(candidate);
    } catch {
      throw new Error("INTEGRATION_CONNECTION_TEST_RESULT_INVALID");
    }
    const serialized = JSON.stringify(result);
    if (entries.some(([, secret]) => secret.length > 0 && serialized.includes(secret))) {
      throw new Error("INTEGRATION_CONNECTION_TEST_SECRET_EXPOSURE");
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INTEGRATION_CONNECTION_TEST_")) {
      throw error;
    }
    throw new Error(plugin.publicError(error));
  }
}
```

Import `IntegrationConnectionTestResult` and `integrationConnectionTestResultSchema` from Core. Do not call `plugin.validate`, because disabled saved Integrations intentionally skip normal enabled-state validation; the plugin test method validates the fields it needs.

- [ ] **Step 8: Run Runtime tests and typecheck, then commit**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test -- test/protocol/operations.test.ts test/protocol/service.test.ts
pnpm --filter @oh-my-bug/runtime typecheck
```

Expected: tests PASS and TypeScript exits 0.

Commit:

```bash
git add apps/runtime/src/protocol/schema-definitions.ts apps/runtime/src/protocol/types.ts apps/runtime/src/protocol/operations.ts apps/runtime/src/service.ts apps/runtime/test/protocol/operations.test.ts apps/runtime/test/protocol/service.test.ts
git commit -m "feat(runtime): test saved Integration configuration"
```

### Task 4: Carry the operation through the Desktop boundary

**Files:**
- Modify: `apps/desktop/test/electron/desktop-api.test.ts`
- Modify: `apps/desktop/test/electron/e2e/security.spec.ts`
- Modify: `apps/desktop/src/electron/desktop-api.ts`
- Modify: `apps/desktop/test/web/transport.test.ts`
- Modify: `apps/desktop/test/web/browser-development-client.test.ts`
- Modify: `apps/desktop/src/web/api/types.ts`
- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/api/desktop-transport.ts`
- Modify: `apps/desktop/src/web/api/browser-development-transport.ts`
- Modify: `apps/desktop/src/web/api/client.ts`

- [ ] **Step 1: Write failing bridge and transport tests**

In `apps/desktop/test/electron/desktop-api.test.ts` and `apps/desktop/test/electron/e2e/security.spec.ts`, add `testSavedIntegration` to the frozen operation lists. Invoke it in the unit test and assert:

```ts
await api.testSavedIntegration("project-1", "sentry");
expect(ipc.invoke).toHaveBeenCalledWith("oh-my-bug:request", {
  operation: "testSavedIntegration",
  payload: { projectId: "project-1", integrationId: "sentry" },
});
```

In `apps/desktop/test/web/transport.test.ts`, add the bridge mock and assertion:

```ts
testSavedIntegration: vi.fn(async () => ({
  title: "连接成功",
  details: [{ label: "Project", value: "checkout" }],
  testedAt: "2026-08-26T02:00:00.000Z",
})),
```

```ts
await expect(transport.testSavedIntegration("project-1", "sentry"))
  .resolves.toMatchObject({ title: "连接成功" });
expect(bridge.testSavedIntegration).toHaveBeenCalledWith("project-1", "sentry");
```

- [ ] **Step 2: Run bridge and transport tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/electron/desktop-api.test.ts test/web/transport.test.ts
```

Expected: FAIL because neither boundary exposes the method.

- [ ] **Step 3: Add typed preload and renderer transport methods**

In `apps/desktop/src/electron/desktop-api.ts` add:

```ts
testSavedIntegration(
  projectId: string,
  integrationId: string,
): Promise<RuntimeOperationOutput<"testSavedIntegration">>;
```

and in `createDesktopApi`:

```ts
testSavedIntegration: (projectId, integrationId) => request("testSavedIntegration", {
  projectId,
  integrationId,
}),
```

In `apps/desktop/src/web/api/types.ts` export:

```ts
export type IntegrationConnectionTestResult = RuntimeOperationOutput<"testSavedIntegration">;
```

In `ProductTransport` add:

```ts
testSavedIntegration(
  projectId: string,
  integrationId: string,
): Promise<IntegrationConnectionTestResult>;
```

In `createDesktopTransport` add:

```ts
testSavedIntegration: (projectId, integrationId) =>
  bridge.testSavedIntegration(projectId, integrationId),
```

Add `testSavedIntegration: unavailable` to `apps/desktop/src/web/api/client.ts`.

- [ ] **Step 4: Add a deterministic browser-development result test**

In `apps/desktop/test/web/browser-development-client.test.ts`, give `project-1` a saved Sentry config and use the existing snapshot helper to assert:

```ts
await expect(transport.testSavedIntegration("project-1", "sentry")).resolves.toEqual({
  title: "连接成功",
  details: [
    { label: "Organization", value: "acme" },
    { label: "Project", value: "checkout" },
  ],
  testedAt: "2026-08-26T02:00:00.000Z",
});
```

Implement the preview result strictly from the saved snapshot project, without making a remote request:

```ts
testSavedIntegration: async (projectId, integrationId) => {
  const value = await snapshot();
  const project = value.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const integration = project.integrations?.[integrationId];
  if (!integration) throw new Error("PROJECT_INTEGRATION_NOT_FOUND");
  const organization = String(integration.config.organization ?? "").trim();
  const sentryProject = String(integration.config.project ?? "").trim();
  if (!organization) throw new Error("SENTRY_CONFIG_ORGANIZATION_REQUIRED");
  if (!sentryProject) throw new Error("SENTRY_CONFIG_PROJECT_REQUIRED");
  return {
    title: "连接成功",
    details: [
      { label: "Organization", value: organization },
      { label: "Project", value: sentryProject },
    ],
    testedAt: project.updatedAt,
  };
},
```

- [ ] **Step 5: Run Desktop boundary tests and typecheck, then commit**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/electron/desktop-api.test.ts test/web/transport.test.ts test/web/browser-development-client.test.ts
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: tests PASS and TypeScript exits 0.

Commit:

```bash
git add apps/desktop/src/electron/desktop-api.ts apps/desktop/src/web/api/types.ts apps/desktop/src/web/api/transport.ts apps/desktop/src/web/api/desktop-transport.ts apps/desktop/src/web/api/browser-development-transport.ts apps/desktop/src/web/api/client.ts apps/desktop/test/electron/desktop-api.test.ts apps/desktop/test/electron/e2e/security.spec.ts apps/desktop/test/web/transport.test.ts apps/desktop/test/web/browser-development-client.test.ts
git commit -m "feat(desktop): expose saved Integration tests"
```

### Task 5: Build the generic connection-test UI

**Files:**
- Create: `apps/desktop/src/web/projects/integration-connection-test.tsx`
- Modify: `apps/desktop/test/web/projects.test.tsx`
- Modify: `apps/desktop/src/web/projects/integration-fields.tsx`
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/src/web/app.tsx`

- [ ] **Step 1: Write failing UI tests for summaries and saved-only behavior**

Add a Sentry Manifest fixture to `apps/desktop/test/web/projects.test.tsx` using the approved sections. Add tests that assert:

```ts
it("renders config-derived collapsed summaries", () => {
  render(<IntegrationFields
    config={{ environment: "", query: "" }}
    dirty={false}
    editingSecrets={{}}
    manifest={sentryManifest}
    secretConfigured={{ token: true }}
    secretValues={{}}
    onConfigChange={vi.fn()}
    onEditSecret={vi.fn()}
    onSecretChange={vi.fn()}
    onTestSavedIntegration={vi.fn()}
  />);
  const filters = screen.getByText("过滤规则").closest("details");
  expect(filters).toHaveTextContent("全部环境 · 未解决 Issue");
  expect(filters).not.toHaveAttribute("open");
});

it("disables testing before first save", () => {
  render(<ProjectForm
    inspection={inspection}
    manifests={[sentryManifest]}
    onSave={async () => undefined}
    onTestSavedIntegration={vi.fn()}
  />);
  selectTab("Sentry");
  expect(screen.getByRole("button", { name: "测试已保存配置" })).toBeDisabled();
  expect(screen.getByText("保存项目后可测试连接")).toBeVisible();
});

it("tests persisted settings while warning about unsaved edits", async () => {
  const testSaved = vi.fn(async () => ({
    title: "连接成功",
    details: [
      { label: "Organization", value: "saved-org" },
      { label: "Project", value: "saved-project" },
    ],
    testedAt: "2026-08-26T02:00:00.000Z",
  }));
  render(<ProjectForm
    initial={sentryProject}
    manifests={[sentryManifest]}
    onSave={async () => undefined}
    onTestSavedIntegration={testSaved}
  />);
  selectTab("Sentry");
  fireEvent.change(screen.getByLabelText("Organization"), {
    target: { value: "unsaved-org" },
  });
  expect(screen.getByText("当前修改不会用于本次测试")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "测试已保存配置" }));
  await screen.findByText("连接成功");
  expect(testSaved).toHaveBeenCalledWith("project-1", "sentry");
  expect(screen.getByText("saved-org")).toBeVisible();
  expect(screen.getByText("基于已保存配置")).toBeVisible();
});
```

Add a deferred-promise test that starts a request, rerenders another project, resolves the old request, and asserts the old result is not shown:

```ts
it("ignores a connection result after the project changes", async () => {
  let resolve!: (value: IntegrationConnectionTestResult) => void;
  const onTest = vi.fn(() => new Promise<IntegrationConnectionTestResult>((done) => {
    resolve = done;
  }));
  const { rerender } = render(<IntegrationConnectionTest
    dirty={false}
    integrationId="sentry"
    projectId="project-1"
    onTest={onTest}
  />);
  fireEvent.click(screen.getByRole("button", { name: "测试已保存配置" }));
  rerender(<IntegrationConnectionTest
    dirty={false}
    integrationId="sentry"
    projectId="project-2"
    onTest={onTest}
  />);
  await act(async () => resolve({
    title: "连接成功",
    details: [{ label: "Project", value: "old-project" }],
    testedAt: "2026-08-26T02:00:00.000Z",
  }));
  expect(screen.queryByText("old-project")).not.toBeInTheDocument();
});
```

Add an `it.each` table that supplies every stable error code from the component mapping and asserts the approved Chinese message. Include `token-value` in a rejected raw error and assert `screen.queryByText(/token-value/)` is absent.

- [ ] **Step 2: Run the projects test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/web/projects.test.tsx
```

Expected: FAIL because the summary renderer and test component do not exist.

- [ ] **Step 3: Create the reusable async test component**

Create `apps/desktop/src/web/projects/integration-connection-test.tsx` with this public API:

```ts
interface IntegrationConnectionTestProps {
  projectId?: string;
  integrationId: string;
  dirty: boolean;
  onTest(
    projectId: string,
    integrationId: string,
  ): Promise<IntegrationConnectionTestResult>;
}
```

Use a monotonically increasing request ref so late responses are ignored. Render these exact states:

```tsx
<section className="integration-connection-test">
  <div className="integration-connection-test-action">
    <Button disabled={!projectId || state.kind === "loading"} type="button" onClick={run}>
      {state.kind === "loading" ? "测试中…" : "测试已保存配置"}
    </Button>
    <small>{projectId ? "仅使用已保存的配置和凭证。" : "保存项目后可测试连接"}</small>
    {projectId && dirty ? <small>当前修改不会用于本次测试</small> : null}
  </div>
  {state.kind === "success" ? <div role="status" aria-live="polite">…</div> : null}
  {state.kind === "error" ? <Alert variant="destructive">…</Alert> : null}
</section>
```

Map only stable public codes:

```ts
const messages: Record<string, string> = {
  SENTRY_CONNECTION_FILTER_INVALID: "已保存的过滤条件无法用于当前 Sentry 项目。",
  SENTRY_CONNECTION_TOKEN_INVALID: "Auth token 无效或已失效。",
  SENTRY_CONNECTION_PERMISSION_DENIED: "Auth token 缺少读取事件的权限，请确认已授予 event:read。",
  SENTRY_CONNECTION_RESOURCE_NOT_FOUND: "Organization 或 Project 不存在，或当前 Token 无权访问。",
  SENTRY_CONNECTION_NETWORK: "无法连接 Sentry，请检查网络后重试。",
  SENTRY_CONFIG_ORGANIZATION_REQUIRED: "请先保存 Organization。",
  SENTRY_CONFIG_PROJECT_REQUIRED: "请先保存 Project。",
  SENTRY_SECRET_TOKEN_REQUIRED: "请先保存 Auth token。",
  INTEGRATION_CONNECTION_TEST_UNSUPPORTED: "该 Integration 不支持连接测试。",
};
```

Fallback copy is `Sentry 连接测试失败，请稍后重试。` for Sentry and `连接测试失败，请稍后重试。` for other integrations. Never render the raw error message unless it matches a listed stable code.

- [ ] **Step 4: Render dynamic summaries and the test section generically**

In `apps/desktop/src/web/projects/integration-fields.tsx`:

1. Add `projectId`, `dirty`, and `onTestSavedIntegration` props.
2. For `section.summary`, keep the existing static branch and add:

```ts
function sectionSummary(
  summary: NonNullable<IntegrationSection["summary"]>,
  config: Record<string, ConfigValue>,
): string | undefined {
  if ("value" in summary) return summary.value;
  return summary.fields.map((field) => {
    const value = String(config[field.key] ?? "").trim();
    return value ? `${field.valuePrefix ?? ""}${value}` : field.emptyValue;
  }).join(summary.separator ?? " · ");
}
```

3. When `section.connectionTest` is true, render `IntegrationConnectionTest` after the section header. Do not render empty config/secret field containers for this section.
4. For collapsed sections, render the computed summary inside `<summary>` so it remains visible while closed.

- [ ] **Step 5: Wire saved project identity and dirty state**

Add to `ProjectFormProps`:

```ts
onTestSavedIntegration?(
  projectId: string,
  integrationId: string,
): Promise<IntegrationConnectionTestResult>;
```

Pass these values into every `IntegrationFields`:

```tsx
projectId={project.id}
dirty={!saved}
onTestSavedIntegration={onTestSavedIntegration ?? unsupportedConnectionTest}
```

Add a default rejector that throws `INTEGRATION_CONNECTION_TEST_UNSUPPORTED`; do not hide a Manifest-declared control because a callback was accidentally omitted.

In `apps/desktop/src/web/app.tsx`, add the callback to `ProjectsWorkspace` props and pass:

```tsx
onTestSavedIntegration={(projectId, integrationId) =>
  api.testSavedIntegration(projectId, integrationId)}
```

through to `ProjectForm`.

- [ ] **Step 6: Run the projects test and verify GREEN**

Run the command from Step 2. Expected: PASS with no React act warnings.

- [ ] **Step 7: Run Desktop typecheck and commit**

Run:

```bash
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: TypeScript exits 0.

Commit:

```bash
git add apps/desktop/src/web/projects/integration-connection-test.tsx apps/desktop/src/web/projects/integration-fields.tsx apps/desktop/src/web/projects/project-form.tsx apps/desktop/src/web/app.tsx apps/desktop/test/web/projects.test.tsx
git commit -m "feat(desktop): rebuild Sentry connection settings"
```

### Task 6: Polish styling, acceptance, and documentation

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/scripts/dev-browser-snapshot.ts`
- Modify: `test/e2e/runtime-protocol-fixture.ts`
- Modify: `test/e2e/projects.spec.ts`
- Modify: `docs/configuration.md`

- [ ] **Step 1: Write the failing browser acceptance assertions**

Update the Sentry fixture Manifest in `test/e2e/runtime-protocol-fixture.ts` to match the production grouped Manifest, then add this bridge method so it returns the fixture's persisted values:

```ts
testSavedIntegration: async (projectId: string, integrationId: string) => {
  const project = read().projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const integration = project.integrations[integrationId];
  if (!integration) throw new Error("PROJECT_INTEGRATION_NOT_FOUND");
  return {
    title: "连接成功",
    details: [
      { label: "Organization", value: String(integration.config.organization) },
      { label: "Project", value: String(integration.config.project) },
    ],
    testedAt: now(),
  };
},
```

In `apps/desktop/scripts/dev-browser-snapshot.ts`, change the fallback Sentry entry to:

```ts
sentry: {
  enabled: true,
  config: { organization: "acme", project: "checkout" },
  secretConfigured: { token: true },
},
```

Extend `test/e2e/projects.spec.ts`:

```ts
await page.getByRole("tab", { name: "Sentry" }).click();
await expect(page.getByRole("heading", { name: "连接配置" })).toBeVisible();
await expect(page.getByText("过滤规则").locator("..")).toContainText(
  "全部环境 · 未解决 Issue",
);
await expect(page.getByLabel("Auth token")).toBeVisible();
await expect(page.getByText("需要 event:read 权限；请勿填写 DSN。")).toBeVisible();
await page.getByLabel("Organization").fill("acme");
await page.getByLabel("Project").fill("checkout");
await page.getByLabel("Auth token").fill("must-not-leak");
await page.getByRole("button", { name: "保存更改" }).click();
await expect(page.getByText("所有更改已保存")).toBeVisible();
await page.getByRole("button", { name: "测试已保存配置" }).click();
await expect(page.getByRole("status")).toContainText("连接成功");
await expect(page.getByRole("status")).toContainText("acme");
await expect(page.getByRole("status")).toContainText("checkout");
await expect(page.locator("body")).not.toContainText("must-not-leak");
```

- [ ] **Step 2: Run browser acceptance and verify RED**

Run:

```bash
pnpm exec playwright test test/e2e/projects.spec.ts
```

Expected: FAIL until the fixture, CSS, and browser transport result are aligned.

- [ ] **Step 3: Add dense semantic styling**

In `apps/desktop/src/web/styles/global.css`, add styles using only existing variables:

```css
.integration-connection-test {
  display: grid;
  gap: 14px;
}

.integration-connection-test-action {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  align-items: center;
  gap: 6px 16px;
}

.integration-connection-test-action [data-slot="button"] {
  width: fit-content;
  min-width: 132px;
}

.integration-connection-test-action small {
  grid-column: 2;
  color: var(--text-muted);
  font-size: 11px;
}

.integration-connection-test-result {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  padding: 14px 16px;
}

.integration-connection-test-result[data-state="success"] {
  border-color: color-mix(in oklab, var(--success) 38%, var(--border));
  background: var(--success-soft);
}

.integration-connection-test-result h4 {
  margin: 0;
  color: var(--success);
  font-size: 13px;
  font-weight: 560;
}

.integration-connection-test-result dl {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 8px 16px;
  margin: 12px 0 0;
}

.integration-connection-test-result dt {
  color: var(--text-muted);
  font-size: 11px;
}

.integration-connection-test-result dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.integration-section-collapsed .integration-section-summary-inline {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 11px;
}
```

Inside the existing narrow project-settings media query, add:

```css
.integration-connection-test-action,
.integration-connection-test-result dl {
  grid-template-columns: minmax(0, 1fr);
}

.integration-connection-test-action small {
  grid-column: 1;
}
```

Do not add shadows, gradients, decorative icons, hard-coded dark/light colors, or Sentry-specific selectors.

- [ ] **Step 4: Update configuration documentation**

Replace the Sentry bullet in `docs/configuration.md` with:

```md
- Sentry：启用时 `organization`、`project` 和 Auth token 必填；`environment`、`query` 可选。Query 留空时 Sentry 默认使用 `is:unresolved`。Auth token 不是 DSN，最小权限建议为 `event:read`。保存项目后可使用“测试已保存配置”验证访问权限；未保存的字段和 Token 草稿不会参与测试。
```

- [ ] **Step 5: Run acceptance and focused package suites**

Run:

```bash
pnpm exec playwright test test/e2e/projects.spec.ts
pnpm --filter @oh-my-bug/core test
pnpm --filter @oh-my-bug/integration-sentry test
pnpm --filter @oh-my-bug/runtime test
pnpm --filter @oh-my-bug/desktop test
```

Expected: all commands exit 0 with no failed tests or warnings introduced by this change.

- [ ] **Step 6: Run full typecheck and workspace verification**

Run:

```bash
pnpm typecheck:workspaces
pnpm test:workspaces
```

Expected: both commands exit 0.

- [ ] **Step 7: Inspect the rendered page in dark, light, and narrow layouts**

Use the existing deterministic browser/Electron snapshot harness. Verify:

- 1536×1024 dark: connection fields align to the same 160px label track as DingTalk.
- 1536×1024 light: success, error, border, and muted text retain WCAG AA contrast.
- 720px width: actions and result key/value pairs stack without horizontal scrolling.
- 200% zoom: the fixed footer does not cover the test result or filters.
- Keyboard: tab order reaches the enable switch, fields, replace control, test button, disclosure, and save action in visual order.
- Token bytes never appear in the page text, screenshot metadata, or console output.

If inspection finds a defect, add a failing component or E2E assertion before changing CSS or behavior, then rerun Steps 5 and 6.

- [ ] **Step 8: Commit the acceptance and polish increment**

```bash
git add apps/desktop/src/web/styles/global.css apps/desktop/scripts/dev-browser-snapshot.ts test/e2e/runtime-protocol-fixture.ts test/e2e/projects.spec.ts docs/configuration.md
git commit -m "test(desktop): accept redesigned Sentry settings"
```

## Final verification checklist

- [ ] `git diff --check` reports no whitespace errors.
- [ ] `git status --short` contains only intended files or is clean after commits.
- [ ] Every new behavior was observed failing before implementation and passing after implementation.
- [ ] Core, Sentry, Runtime, Desktop, E2E, and workspace tests all have fresh passing output.
- [ ] TypeScript workspace checks have fresh passing output.
- [ ] Manual visual inspection covers dark, light, narrow, 200% zoom, and keyboard use.
- [ ] No protocol payload, public error, DOM node, log line, or screenshot contains an Auth token.
- [ ] Compare the final diff with `docs/superpowers/specs/2026-08-25-sentry-settings-redesign.md` and account for every requirement and non-goal.
