# Independent Evidence Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist completed implementation separately from visual proof, retry only evidence acquisition, and provide a host-managed browser, Electron, or command capture path.

**Architecture:** Core adds `DeliveryDraft`, `EVIDENCE_CAPTURE`, and `EVIDENCE_FAILED`, with evidence retries independent of Repair iteration. Runtime turns Repair output into a durable draft before importing media, dispatches `CAPTURE_EVIDENCE` separately from `EVIDENCE` inspection, and selects either a configured host provider or an evidence-only Agent turn. The host provider owns only processes it launches, writes only into the prepared intake directory, and returns structured public failure codes.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, React 19, SQLite, Node child processes, Playwright 1.62, Electron 43, Sharp, pnpm workspaces

---

## File map

- `packages/core/src/agent/types.ts` and `packages/core/src/agent/adapter.ts`: delivery draft and evidence-only Agent contracts.
- `packages/core/src/issue/{types,schema,workflow,results}.ts`: evidence states, transitions, counters, and failures.
- `packages/core/src/runtime/types.ts`: `CAPTURE_EVIDENCE` durable operation and capture configuration.
- `packages/agent-codex/src/{codex-agent-adapter,prompts,output-schemas}.ts`: evidence-only Codex turn and schema.
- `apps/runtime/src/evidence/capture-provider.ts`: host-provider contract, configuration validation, and public errors.
- `apps/runtime/src/evidence/playwright-capture-provider.ts`: browser, Electron, and command capture implementation.
- `apps/runtime/src/orchestration/worker.ts`: implementation-draft, capture, import, inspection, and retry pipeline.
- `apps/runtime/src/orchestration/{commands,recovery}.ts`: evidence retry command and compatibility migration.
- `apps/runtime/src/composition.ts`: construct and inject the host provider.
- `apps/runtime/src/protocol/schema-definitions.ts`: product configuration schema.
- `apps/desktop/src/web/projects/project-form.tsx`: capture-mode project settings.
- `apps/desktop/src/web/issues/{issue-status,issue-detail,agent-activity}.tsx`: preserved-implementation status and Retry evidence action.

### Task 1: Add the independent evidence state model

**Files:**
- Modify: `packages/core/src/agent/types.ts`
- Modify: `packages/core/src/issue/types.ts`
- Modify: `packages/core/src/issue/schema.ts`
- Modify: `packages/core/src/issue/workflow.ts`
- Modify: `packages/core/src/issue/results.ts`
- Modify: `packages/core/test/issue/schema.test.ts`
- Modify: `packages/core/test/issue/workflow.test.ts`
- Modify: `packages/core/test/issue/results.test.ts`

- [ ] **Step 1: Write failing schema and transition tests**

Add these cases:

```ts
it("persists implementation completion before evidence", () => {
  const draft = {
    summary: "Payment route restored",
    repairIteration: 2,
    implementationCompletedAt: now,
  };
  expect(issueSchema.parse({
    ...issueAt("EVIDENCE_CAPTURE"),
    repair: { iteration: 2, evidenceRetries: 1, deliveryDraft: draft },
  })).toMatchObject({
    status: "EVIDENCE_CAPTURE",
    repair: { iteration: 2, evidenceRetries: 1, deliveryDraft: draft },
  });
});

it("retries evidence without starting another Repair iteration", () => {
  const checking = {
    ...issueAt("EVIDENCE_CHECK"),
    repair: { iteration: 2, deliveryDraft: draft, delivery },
  };
  const retrying = recordEvidenceRejection(checking, "Page was blank", now);
  expect(retrying).toMatchObject({
    status: "EVIDENCE_CAPTURE",
    repair: { iteration: 2, deliveryDraft: draft, feedback: "Page was blank" },
  });
});

it("preserves the draft when evidence reaches a terminal failure", () => {
  const failed = recordEvidenceFailure(
    { ...issueAt("EVIDENCE_CAPTURE"), repair: { iteration: 2, deliveryDraft: draft } },
    "EVIDENCE_RETRY_LIMIT_REACHED",
    now,
  );
  expect(failed).toMatchObject({
    status: "EVIDENCE_FAILED",
    repair: { iteration: 2, deliveryDraft: draft },
    lastFailure: { stage: "EVIDENCE", code: "EVIDENCE_RETRY_LIMIT_REACHED" },
  });
});
```

Declare `draft` beside the existing `delivery` fixture in both workflow/results test files.

- [ ] **Step 2: Run Core issue tests and verify RED**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/schema.test.ts test/issue/workflow.test.ts test/issue/results.test.ts
```

Expected: FAIL because the new statuses, fields, actions, and result helpers do not exist.

- [ ] **Step 3: Add the delivery draft and evidence fields**

In `packages/core/src/agent/types.ts` add:

```ts
export interface DeliveryDraft {
  summary: string;
  repairIteration: number;
  implementationCompletedAt: string;
}
```

Extend `IssueStatus`, `RepairState`, and `IssueFailure`:

```ts
export type IssueStatus =
  | "RECEIVED"
  | "ASSESSING"
  | "ASSESSMENT_REVIEW"
  | "ASSESSMENT_FAILED"
  | "REPAIRING"
  | "EVIDENCE_CAPTURE"
  | "EVIDENCE_CHECK"
  | "EVIDENCE_FAILED"
  | "REPAIR_FAILED"
  | "ACCEPTANCE_REVIEW"
  | "APPROVED"
  | "COMPLETED"
  | "CLOSED"
  | "CANCELED";

export interface RepairState {
  iteration: number;
  evidenceRetries?: number;
  /** Read-only compatibility with pre-evidence-stage persisted Issues. */
  automaticEvidenceRetries?: number;
  feedback?: string;
  deliveryDraft?: DeliveryDraft;
  delivery?: Delivery;
}

export interface IssueFailure {
  stage: "ASSESSMENT" | "REPAIR" | "EVIDENCE";
  code: string;
}
```

Mirror these fields exactly in `issueSchema`; retain `automaticEvidenceRetries` so old JSON can be read before startup migration.

- [ ] **Step 4: Replace evidence-to-Repair transitions**

Add actions `IMPLEMENTATION_READY`, `EVIDENCE_ERRORED`, and `RETRY_EVIDENCE`. Use these transition rows:

```ts
REPAIRING: {
  IMPLEMENTATION_READY: "EVIDENCE_CAPTURE",
  REPAIR_ERRORED: "REPAIR_FAILED",
  CANCEL: "CANCELED",
},
EVIDENCE_CAPTURE: {
  DELIVERY_READY: "EVIDENCE_CHECK",
  EVIDENCE_ERRORED: "EVIDENCE_FAILED",
  CANCEL: "CANCELED",
},
EVIDENCE_CHECK: {
  EVIDENCE_REJECTED: "EVIDENCE_CAPTURE",
  EVIDENCE_ACCEPTED: "ACCEPTANCE_REVIEW",
  EVIDENCE_ERRORED: "EVIDENCE_FAILED",
  CANCEL: "CANCELED",
},
EVIDENCE_FAILED: {
  RETRY_EVIDENCE: "EVIDENCE_CAPTURE",
  CANCEL: "CANCELED",
},
```

Restrict Repair-iteration increments to real implementation work:

```ts
function startsRepairIteration(action: InternalIssueAction): boolean {
  return [
    "APPROVE_IMPLEMENTATION",
    "RETRY_REPAIR",
    "REJECT_DELIVERY",
  ].includes(action);
}
```

- [ ] **Step 5: Add result constructors**

Add these complete functions to `results.ts`:

```ts
export function recordImplementationDraft(
  issue: Issue,
  summaryInput: string,
  now: string,
): Issue {
  const summary = required(summaryInput, "DELIVERY_SUMMARY_REQUIRED");
  const iteration = issue.repair?.iteration ?? 1;
  const next = transitionIssue(issue, "IMPLEMENTATION_READY", now);
  return {
    ...next,
    repair: {
      iteration,
      evidenceRetries: issue.repair?.evidenceRetries ?? 0,
      deliveryDraft: {
        summary,
        repairIteration: iteration,
        implementationCompletedAt: now,
      },
    },
    lastFailure: undefined,
  };
}

export function recordEvidenceFailure(
  issue: Issue,
  errorCode: string,
  now: string,
): Issue {
  return withFailure(
    transitionIssue(issue, "EVIDENCE_ERRORED", now),
    { stage: "EVIDENCE", code: required(errorCode, "ERROR_CODE_REQUIRED") },
  );
}

export function retryEvidence(issue: Issue, now: string): Issue {
  const next = transitionIssue(issue, "RETRY_EVIDENCE", now);
  return { ...next, lastFailure: undefined };
}
```

Change `recordDelivery` to require `EVIDENCE_CAPTURE`, preserve `deliveryDraft`/`evidenceRetries`, and build the final summary from the persisted draft. Change `recordEvidenceRejection` to preserve the draft and iteration while clearing the rejected `delivery`.

- [ ] **Step 6: Run all Core tests**

```bash
pnpm --filter @oh-my-bug/core test
pnpm --filter @oh-my-bug/core typecheck
```

Expected: PASS, including an explicit assertion that evidence rejection leaves `repair.iteration` unchanged.

- [ ] **Step 7: Commit the state model**

```bash
git add packages/core/src/agent/types.ts packages/core/src/issue packages/core/test/issue
git commit -m "feat(core): separate implementation from evidence"
```

### Task 2: Add the evidence-only Agent operation

**Files:**
- Modify: `packages/core/src/agent/adapter.ts`
- Modify: `packages/core/src/agent/types.ts`
- Modify: `packages/core/test/agent/adapter.test.ts`
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`
- Modify: `packages/agent-codex/src/prompts.ts`
- Modify: `packages/agent-codex/src/output-schemas.ts`
- Create: `packages/agent-codex/test/evidence.test.ts`
- Modify: `apps/runtime/src/testing/demo-agent.ts`
- Modify: `apps/runtime/test/helpers/fakes.ts`

- [ ] **Step 1: Write the failing Codex evidence-turn test**

Create `packages/agent-codex/test/evidence.test.ts`. Import `CodexAgentAdapter`, `FakeCodexClient`, `MemoryAgentSessionStore`, and the standard `issue/project/assessment/session` fixtures from `test/helpers.ts`, save `providerSessionId` on the session record before the call, and use this test body:

```ts
it("captures evidence on the same native thread without reimplementing", async () => {
  client.outputs.push({
    evidence: [{
      type: "screenshot",
      label: "Payment page",
      relativePath: "payment.png",
    }],
  });
  const result = await adapter.captureEvidence(session, {
    issue,
    project,
    assessment,
    deliveryDraft: {
      summary: "Payment route restored",
      repairIteration: 2,
      implementationCompletedAt: now,
    },
    evidenceDirectory: "/workspace/evidence",
    feedback: "Previous screenshot was blank",
  });

  expect(result.evidence).toEqual([{
    type: "screenshot",
    label: "Payment page",
    relativePath: "payment.png",
  }]);
  expect(client.resumedThreadIds).toEqual([providerSessionId]);
  expect(client.prompts.at(-1)).toContain("Do not reimplement or refactor");
  expect(client.prompts.at(-1)).toContain("Previous screenshot was blank");
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/evidence.test.ts
```

Expected: FAIL because `captureEvidence` and its schema do not exist.

- [ ] **Step 3: Define the Core operation**

Add these types:

```ts
export interface EvidenceCaptureInput {
  issue: Issue;
  project: ProjectContext;
  assessment: Assessment;
  deliveryDraft: DeliveryDraft;
  evidenceDirectory: string;
  feedback?: string;
  continuation?: AgentContinuation;
}

export interface EvidenceCaptureResult {
  evidence: RepairEvidencePath[];
}
```

Extend `AgentAdapter`:

```ts
captureEvidence(
  session: AgentSessionRef,
  input: EvidenceCaptureInput,
): Promise<EvidenceCaptureResult>;
```

Keep `RepairResult.evidence` required but allow an empty array; this avoids an optional-field migration across adapters.

- [ ] **Step 4: Implement the Codex schema, prompt, and turn**

Export this schema and parser:

```ts
export const evidenceOutputSchema = {
  type: "object",
  properties: {
    evidence: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["screenshot", "recording"] },
          label: { type: "string", minLength: 1 },
          relativePath: { type: "string", minLength: 1 },
        },
        required: ["type", "label", "relativePath"],
        additionalProperties: false,
      },
    },
  },
  required: ["evidence"],
  additionalProperties: false,
} as const;

export function parseEvidenceOutput(value: unknown): EvidenceCaptureResult {
  const object = strictObject(value, ["evidence"]);
  if (!Array.isArray(object.evidence) || object.evidence.length === 0 || object.evidence.length > 20) {
    throw new Error("VISUAL_EVIDENCE_REQUIRED");
  }
  return {
    evidence: object.evidence.map((entry) => {
      const item = strictObject(entry, ["type", "label", "relativePath"]);
      const type = requiredString(item.type, "EVIDENCE_TYPE_REQUIRED");
      if (type !== "screenshot" && type !== "recording") {
        throw new Error("EVIDENCE_TYPE_INVALID");
      }
      return {
        type,
        label: requiredString(item.label, "EVIDENCE_LABEL_REQUIRED"),
        relativePath: requiredString(item.relativePath, "EVIDENCE_PATH_REQUIRED"),
      };
    }),
  };
}
```

Add this prompt builder:

```ts
export function evidencePrompt(input: EvidenceCaptureInput): string {
  return [
    "Capture real visual evidence for the already completed implementation. Do not reimplement or refactor the product change.",
    "Inspect the existing files and prior verification first. Modify product code only if the acceptance run exposes a real defect.",
    `Write screenshots or recordings under: ${input.evidenceDirectory}`,
    "Return only screenshots or recordings directly captured from the real acceptance run, using relative paths beneath that directory.",
    `Issue: ${JSON.stringify(input.issue)}`,
    `Approved Assessment: ${JSON.stringify(input.assessment)}`,
    `Delivery draft: ${JSON.stringify(input.deliveryDraft)}`,
    `Project commands: ${JSON.stringify(input.project.commands ?? {})}`,
    ...(input.feedback ? [`Evidence feedback: ${input.feedback}`] : []),
    ...continuationPrompt(input.continuation),
  ].join("\n\n");
}
```

Add activity stage `"EVIDENCE"`, map its Chinese name to `采集证据`, and implement `captureEvidence` by calling `turn` with workspace-write, the new prompt/schema, `parseEvidenceOutput`, and the existing `validateEvidencePath`.

Change `repairOutputSchema.evidence.minItems` to `0` and change `parseRepairOutput` to accept `[]` while still rejecting non-arrays and more than 20 items.

- [ ] **Step 5: Update DemoAgent and FakeAgent**

In `FakeAgent`, add `evidenceSessions`, `evidenceInputs`, `evidenceError`, and:

```ts
async captureEvidence(
  session: AgentSessionRef,
  input: EvidenceCaptureInput,
): Promise<EvidenceCaptureResult> {
  this.evidenceSessions.push(session.sessionId);
  this.evidenceInputs.push(input);
  if (this.evidenceError) throw this.evidenceError;
  await mkdir(input.evidenceDirectory, { recursive: true });
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#45a978" },
  }).png().toFile(join(input.evidenceDirectory, "proof.png"));
  return { evidence: repairResult.evidence };
}
```

In DemoAgent, add this method beside `repair` and use the same demo media writer that Repair already calls:

```ts
async captureEvidence(
  session: AgentSessionRef,
  input: EvidenceCaptureInput,
): Promise<EvidenceCaptureResult> {
  this.assertSession(session);
  await this.delay();
  const relativePath = await this.writeEvidence(input.evidenceDirectory);
  return {
    evidence: [{ type: "screenshot", label: "Demo acceptance", relativePath }],
  };
}
```

- [ ] **Step 6: Run Agent suites**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/agent/adapter.test.ts
pnpm --filter @oh-my-bug/agent-codex test
pnpm --filter @oh-my-bug/runtime exec vitest run test/testing/demo-agent.test.ts
```

Expected: PASS; Repair accepts zero evidence, but the evidence-only operation requires at least one valid item.

- [ ] **Step 7: Commit the Agent operation**

```bash
git add packages/core/src/agent packages/core/test/agent packages/agent-codex apps/runtime/src/testing/demo-agent.ts apps/runtime/test/helpers/fakes.ts apps/runtime/test/testing/demo-agent.test.ts
git commit -m "feat(agent): add evidence-only turns"
```

### Task 3: Introduce the host capture provider contract

**Files:**
- Modify: `packages/core/src/agent/adapter.ts`
- Modify: `packages/core/src/runtime/types.ts`
- Modify: `packages/core/test/runtime/project.test.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Modify: `apps/runtime/test/protocol/operations.test.ts`
- Create: `apps/runtime/src/evidence/capture-provider.ts`
- Create: `apps/runtime/test/evidence/capture-provider.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Extend the project fixture with:

```ts
commands: {
  start: "pnpm dev --host 127.0.0.1",
  acceptanceUrl: "http://127.0.0.1:4173/payment",
  evidenceCapture: {
    mode: "browser",
    label: "Payment page",
    timeoutMs: 15_000,
  },
},
```

Assert the Core and protocol schemas accept `browser`, accept `electron` only with `electronEntry`, accept `command` only with `command`, and reject browser URLs whose hostname is not `localhost`, `127.0.0.1`, or `::1`.

- [ ] **Step 2: Run schema tests and verify RED**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/runtime/project.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run test/protocol/operations.test.ts
```

Expected: FAIL because `ProjectCommands` is strict and has no capture configuration.

- [ ] **Step 3: Add the discriminated configuration**

Add to `adapter.ts`:

```ts
export type ProjectEvidenceCapture =
  | { mode: "browser"; label: string; timeoutMs?: number }
  | { mode: "electron"; label: string; electronEntry: string; timeoutMs?: number }
  | { mode: "command"; label: string; command: string; timeoutMs?: number };

export interface ProjectCommands {
  install?: string;
  test?: string;
  start?: string;
  acceptanceUrl?: string;
  evidenceCapture?: ProjectEvidenceCapture;
}
```

Create this Zod union in `packages/core/src/runtime/types.ts`, use it in `commandsSchema`, and export it for `projectCommandsSchema` to import rather than maintaining a second definition:

```ts
export const projectEvidenceCaptureSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("browser"),
    label: z.string().trim().min(1),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  }).strict(),
  z.object({
    mode: z.literal("electron"),
    label: z.string().trim().min(1),
    electronEntry: z.string().trim().min(1),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  }).strict(),
  z.object({
    mode: z.literal("command"),
    label: z.string().trim().min(1),
    command: z.string().trim().min(1),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  }).strict(),
]);

const commandsSchema = z.object({
  install: z.string().trim().min(1).optional(),
  test: z.string().trim().min(1).optional(),
  start: z.string().trim().min(1).optional(),
  acceptanceUrl: z.string().trim().min(1).optional(),
  evidenceCapture: projectEvidenceCaptureSchema.optional(),
}).strict().superRefine((commands, context) => {
  if (commands.evidenceCapture?.mode !== "browser") return;
  if (!commands.start || !commands.acceptanceUrl) {
    context.addIssue({ code: "custom", message: "BROWSER_CAPTURE_COMMANDS_REQUIRED" });
    return;
  }
  let url: URL;
  try {
    url = new URL(commands.acceptanceUrl);
  } catch {
    context.addIssue({ code: "custom", message: "ACCEPTANCE_URL_INVALID" });
    return;
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    context.addIssue({ code: "custom", message: "ACCEPTANCE_URL_MUST_BE_LOCALHOST" });
  }
});
```

- [ ] **Step 4: Define public provider errors and request/result types**

Create `capture-provider.ts`:

```ts
export const EVIDENCE_CAPTURE_FAILURE_CODES = [
  "EVIDENCE_FILE_MISSING",
  "EVIDENCE_MEDIA_INVALID",
  "EVIDENCE_NOT_REVIEWABLE",
  "EVIDENCE_TARGET_UNREACHABLE",
  "EVIDENCE_CAPTURE_PERMISSION_DENIED",
  "EVIDENCE_CAPTURE_PROCESS_FAILED",
  "EVIDENCE_RETRY_LIMIT_REACHED",
] as const;

export type EvidenceCaptureFailureCode =
  typeof EVIDENCE_CAPTURE_FAILURE_CODES[number];

export class EvidenceCaptureError extends Error {
  constructor(
    readonly code: EvidenceCaptureFailureCode,
    readonly mode: ProjectEvidenceCapture["mode"],
    readonly target: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "EvidenceCaptureError";
  }
}

export interface EvidenceCaptureRequest {
  issueId: string;
  workspaceDirectory: string;
  intakeDirectory: string;
  commands: ProjectCommands;
  capture: ProjectEvidenceCapture;
}

export interface EvidenceCaptureArtifact {
  type: "screenshot" | "recording";
  label: string;
  path: string;
}

export interface EvidenceCaptureProvider {
  capture(input: EvidenceCaptureRequest): Promise<EvidenceCaptureArtifact>;
}
```

Test that the error exposes only code/mode/target and never includes a child-process stderr string in its public `message`.

- [ ] **Step 5: Run contract and schema tests**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/runtime/project.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run test/evidence/capture-provider.test.ts test/protocol/operations.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the provider contract**

```bash
git add packages/core/src/agent/adapter.ts packages/core/src/runtime/types.ts packages/core/test/runtime/project.test.ts apps/runtime/src/protocol/schema-definitions.ts apps/runtime/test/protocol/operations.test.ts apps/runtime/src/evidence/capture-provider.ts apps/runtime/test/evidence/capture-provider.test.ts
git commit -m "feat(runtime): define host evidence capture"
```

### Task 4: Implement browser, Electron, and command capture modes

**Files:**
- Create: `apps/runtime/src/evidence/playwright-capture-provider.ts`
- Create: `apps/runtime/test/evidence/playwright-capture-provider.test.ts`
- Create: `apps/runtime/test/fixtures/evidence/browser-server.cjs`
- Create: `apps/runtime/test/fixtures/evidence/electron-main.cjs`
- Create: `apps/runtime/test/fixtures/evidence/electron.html`
- Create: `apps/runtime/test/fixtures/evidence/write-png.cjs`
- Modify: `apps/runtime/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add failing mode tests**

Write these three success tests around a temporary intake directory. Allocate the browser port with a `reservePort()` test helper before building `commands.start` and `acceptanceUrl`, so the Provider receives a concrete approved port:

```ts
it("captures a ready localhost page and cleans up its own server", async () => {
  const artifact = await provider.capture(browserRequest);
  expect(artifact).toMatchObject({ type: "screenshot", label: "Browser proof" });
  await expect(access(artifact.path)).resolves.toBeUndefined();
  await expect(fetch(browserRequest.commands.acceptanceUrl!)).rejects.toThrow();
});

it("captures the first Electron window", async () => {
  const artifact = await provider.capture(electronRequest);
  expect(artifact.type).toBe("screenshot");
  expect((await stat(artifact.path)).size).toBeGreaterThan(0);
});

it("passes one controlled output path to command capture", async () => {
  const artifact = await provider.capture(commandRequest);
  expect(dirname(artifact.path)).toBe(commandRequest.intakeDirectory);
  expect((await stat(artifact.path)).size).toBeGreaterThan(0);
});
```

Add this table-driven failure assertion:

```ts
it.each([
  [unreachableBrowserRequest, "EVIDENCE_TARGET_UNREACHABLE"],
  [permissionDeniedCommandRequest, "EVIDENCE_CAPTURE_PERMISSION_DENIED"],
  [nonZeroCommandRequest, "EVIDENCE_CAPTURE_PROCESS_FAILED"],
  [missingOutputCommandRequest, "EVIDENCE_FILE_MISSING"],
  [escapedOutputCommandRequest, "EVIDENCE_CAPTURE_PERMISSION_DENIED"],
] as const)("maps capture failure to %s", async (request, code) => {
  await expect(provider.capture(request)).rejects.toMatchObject({ code });
});
```

- [ ] **Step 2: Add dependencies and verify RED**

Add `playwright: ^1.62.1` to `@oh-my-bug/runtime` dependencies and `electron: 43.4.1` to its devDependencies, run `pnpm install`, then:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/evidence/playwright-capture-provider.test.ts
```

Expected: FAIL because `PlaywrightEvidenceCaptureProvider` does not exist.

- [ ] **Step 3: Implement bounded process ownership and readiness**

Implement these private primitives in `playwright-capture-provider.ts`:

```ts
interface OwnedProcess {
  child: ChildProcess;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stop(): Promise<void>;
}

function startOwned(command: string, cwd: string, env: NodeJS.ProcessEnv): OwnedProcess {
  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit").then(([code, signal]) => ({ code, signal }));
  return {
    child,
    exited,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([exited, delay(2_000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
  };
}

async function waitForReady(url: URL, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new EvidenceCaptureError(
    "EVIDENCE_TARGET_UNREACHABLE",
    "browser",
    `${url.hostname}:${url.port}`,
  );
}
```

`stop()` must never use `pkill`, port-based killing, process-name matching, or process groups it did not create.

- [ ] **Step 4: Implement the three capture branches**

Create deterministic fixtures with these contents:

```js
// browser-server.cjs
const http = require("node:http");
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<main data-testid='proof'>Browser acceptance</main>");
});
server.listen(Number(process.env.PORT), "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
```

```js
// electron-main.cjs
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 640, height: 480, show: true });
  void window.loadFile(path.join(__dirname, "electron.html"));
});
app.on("window-all-closed", () => app.quit());
```

```html
<!-- electron.html -->
<!doctype html><html><body><main>Electron acceptance</main></body></html>
```

```js
// write-png.cjs
const fs = require("node:fs");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
fs.writeFileSync(process.env.OH_MY_BUG_EVIDENCE_PATH, png);
```

Use `resolveInside(intakeDirectory, "evidence.png")` for every output. Browser mode starts `commands.start`, waits for the approved localhost URL, opens Chromium, navigates, and calls `page.screenshot`. Electron mode calls `_electron.launch({ args: [resolve(workspaceDirectory, electronEntry)], cwd: workspaceDirectory })`, awaits `firstWindow()`, and screenshots it. Command mode starts the configured command with only these added environment values:

```ts
{
  ...process.env,
  OH_MY_BUG_EVIDENCE_PATH: outputPath,
  OH_MY_BUG_EVIDENCE_DIRECTORY: input.intakeDirectory,
}
```

After every branch, verify `realpath(outputPath)` remains under `realpath(intakeDirectory)` and `stat.size > 0`. Map timeout to `EVIDENCE_TARGET_UNREACHABLE`, `EACCES/EPERM` to `EVIDENCE_CAPTURE_PERMISSION_DENIED`, missing/empty output to `EVIDENCE_FILE_MISSING`, and all other launch/exit errors to `EVIDENCE_CAPTURE_PROCESS_FAILED`. Put owned-process, browser, and Electron cleanup in `finally` blocks.

Before Electron launch, reject absolute entries, `..` path segments, and resolved paths outside `workspaceDirectory`. For command-mode failures use the public target `configured-command`, never the configured command text. For browser failures expose only `hostname:port`.

- [ ] **Step 5: Run provider tests**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/evidence/playwright-capture-provider.test.ts
pnpm --filter @oh-my-bug/runtime typecheck
```

Expected: PASS for all modes and failures; tests verify unrelated fixture processes remain alive.

- [ ] **Step 6: Commit the provider**

```bash
git add apps/runtime/src/evidence apps/runtime/test/evidence apps/runtime/test/fixtures/evidence apps/runtime/package.json pnpm-lock.yaml
git commit -m "feat(runtime): capture host visual evidence"
```

### Task 5: Split Runtime implementation, capture, and inspection

**Files:**
- Modify: `packages/core/src/runtime/types.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `apps/runtime/src/composition.ts`
- Modify: `apps/runtime/test/helpers/runtime.ts`
- Modify: `apps/runtime/test/repair-worker.test.ts`
- Create: `apps/runtime/test/evidence-worker.test.ts`

- [ ] **Step 1: Write failing pipeline tests**

Add these focused assertions:

```ts
it("persists a draft and queues evidence when Repair returns none", async () => {
  agent.nextRepairResult = { summary: "Implemented", evidence: [] };
  await worker.drainOne();
  expect(store.getIssue(issue.id)).toMatchObject({
    status: "EVIDENCE_CAPTURE",
    repair: {
      iteration: 1,
      evidenceRetries: 0,
      deliveryDraft: {
        summary: "Implemented",
        repairIteration: 1,
        implementationCompletedAt: now,
      },
    },
  });
  expect(store.listPendingOperations()[0]?.operation).toBe("CAPTURE_EVIDENCE");
});

it("retries rejected evidence without calling Repair", async () => {
  await worker.drain();
  expect(agent.repairSessions).toEqual(["session-1"]);
  expect(agent.evidenceSessions).toEqual(["session-1", "session-1"]);
  expect(store.getIssue(issue.id)?.repair).toMatchObject({
    iteration: 1,
    evidenceRetries: 2,
  });
});
```

Add this outcome table to `evidence-worker.test.ts`; build each setup from `repairingIssue`, `FakeAgent`, `FakeEvidenceStore`, and a fake `EvidenceCaptureProvider`:

```ts
it.each([
  ["configured host", { configured: true, hostError: undefined, agentError: undefined }, "ACCEPTANCE_REVIEW"],
  ["Agent fallback", { configured: false, hostError: undefined, agentError: undefined }, "ACCEPTANCE_REVIEW"],
  ["host failure", { configured: true, hostError: new EvidenceCaptureError("EVIDENCE_TARGET_UNREACHABLE", "browser", "127.0.0.1:9"), agentError: undefined }, "EVIDENCE_CAPTURE"],
  ["Agent interruption", { configured: false, hostError: undefined, agentError: new AgentTurnInterruptedError("RUNTIME_STOPPING") }, "EVIDENCE_CAPTURE"],
] as const)("handles %s", async (_name, setup, expectedStatus) => {
  const harness = evidenceHarness(setup);
  await harness.worker.drainOne();
  expect(harness.store.getIssue(harness.issue.id)?.status).toBe(expectedStatus);
  expect(harness.agent.repairSessions).toEqual([]);
});
```

Add this second table for terminal and retry behavior:

```ts
it.each([
  ["import failure", { importError: new Error("private path"), rejectedInspections: 0 }, "EVIDENCE_CAPTURE", 1],
  ["one rejected inspection", { importError: undefined, rejectedInspections: 1 }, "EVIDENCE_CAPTURE", 1],
  ["retry limit", { importError: undefined, rejectedInspections: 3 }, "EVIDENCE_FAILED", 2],
  ["valid inspection", { importError: undefined, rejectedInspections: 0 }, "ACCEPTANCE_REVIEW", 0],
] as const)("handles %s without implementation re-entry", async (
  _name,
  setup,
  expectedStatus,
  expectedRetries,
) => {
  const harness = evidenceHarness(setup);
  await harness.worker.drain();
  expect(harness.store.getIssue(harness.issue.id)).toMatchObject({
    status: expectedStatus,
    repair: { iteration: 1, evidenceRetries: expectedRetries },
  });
  expect(harness.agent.repairSessions).toEqual([]);
});
```

- [ ] **Step 2: Run worker tests and verify RED**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/repair-worker.test.ts test/evidence-worker.test.ts
```

Expected: FAIL because rejected evidence still requeues `REPAIR`.

- [ ] **Step 3: Add the durable operation and dependency**

Extend the union:

```ts
export type PendingOperation =
  | "PREPARE"
  | "ASSESS"
  | "REPAIR"
  | "CAPTURE_EVIDENCE"
  | "EVIDENCE"
  | "FINALIZE";
```

Add `capture: EvidenceCaptureProvider` to `RuntimeWorkerDependencies`; construct `PlaywrightEvidenceCaptureProvider` in composition and pass a fake provider from `createHarness`.

Expose the dependency for deterministic acceptance tests without changing production defaults:

```ts
export interface CreateRuntimeOptions {
  databasePath: string;
  evidenceRoot?: string;
  agent?: AgentAdapter;
  evidenceCapture?: EvidenceCaptureProvider;
  id?: () => string;
  now?: () => string;
}
```

Thread it through `InternalCompositionOptions`. Use `options.evidenceCapture ?? new PlaywrightEvidenceCaptureProvider()` when constructing `OhMyBugRuntime`.

- [ ] **Step 4: Persist the implementation draft before media import**

After `agent.repair` returns, execute:

```ts
const drafted = recordImplementationDraft(claimed, result.summary, this.dependencies.now());
if (result.evidence.length === 0) {
  this.complete(claimed, drafted, "IMPLEMENTATION_READY", "CAPTURE_EVIDENCE");
  return;
}
if (!this.complete(claimed, drafted, "IMPLEMENTATION_READY", null)) return;

try {
  const delivery = await this.importDelivery(drafted, intake, result.evidence);
  this.complete(drafted, delivery, "DELIVERY_READY", "EVIDENCE");
} catch (error) {
  this.queueEvidenceCapture(drafted, publicEvidenceFailure(error));
}
```

`importDelivery` imports each path and calls `recordDelivery`. It never transitions to `REPAIR_FAILED`.

- [ ] **Step 5: Implement evidence capture dispatch**

Add a `CAPTURE_EVIDENCE` branch to `drainOne` and this selection inside `captureEvidence`:

```ts
const result = project.commands?.evidenceCapture
  ? { evidence: [await this.captureWithHost(project, claimed, intake.directory)] }
  : await agent.captureEvidence(claimed.agentSession!, {
      issue: claimed,
      project,
      assessment: claimed.assessment!,
      deliveryDraft: claimed.repair!.deliveryDraft!,
      evidenceDirectory: intake.directory,
      feedback: claimed.repair?.feedback,
      continuation: this.continuation(claimed, "CAPTURE_EVIDENCE"),
    });
const delivery = await this.importDelivery(claimed, intake, result.evidence);
this.complete(claimed, delivery, "DELIVERY_READY", "EVIDENCE");
```

`captureWithHost` converts the provider's absolute artifact path to a relative intake path only after `realpath` proves containment.

- [ ] **Step 6: Replace evidence requeue and limit handling**

Use a dedicated counter and operation:

```ts
private queueEvidenceCapture(
  current: Issue,
  feedback: string,
  failureCode = "EVIDENCE_NOT_REVIEWABLE",
): void {
  const retries = current.repair?.evidenceRetries ?? 0;
  if (retries >= MAX_AUTOMATIC_EVIDENCE_RETRIES) {
    this.complete(
      current,
      recordEvidenceFailure(current, "EVIDENCE_RETRY_LIMIT_REACHED", this.dependencies.now()),
      "EVIDENCE_FAILED",
    );
    return;
  }
  const capturing = current.status === "EVIDENCE_CHECK"
    ? recordEvidenceRejection(current, feedback, this.dependencies.now())
    : current;
  const next = {
    ...capturing,
    repair: {
      ...capturing.repair!,
      evidenceRetries: retries + 1,
      feedback,
      delivery: undefined,
    },
    lastFailure: undefined,
    ...(capturing.revision === current.revision
      ? {
          revision: current.revision + 1,
          updatedAt: this.dependencies.now(),
        }
      : {}),
  };
  this.complete(current, next, "EVIDENCE_CAPTURE_REQUEUED", "CAPTURE_EVIDENCE");
}
```

Map `EvidenceCaptureError.code` directly; map inspection failures to `EVIDENCE_MEDIA_INVALID` or `EVIDENCE_NOT_REVIEWABLE`; never include raw filesystem paths or stderr in Issue JSON.

- [ ] **Step 7: Make interruption/recovery operation-generic**

Allow `requeueInterrupted` and `continuation` to accept `"CAPTURE_EVIDENCE"`. Runtime shutdown requeues it without changing Repair iteration or evidence retry count. Startup recovery maps `EVIDENCE_CAPTURE` to `CAPTURE_EVIDENCE` and `EVIDENCE_CHECK` to `EVIDENCE`.

- [ ] **Step 8: Run Runtime tests**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/repair-worker.test.ts test/evidence-worker.test.ts test/recovery.test.ts test/shutdown.test.ts
```

Expected: PASS; no evidence path calls `agent.repair` after `IMPLEMENTATION_READY`.

- [ ] **Step 9: Commit the Runtime pipeline**

```bash
git add packages/core/src/runtime/types.ts apps/runtime/src/orchestration/worker.ts apps/runtime/src/runtime.ts apps/runtime/src/composition.ts apps/runtime/test/helpers/runtime.ts apps/runtime/test/repair-worker.test.ts apps/runtime/test/evidence-worker.test.ts apps/runtime/test/recovery.test.ts apps/runtime/test/shutdown.test.ts
git commit -m "feat(runtime): retry evidence independently"
```

### Task 6: Migrate persisted failures and expose Retry evidence

**Files:**
- Modify: `apps/runtime/src/orchestration/recovery.ts`
- Modify: `apps/runtime/src/orchestration/commands.ts`
- Modify: `apps/runtime/test/recovery.test.ts`
- Modify: `apps/runtime/test/commands.test.ts`
- Modify: `apps/runtime/test/acceptance/restart-flow.test.ts`

- [ ] **Step 1: Write failing migration and command tests**

Seed and assert these exact mappings:

```ts
[
  {
    before: { status: "REPAIR_FAILED", lastFailure: { stage: "REPAIR", code: "RUNTIME_INTERRUPTED" } },
    after: { status: "REPAIRING", pending: "REPAIR" },
  },
  {
    before: {
      status: "REPAIR_FAILED",
      lastFailure: { stage: "REPAIR", code: "EVIDENCE_RETRY_LIMIT_REACHED" },
      repair: { iteration: 2, delivery },
    },
    after: { status: "EVIDENCE_FAILED", pending: null },
  },
]
```

Call recovery twice and assert exactly one `ISSUE_EVIDENCE_STATE_MIGRATED` event. Add a command test asserting `retryIssue(EVIDENCE_FAILED)` becomes `EVIDENCE_CAPTURE` with pending `CAPTURE_EVIDENCE`, while `retryIssue(REPAIR_FAILED)` remains pending `REPAIR`.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/recovery.test.ts test/commands.test.ts
```

Expected: FAIL because legacy failures are left unchanged and Retry has no evidence branch.

- [ ] **Step 3: Add idempotent compatibility migration**

Before active-state reconciliation, scan failures and use optimistic revisions. For evidence failures, derive the draft from the existing delivery:

```ts
const migrated = {
  ...issue,
  status: "EVIDENCE_FAILED" as const,
  repair: {
    ...issue.repair!,
    evidenceRetries: issue.repair?.automaticEvidenceRetries ?? 0,
    deliveryDraft: issue.repair?.deliveryDraft ?? {
      summary: issue.repair!.delivery!.summary,
      repairIteration: issue.repair!.iteration,
      implementationCompletedAt: issue.updatedAt,
    },
  },
  lastFailure: {
    stage: "EVIDENCE" as const,
    code: issue.lastFailure!.code,
  },
  revision: issue.revision + 1,
  updatedAt: dependencies.now(),
};
```

Recognize the complete evidence-code set from `EvidenceCaptureFailureCode` plus the legacy `EVIDENCE_INTAKE_FAILED`, `EVIDENCE_IMPORT_FAILED`, and `EVIDENCE_RETRY_LIMIT_REACHED`. Only migrate when a final delivery exists. Convert `RUNTIME_INTERRUPTED` Repair failures with no evidence code back to `REPAIRING`/`REPAIR`.

- [ ] **Step 4: Add Retry evidence command routing**

Extend `retryIssue`:

```ts
if (issue.status === "EVIDENCE_FAILED" && issue.repair?.deliveryDraft) {
  return this.change(issueId, "EVIDENCE_RETRIED", "CAPTURE_EVIDENCE", (current, now) =>
    retryEvidence(current, now));
}
```

Do not expose a Repair retry from `EVIDENCE_FAILED`; the implementation draft remains authoritative.

- [ ] **Step 5: Run recovery and command tests**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/recovery.test.ts test/commands.test.ts test/acceptance/restart-flow.test.ts
```

Expected: PASS and the second Runtime start performs no additional migration.

- [ ] **Step 6: Commit compatibility behavior**

```bash
git add apps/runtime/src/orchestration/recovery.ts apps/runtime/src/orchestration/commands.ts apps/runtime/test/recovery.test.ts apps/runtime/test/commands.test.ts apps/runtime/test/acceptance/restart-flow.test.ts
git commit -m "fix(runtime): migrate legacy evidence failures"
```

### Task 7: Add capture configuration and evidence-specific UI

**Files:**
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/test/web/projects.test.tsx`
- Modify: `apps/desktop/src/web/issues/issue-status.tsx`
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`
- Modify: `apps/desktop/src/web/issues/agent-activity.tsx`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/test/web/issues.test.tsx`
- Modify: `apps/desktop/test/web/agent-activity.test.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Write failing settings and Issue UI tests**

In project settings, select `命令与验收`, choose each capture mode, and assert save payloads:

```ts
expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
  commands: expect.objectContaining({
    evidenceCapture: {
      mode: "browser",
      label: "支付页",
      timeoutMs: 15000,
    },
  }),
}));
```

Render `EVIDENCE_CAPTURE` and `EVIDENCE_FAILED` Issues and assert:

```ts
expect(screen.getByText("实现完成，正在采集证据")).toBeVisible();
expect(screen.getByText("证据采集失败；实现改动已保留")).toBeVisible();
expect(screen.getByRole("button", { name: "重试证据" })).toBeEnabled();
expect(screen.queryByRole("button", { name: "重新实现" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run Web tests and verify RED**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/projects.test.tsx test/web/issues.test.tsx test/web/agent-activity.test.tsx test/web/app-workbench.test.tsx
```

Expected: FAIL because the DTO union and UI maps do not cover the new states/configuration.

- [ ] **Step 3: Add capture-mode settings**

Under the existing command inputs, add a `Select` labeled `证据采集方式` with values `agent`, `browser`, `electron`, and `command`. `agent` deletes `commands.evidenceCapture`. Other modes render `证据标签`, `超时（毫秒）`, plus `Electron 入口` or `证据命令` as required. Browser mode displays a note that `启动命令` and a localhost `验收 URL` are required.

Normalize empty strings out of the union before `onSave`; use `15000` as the default timeout.

- [ ] **Step 4: Add evidence status and action routing**

Use these labels:

```ts
EVIDENCE_CAPTURE: "实现完成，正在采集证据",
EVIDENCE_CHECK: "证据检查中",
EVIDENCE_FAILED: "证据采集失败",
```

Treat `EVIDENCE_CAPTURE` and `EVIDENCE_CHECK` as active/cancelable in `app.tsx` and `issue-detail.tsx`. For `EVIDENCE_FAILED`, render:

```tsx
<Alert variant="destructive">
  <AlertDescription>证据采集失败；实现改动和工作目录已保留。</AlertDescription>
</Alert>
<Button type="button" onClick={onRetry}>重试证据</Button>
```

Replace `retryLabel` with this complete status mapping:

```ts
const retryLabel = sessionUnavailable
  ? undefined
  : issue.status === "ASSESSMENT_FAILED"
    ? "重试分析"
    : issue.status === "REPAIR_FAILED"
      ? "重试实现"
      : issue.status === "EVIDENCE_FAILED"
        ? "重试证据"
        : undefined;
```

- [ ] **Step 5: Add activity labels**

Add:

```ts
IMPLEMENTATION_READY: "实现完成，准备采集证据",
EVIDENCE_CAPTURE_STARTED: "开始采集验证证据",
EVIDENCE_CAPTURE_REQUEUED: "证据未通过，正在重新采集",
EVIDENCE_FAILED: "证据采集失败；实现改动已保留",
EVIDENCE_RETRIED: "正在重新采集证据",
```

Map Agent stage `EVIDENCE` to Codex while preserving the existing actor display.

- [ ] **Step 6: Run Web tests**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/projects.test.tsx test/web/issues.test.tsx test/web/agent-activity.test.tsx test/web/app-workbench.test.tsx
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: PASS for all new statuses, labels, settings, and Retry routing.

- [ ] **Step 7: Commit UI behavior**

```bash
git add apps/desktop/src/web/projects/project-form.tsx apps/desktop/src/web/issues apps/desktop/src/web/app.tsx apps/desktop/test/web
git commit -m "feat(desktop): expose evidence capture recovery"
```

### Task 8: Prove the independent evidence lifecycle end to end

**Files:**
- Modify: `apps/runtime/test/acceptance/manual-full-flow.test.ts`
- Create: `apps/runtime/test/acceptance/evidence-capture-flow.test.ts`
- Modify: `apps/desktop/test/electron/e2e/manual-workflow.spec.ts`

- [ ] **Step 1: Add SQLite-backed acceptance scenarios**

Create tests with these exact outcome matrices:

```ts
it.each([
  "browser",
  "electron",
  "command",
] as const)("captures %s evidence without rerunning Repair", async (mode) => {
  const configured = await captureProject(mode);
  const databasePath = temporaryDatabase(`omb-evidence-${mode}-`);
  const projectRoot = join(dirname(databasePath), "project");
  mkdirSync(projectRoot);
  for (const name of [
    "browser-server.cjs",
    "electron-main.cjs",
    "electron.html",
    "write-png.cjs",
  ]) cpSync(join(fixtures, name), join(projectRoot, name));
  const agent = new FakeAgent();
  agent.nextRepairResult = { summary: "Implemented", evidence: [] };
  const runtime = createRuntime({
    ...runtimeOptions(databasePath, agent),
    evidenceCapture: new PlaywrightEvidenceCaptureProvider(),
  });
  runtime.registerProject({ ...configured, path: projectRoot });
  await runtime.start();
  const issue = await createApprovedIssue(runtime, configured);
  await runtime.drain();

  expect(runtime.getIssue(issue.id)).toMatchObject({
    status: "ACCEPTANCE_REVIEW",
    repair: { iteration: 1, deliveryDraft: { summary: "Implemented" } },
  });
  expect(agent.repairSessions).toEqual(["session-1"]);
  await runtime.stop();
});

it("restarts during evidence capture with the same draft and retry count", async () => {
  const before = runtime.getIssue(issue.id);
  expect(before).toMatchObject({
    status: "EVIDENCE_CAPTURE",
    repair: { iteration: 1, evidenceRetries: 1 },
  });
  await runtime.stop();
  await reopened.start();
  await reopened.drain();
  expect(reopened.getIssue(issue.id)).toMatchObject({
    status: "ACCEPTANCE_REVIEW",
    repair: { iteration: 1, deliveryDraft: before.repair!.deliveryDraft },
  });
});
```

Define `createApprovedIssue` in the same file:

```ts
async function createApprovedIssue(
  runtime: ReturnType<typeof createRuntime>,
  configured: RuntimeProject,
) {
  const created = await runtime.submitManual(configured.id, {
    commandId: `evidence-${configured.id}`,
    content: "Capture acceptance evidence",
  });
  if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
  await runtime.drain();
  const assessed = runtime.getIssue(created.issue.id);
  runtime.approveAssessment(assessed.id, {
    assessmentRevision: assessed.assessment!.revision,
    assessmentContentHash: assessed.assessment!.contentHash,
    title: assessed.assessment!.suggestedTitle,
  });
  return runtime.getIssue(assessed.id);
}
```

Add a retry-limit case that asserts:

```ts
expect(runtime.getIssue(issue.id)).toMatchObject({
  status: "EVIDENCE_FAILED",
  projectPath: expect.any(String),
  repair: {
    iteration: 1,
    deliveryDraft: { summary: "Implemented" },
  },
});
expect(agent.repairSessions).toEqual(["session-1"]);
runtime.retryIssue(issue.id);
captureProvider.nextError = undefined;
await runtime.drain();
expect(runtime.getIssue(issue.id)?.status).toBe("ACCEPTANCE_REVIEW");
expect(agent.repairSessions).toEqual(["session-1"]);
```

- [ ] **Step 2: Run acceptance tests and verify RED**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/acceptance/evidence-capture-flow.test.ts test/acceptance/manual-full-flow.test.ts
```

Expected before final fixture wiring: FAIL at the first missing capture fixture or composition dependency, not in Core transitions.

- [ ] **Step 3: Wire deterministic acceptance fixtures**

Define the project factory used by Step 1:

```ts
async function captureProject(
  mode: "browser" | "electron" | "command",
): Promise<RuntimeProject> {
  const browserPort = await reservePort();
  const configuredProjects = {
    browser: {
    ...project,
    id: "capture-browser",
    key: "BROWSER",
    commands: {
      start: `PORT=${browserPort} node browser-server.cjs`,
      acceptanceUrl: `http://127.0.0.1:${browserPort}`,
      evidenceCapture: { mode: "browser", label: "Browser proof", timeoutMs: 15_000 },
    },
    },
    electron: {
    ...project,
    id: "capture-electron",
    key: "ELECTRON",
    commands: {
      evidenceCapture: {
        mode: "electron",
        label: "Electron proof",
        electronEntry: "electron-main.cjs",
        timeoutMs: 15_000,
      },
    },
    },
    command: {
    ...project,
    id: "capture-command",
    key: "COMMAND",
    commands: {
      evidenceCapture: {
        mode: "command",
        label: "Command proof",
        command: "node write-png.cjs",
        timeoutMs: 15_000,
      },
    },
    },
  } satisfies Record<"browser" | "electron" | "command", RuntimeProject>;
  return configuredProjects[mode];
}
```

Import the Electron executable from the declared test dependency when constructing the real provider. Every test registers its own temporary project/evidence root and removes only that temporary directory in `afterEach`.

In the desktop E2E workflow, configure Agent-driven evidence, complete the demo flow, and assert the activity order:

```ts
expect(activity).toContainText("实现完成，准备采集证据");
expect(activity).toContainText("开始采集验证证据");
expect(activity).toContainText("验证证据已通过");
```

- [ ] **Step 4: Run affected acceptance and E2E tests**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/acceptance/evidence-capture-flow.test.ts test/acceptance/manual-full-flow.test.ts
pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/test/electron/e2e/manual-workflow.spec.ts
```

Expected: PASS; all three host modes and Agent fallback produce real, inspectable media, and Repair runs once per implementation iteration.

- [ ] **Step 5: Commit acceptance coverage**

```bash
git add apps/runtime/test/acceptance/evidence-capture-flow.test.ts apps/runtime/test/acceptance/manual-full-flow.test.ts apps/desktop/test/electron/e2e/manual-workflow.spec.ts
git commit -m "test: cover independent evidence capture"
```

### Task 9: Run the complete verification gate

**Files:**
- Verify only; no new product files.

- [ ] **Step 1: Run package suites**

```bash
pnpm --filter @oh-my-bug/core test
pnpm --filter @oh-my-bug/storage test
pnpm --filter @oh-my-bug/agent-codex test
pnpm --filter @oh-my-bug/runtime test
pnpm --filter @oh-my-bug/desktop test
```

Expected: every suite exits zero.

- [ ] **Step 2: Run static verification**

```bash
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all commands exit zero and `git diff --check` is silent.

- [ ] **Step 3: Audit the forbidden legacy loop**

```bash
rg -n 'EVIDENCE_REJECTED.*REPAIR|automaticEvidenceRetries|pending.*"REPAIR"' apps/runtime/src packages/core/src
rg -n 'CAPTURE_EVIDENCE|EVIDENCE_FAILED|deliveryDraft|captureEvidence' apps packages
```

Expected: the first search finds only compatibility migration/schema references, never a worker path that reruns Repair for evidence; the second search shows Core, Runtime, Agent, protocol, UI, and tests.

- [ ] **Step 4: Inspect final repository state**

```bash
git status --short
git log --oneline -12
```

Expected: no uncommitted product changes and a sequence of focused commits matching Tasks 1–8.
