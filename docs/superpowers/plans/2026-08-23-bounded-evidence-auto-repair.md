# Bounded Evidence Auto-Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Evidence classify acceptance failures, return real defects to a five-round automatic Repair loop, keep environment failures on the existing two-retry Evidence loop, and stop every Agent Evidence turn after five minutes.

**Architecture:** Extend the Core Agent contract with a discriminated Evidence outcome and add explicit Evidence-to-Repair transitions. Keep Codex unrestricted only for Evidence, but give that turn a strict no-mutation prompt, a file-change policy, a five-minute abort timer, and an isolated temporary run directory. Runtime consumes the outcome, sanitizes diagnostics, and atomically queues either Repair or another Evidence attempt.

**Tech Stack:** TypeScript, Zod, `@openai/codex-sdk`, Vitest, SQLite-backed Runtime tests, pnpm, oxlint

---

### Task 1: Add Core Evidence Outcomes and Repair-Loop State

**Files:**
- Modify: `packages/core/src/agent/adapter.ts`
- Modify: `packages/core/src/issue/types.ts`
- Modify: `packages/core/src/issue/schema.ts`
- Modify: `packages/core/src/issue/workflow.ts`
- Modify: `packages/core/src/issue/results.ts`
- Modify: `packages/core/test/issue/schema.test.ts`
- Modify: `packages/core/test/issue/workflow.test.ts`
- Modify: `packages/core/test/issue/results.test.ts`

- [ ] **Step 1: Write failing tests for the automatic Repair transition**

In `packages/core/test/issue/workflow.test.ts`, add transition coverage for:

```ts
    ["EVIDENCE_CAPTURE", "EVIDENCE_DEFECT", "REPAIRING"],
    ["EVIDENCE_CAPTURE", "AUTOMATIC_REPAIR_EXHAUSTED", "REPAIR_FAILED"],
```

In `packages/core/test/issue/results.test.ts`, import the new result helpers and add:

```ts
  it("returns an Evidence defect to a fresh bounded Repair iteration", () => {
    const current: Issue = {
      ...issueAt("EVIDENCE_CAPTURE"),
      repair: {
        iteration: 4,
        evidenceRetries: 2,
        automaticRepairRetries: 2,
        deliveryDraft: draft,
        delivery,
      },
    };

    const next = recordEvidenceDefect(
      current,
      "PRODUCT_DEFECT: shortcut does not toggle the rail",
      now,
    );

    expect(next).toMatchObject({
      status: "REPAIRING",
      repair: {
        iteration: 5,
        evidenceRetries: 0,
        automaticRepairRetries: 3,
        feedback: "PRODUCT_DEFECT: shortcut does not toggle the rail",
      },
      lastFailure: undefined,
    });
    expect(next.repair?.delivery).toBeUndefined();
    expect(next.repair?.deliveryDraft).toBeUndefined();
  });

  it("stops automatic Repair after five Evidence defects", () => {
    const failed = recordAutomaticRepairExhaustion({
      ...issueAt("EVIDENCE_CAPTURE"),
      repair: { iteration: 7, automaticRepairRetries: 5, deliveryDraft: draft },
    }, "PRODUCT_DEFECT: still broken", now);

    expect(failed).toMatchObject({
      status: "REPAIR_FAILED",
      repair: {
        iteration: 7,
        automaticRepairRetries: 5,
        feedback: "PRODUCT_DEFECT: still broken",
        deliveryDraft: draft,
      },
      lastFailure: { stage: "REPAIR", code: "AUTOMATIC_REPAIR_LIMIT_REACHED" },
    });
  });
```

Extend the existing implementation-draft test with:

```ts
const drafted = recordImplementationDraft(
  {
    ...issueAt("REPAIRING"),
    repair: { iteration: 2, automaticRepairRetries: 3 },
  },
  delivery.summary,
  now,
);
expect(drafted.repair?.automaticRepairRetries).toBe(3);

const accepted = recordEvidenceAcceptance({
  ...recordDelivery(drafted, delivery, now),
  status: "EVIDENCE_CHECK",
}, now);
expect(accepted.repair?.automaticRepairRetries).toBeUndefined();
```

Extend `packages/core/test/issue/schema.test.ts` with `automaticRepairRetries: 5` in a valid Issue fixture.

- [ ] **Step 2: Run the focused Core tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/workflow.test.ts test/issue/results.test.ts test/issue/schema.test.ts
```

Expected: FAIL because the two actions, result helpers, and `automaticRepairRetries` schema field do not exist.

- [ ] **Step 3: Define the discriminated Evidence result contract**

Replace the current single-shape `EvidenceCaptureResult` in `packages/core/src/agent/adapter.ts` with:

```ts
export type EvidenceEnvironmentFailureCode =
  | "EVIDENCE_TARGET_UNREACHABLE"
  | "EVIDENCE_CAPTURE_PERMISSION_DENIED"
  | "EVIDENCE_CAPTURE_PROCESS_FAILED"
  | "EVIDENCE_CAPTURE_TIMEOUT";

export type EvidenceCaptureResult =
  | { outcome: "CAPTURED"; evidence: RepairEvidencePath[] }
  | {
      outcome: "PRODUCT_DEFECT" | "ACCEPTANCE_DEFECT";
      diagnosis: string;
      code?: "EVIDENCE_WORKSPACE_MUTATION";
      failedCommand?: string;
      errorSummary?: string;
    }
  | {
      outcome: "ENVIRONMENT_FAILURE";
      diagnosis: string;
      code: EvidenceEnvironmentFailureCode;
      failedCommand?: string;
      errorSummary?: string;
    };
```

Keep `RepairEvidencePath` imported because only `CAPTURED` carries paths.

- [ ] **Step 4: Add the persisted counter and state transitions**

Add this optional field to `RepairState` in `packages/core/src/issue/types.ts` and to the strict repair object in `packages/core/src/issue/schema.ts`:

```ts
automaticRepairRetries?: number;
```

```ts
automaticRepairRetries: z.number().int().nonnegative().optional(),
```

Append these two literals to the existing `IssueAction` union in `packages/core/src/issue/workflow.ts`:

```ts
  | "EVIDENCE_DEFECT"
  | "AUTOMATIC_REPAIR_EXHAUSTED"
```

Add these `EVIDENCE_CAPTURE` transitions:

```ts
EVIDENCE_DEFECT: "REPAIRING",
AUTOMATIC_REPAIR_EXHAUSTED: "REPAIR_FAILED",
```

Include `EVIDENCE_DEFECT` in `startsRepairIteration`. Do not include `AUTOMATIC_REPAIR_EXHAUSTED`, because exhausting the budget must not create a sixth Repair iteration.

- [ ] **Step 5: Implement Core result reducers**

Add to `packages/core/src/issue/results.ts`:

```ts
export function recordEvidenceDefect(
  issue: Issue,
  feedbackInput: string,
  now: string,
): Issue {
  const feedback = required(feedbackInput, "FEEDBACK_REQUIRED");
  const next = transitionIssue(issue, "EVIDENCE_DEFECT", now);
  return {
    ...next,
    repair: {
      iteration: next.repair?.iteration ?? (issue.repair?.iteration ?? 0) + 1,
      evidenceRetries: 0,
      automaticRepairRetries: (issue.repair?.automaticRepairRetries ?? 0) + 1,
      feedback,
    },
    lastFailure: undefined,
  };
}

export function recordAutomaticRepairExhaustion(
  issue: Issue,
  feedbackInput: string,
  now: string,
): Issue {
  const feedback = required(feedbackInput, "FEEDBACK_REQUIRED");
  const next = transitionIssue(issue, "AUTOMATIC_REPAIR_EXHAUSTED", now);
  return withFailure(
    {
      ...next,
      repair: { ...(issue.repair ?? { iteration: 1 }), feedback },
    },
    { stage: "REPAIR", code: "AUTOMATIC_REPAIR_LIMIT_REACHED" },
  );
}
```

Add this spread to both `recordImplementationDraft` and `recordDelivery` so a completed automatic Repair does not lose its loop count:

```ts
...(issue.repair?.automaticRepairRetries !== undefined
  ? { automaticRepairRetries: issue.repair.automaticRepairRetries }
  : {}),
```

Replace `recordEvidenceAcceptance` with:

```ts
export function recordEvidenceAcceptance(issue: Issue, now: string): Issue {
  const accepted = transitionIssue(issue, "EVIDENCE_ACCEPTED", now);
  if (!accepted.repair) return accepted;
  const { automaticRepairRetries: _automaticRepairRetries, ...repair } = accepted.repair;
  return { ...accepted, repair };
}
```

The existing `RETRY_REPAIR` reducer already creates a new repair object and therefore resets the counter for an explicit user retry; add an assertion documenting that behavior.

- [ ] **Step 6: Run Core tests and type checking**

Run:

```bash
pnpm --filter @oh-my-bug/core test
pnpm --filter @oh-my-bug/core typecheck
```

Expected: all Core tests pass and `tsc --noEmit` exits zero.

- [ ] **Step 7: Commit the Core contract**

```bash
git add packages/core/src/agent/adapter.ts packages/core/src/issue/types.ts packages/core/src/issue/schema.ts packages/core/src/issue/workflow.ts packages/core/src/issue/results.ts packages/core/test/issue/schema.test.ts packages/core/test/issue/workflow.test.ts packages/core/test/issue/results.test.ts
git commit -m "feat(core): model bounded evidence repair outcomes"
```

### Task 2: Parse Structured Codex Evidence Outcomes

**Files:**
- Modify: `packages/agent-codex/src/output-schemas.ts`
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`
- Modify: `packages/agent-codex/src/prompts.ts`
- Modify: `packages/agent-codex/test/evidence.test.ts`
- Create: `packages/agent-codex/test/evidence-output.test.ts`

- [ ] **Step 1: Write failing parser tests for all four outcomes**

Create `packages/agent-codex/test/evidence-output.test.ts`. Test one valid flat structured-output object for each outcome and reject a mixed result:

```ts
const emptyDetails = {
  diagnosis: null,
  code: null,
  failedCommand: null,
  errorSummary: null,
};

expect(parseEvidenceOutput({
  outcome: "CAPTURED",
  evidence: [{ type: "screenshot", label: "Rail", relativePath: "rail.png" }],
  ...emptyDetails,
})).toMatchObject({ outcome: "CAPTURED", evidence: [{ relativePath: "rail.png" }] });

expect(parseEvidenceOutput({
  outcome: "PRODUCT_DEFECT",
  evidence: [],
  diagnosis: "The shortcut leaves the rail open.",
  code: null,
  failedCommand: "pnpm test:e2e",
  errorSummary: "Expected hidden, received visible",
})).toMatchObject({ outcome: "PRODUCT_DEFECT" });

expect(parseEvidenceOutput({
  outcome: "ACCEPTANCE_DEFECT",
  evidence: [],
  diagnosis: "The fixture targets a removed selector.",
  code: null,
  failedCommand: "pnpm test:e2e",
  errorSummary: "Selector not found",
})).toMatchObject({ outcome: "ACCEPTANCE_DEFECT" });

expect(parseEvidenceOutput({
  outcome: "ENVIRONMENT_FAILURE",
  evidence: [],
  diagnosis: "Electron utility did not become ready.",
  code: "EVIDENCE_CAPTURE_PROCESS_FAILED",
  failedCommand: "pnpm test:e2e:electron",
  errorSummary: "UTILITY_NOT_READY",
})).toMatchObject({ outcome: "ENVIRONMENT_FAILURE" });

expect(() => parseEvidenceOutput({
  outcome: "PRODUCT_DEFECT",
  evidence: [{ type: "screenshot", label: "Invalid", relativePath: "invalid.png" }],
  diagnosis: "Mixed result",
  code: null,
  failedCommand: null,
  errorSummary: null,
})).toThrow("EVIDENCE_OUTCOME_CONTRADICTORY");
```

Also test the 4,000-character diagnosis/error limit, 2,000-character command limit, and invalid environment code.

- [ ] **Step 2: Run the parser test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/evidence-output.test.ts
```

Expected: FAIL because the current parser accepts only `{ evidence }`.

- [ ] **Step 3: Replace the Evidence JSON schema with a flat discriminated object**

In `packages/agent-codex/src/output-schemas.ts`, make all fields required because Codex structured output already represents optional values as `null`:

```ts
export const evidenceOutputSchema = {
  type: "object",
  properties: {
    outcome: {
      type: "string",
      enum: ["CAPTURED", "PRODUCT_DEFECT", "ACCEPTANCE_DEFECT", "ENVIRONMENT_FAILURE"],
    },
    evidence: {
      type: "array",
      minItems: 0,
      maxItems: 20,
      items: repairOutputSchema.properties.evidence.items,
    },
    diagnosis: { type: ["string", "null"], maxLength: 4000 },
    code: {
      type: ["string", "null"],
      enum: [
        "EVIDENCE_TARGET_UNREACHABLE",
        "EVIDENCE_CAPTURE_PERMISSION_DENIED",
        "EVIDENCE_CAPTURE_PROCESS_FAILED",
        null,
      ],
    },
    failedCommand: { type: ["string", "null"], maxLength: 2000 },
    errorSummary: { type: ["string", "null"], maxLength: 4000 },
  },
  required: ["outcome", "evidence", "diagnosis", "code", "failedCommand", "errorSummary"],
  additionalProperties: false,
} as const;
```

Do not expose `EVIDENCE_CAPTURE_TIMEOUT` or `EVIDENCE_WORKSPACE_MUTATION` to the model schema; the adapter generates those codes.

- [ ] **Step 4: Implement strict outcome parsing**

Make `parseEvidenceOutput` return Core's `EvidenceCaptureResult`. Add a `boundedOptionalString` helper and implement the six-key parser as follows:

```ts
export function parseEvidenceOutput(value: unknown): EvidenceCaptureResult {
  const object = strictObject(value, [
    "outcome", "evidence", "diagnosis", "code", "failedCommand", "errorSummary",
  ]);
  const outcome = requiredString(object.outcome, "EVIDENCE_OUTCOME_INVALID");
  if (!Array.isArray(object.evidence) || object.evidence.length > 20) {
    throw new Error("VISUAL_EVIDENCE_INVALID");
  }
  const evidence = object.evidence.map(parseEvidenceItem);
  const diagnosis = boundedOptionalString(
    object.diagnosis,
    4000,
    "EVIDENCE_DIAGNOSIS_TOO_LONG",
  );
  const code = boundedOptionalString(object.code, 100, "EVIDENCE_FAILURE_CODE_INVALID");
  const failedCommand = boundedOptionalString(
    object.failedCommand,
    2000,
    "EVIDENCE_COMMAND_TOO_LONG",
  );
  const errorSummary = boundedOptionalString(
    object.errorSummary,
    4000,
    "EVIDENCE_ERROR_SUMMARY_TOO_LONG",
  );

  if (outcome === "CAPTURED") {
    if (
      evidence.length === 0 || diagnosis || code || failedCommand || errorSummary
    ) throw new Error("EVIDENCE_OUTCOME_CONTRADICTORY");
    return { outcome, evidence };
  }
  if (outcome === "PRODUCT_DEFECT" || outcome === "ACCEPTANCE_DEFECT") {
    if (evidence.length > 0 || code) throw new Error("EVIDENCE_OUTCOME_CONTRADICTORY");
    if (!diagnosis) throw new Error("EVIDENCE_DIAGNOSIS_REQUIRED");
    return {
      outcome,
      diagnosis,
      ...(failedCommand ? { failedCommand } : {}),
      ...(errorSummary ? { errorSummary } : {}),
    };
  }
  if (outcome === "ENVIRONMENT_FAILURE") {
    const allowed = [
      "EVIDENCE_TARGET_UNREACHABLE",
      "EVIDENCE_CAPTURE_PERMISSION_DENIED",
      "EVIDENCE_CAPTURE_PROCESS_FAILED",
    ];
    if (evidence.length > 0) throw new Error("EVIDENCE_OUTCOME_CONTRADICTORY");
    if (!diagnosis) throw new Error("EVIDENCE_DIAGNOSIS_REQUIRED");
    if (!code || !allowed.includes(code)) throw new Error("EVIDENCE_FAILURE_CODE_INVALID");
    return {
      outcome,
      diagnosis,
      code: code as EvidenceEnvironmentFailureCode,
      ...(failedCommand ? { failedCommand } : {}),
      ...(errorSummary ? { errorSummary } : {}),
    };
  }
  throw new Error("EVIDENCE_OUTCOME_INVALID");
}

function boundedOptionalString(
  value: unknown,
  maxLength: number,
  tooLongCode: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const result = requiredString(value, tooLongCode);
  if (result.length > maxLength) throw new Error(tooLongCode);
  return result;
}
```

Use stable errors `EVIDENCE_OUTCOME_CONTRADICTORY`, `EVIDENCE_DIAGNOSIS_REQUIRED`, `EVIDENCE_DIAGNOSIS_TOO_LONG`, `EVIDENCE_COMMAND_TOO_LONG`, `EVIDENCE_ERROR_SUMMARY_TOO_LONG`, and `EVIDENCE_FAILURE_CODE_INVALID`.

- [ ] **Step 5: Update the adapter and strict Evidence prompt**

In `CodexAgentAdapter.captureEvidence`, return non-captured parsed outcomes unchanged. For `CAPTURED`, validate every relative path before returning:

```ts
if (output.outcome !== "CAPTURED") return output;
return {
  outcome: "CAPTURED",
  evidence: output.evidence.map((evidence) => ({
    type: evidence.type,
    label: evidence.label,
    relativePath: validateEvidencePath(evidence.relativePath),
  })),
};
```

Replace the first part of `evidencePrompt` with explicit instructions:

```ts
"Run acceptance and capture real visual evidence for the already completed implementation.",
"Evidence is verification-only. Do not modify product code, tests, fixtures, configuration, dependencies, generated bundles, or Git state.",
"Do not weaken or rewrite acceptance criteria. If product behavior is wrong, return PRODUCT_DEFECT. If the verifier or fixture is wrong, return ACCEPTANCE_DEFECT. If startup, ports, permissions, dependencies, or infrastructure prevent acceptance, return ENVIRONMENT_FAILURE.",
"Run acceptance processes in the foreground and stop them before returning.",
"For Electron, use a user-data directory below $CODEX_EVIDENCE_RUN_DIR and isolate application runtime data there when the project supports an override.",
```

Remove the old sentence permitting product modification.

- [ ] **Step 6: Update Evidence adapter coverage and verify GREEN**

Change the fixture output in `packages/agent-codex/test/evidence.test.ts` to the flat `CAPTURED` object with all nullable fields. Assert `result.outcome === "CAPTURED"`, retain the unrestricted permission assertion, and add prompt assertions for `Do not modify product code` and `PRODUCT_DEFECT`.

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/evidence-output.test.ts test/evidence.test.ts
```

Expected: both files pass.

- [ ] **Step 7: Commit the structured output protocol**

```bash
git add packages/agent-codex/src/output-schemas.ts packages/agent-codex/src/codex-agent-adapter.ts packages/agent-codex/src/prompts.ts packages/agent-codex/test/evidence.test.ts packages/agent-codex/test/evidence-output.test.ts
git commit -m "feat(agent): classify evidence outcomes"
```

### Task 3: Bound and Isolate the Codex Evidence Turn

**Files:**
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`
- Modify: `packages/agent-codex/src/codex-client.ts`
- Modify: `packages/agent-codex/test/evidence.test.ts`
- Modify: `packages/agent-codex/test/codex-client.test.ts`
- Verify: `packages/agent-codex/test/cancellation.test.ts`

- [ ] **Step 1: Write failing timeout and file-mutation tests**

In `packages/agent-codex/test/evidence.test.ts`, add a fake-timer test using `FixtureClient([{ waitForAbort: true, error: new Error("SDK_ABORTED") }])` and construct the adapter with `evidenceTimeoutMs: 300_000`. Advance by `300_001` milliseconds and expect:

```ts
await expect(capture).resolves.toEqual({
  outcome: "ENVIRONMENT_FAILURE",
  diagnosis: "The Evidence turn exceeded 300000ms.",
  code: "EVIDENCE_CAPTURE_TIMEOUT",
});
expect(client.signals[0]?.aborted).toBe(true);
```

Add a fixture event stream containing a completed `file_change` for `apps/desktop/test/electron/e2e/rail.spec.ts`. Expect:

```ts
{
  outcome: "ACCEPTANCE_DEFECT",
  diagnosis: "Evidence attempted to modify files outside the Evidence intake directory.",
  code: "EVIDENCE_WORKSPACE_MUTATION",
  errorSummary: "apps/desktop/test/electron/e2e/rail.spec.ts",
}
```

Add a positive stream where the only changed path is below `input.evidenceDirectory`, followed by a valid `CAPTURED` Agent message. It must not abort.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/evidence.test.ts test/codex-client.test.ts
```

Expected: FAIL because the adapter has no Evidence policy or private danger-mode temp.

- [ ] **Step 3: Add Evidence policy errors and timer configuration**

Add `evidenceTimeoutMs?: number` to `CodexAgentAdapterOptions`; default it to `300_000` and reject non-positive or non-finite values in the constructor.

Add an internal policy type and error:

```ts
interface EvidenceTurnPolicy {
  timeoutMs: number;
  workingDirectory: string;
  evidenceDirectory: string;
}

class EvidencePolicyError extends Error {
  constructor(readonly result: Exclude<EvidenceCaptureResult, { outcome: "CAPTURED" }>) {
    super(result.code ?? result.outcome);
  }
}
```

Pass the policy only from `captureEvidence`. In `turn`, start a timer that aborts the active controller with an `EvidencePolicyError` carrying `EVIDENCE_CAPTURE_TIMEOUT`. Always clear the timer in `finally`. In `captureEvidence`, catch only `EvidencePolicyError` and return its result; user cancellation and Runtime interruption must still throw.

Create and clear the timer beside the existing `AbortController`:

```ts
const timeout = policy
  ? setTimeout(() => {
      abort.abort(new EvidencePolicyError({
        outcome: "ENVIRONMENT_FAILURE",
        diagnosis: `The Evidence turn exceeded ${policy.timeoutMs}ms.`,
        code: "EVIDENCE_CAPTURE_TIMEOUT",
      }));
    }, policy.timeoutMs)
  : undefined;

```

Add `if (timeout) clearTimeout(timeout);` as the first statement of the existing `finally` block.

- [ ] **Step 4: Abort Evidence file changes outside intake**

Before accepting an Evidence `file_change` event, normalize each path against the issue working directory:

```ts
function isPathWithin(directory: string, path: string, workingDirectory: string): boolean {
  const target = resolve(isAbsolute(path) ? path : resolve(workingDirectory, path));
  const scoped = relative(resolve(directory), target);
  return scoped === "" || (!scoped.startsWith("..") && !isAbsolute(scoped));
}
```

If any completed file-change path falls outside `evidenceDirectory`, abort with `EVIDENCE_WORKSPACE_MUTATION`. Include only bounded, normalized relative path summaries in `errorSummary`; never return an absolute path.

Place this check inside the event loop before accepting an Agent message:

```ts
if (
  policy &&
  event.type === "item.completed" &&
  event.item.type === "file_change"
) {
  const unsafe = event.item.paths.filter((path) =>
    !isPathWithin(policy.evidenceDirectory, path, policy.workingDirectory));
  if (unsafe.length > 0) {
    const summary = unsafe
      .map((path) => publicChangedPath(path, policy.workingDirectory))
      .join("\n")
      .slice(0, 4000);
    abort.abort(new EvidencePolicyError({
      outcome: "ACCEPTANCE_DEFECT",
      diagnosis: "Evidence attempted to modify files outside the Evidence intake directory.",
      code: "EVIDENCE_WORKSPACE_MUTATION",
      errorSummary: summary,
    }));
    assertActive(abort.signal);
  }
}
```

Add this helper and import `basename` from `node:path` so paths outside the issue workspace cannot expose a private parent directory:

```ts
function publicChangedPath(path: string, workingDirectory: string): string {
  const absolute = resolve(workingDirectory, path);
  const scoped = relative(resolve(workingDirectory), absolute);
  if (scoped.startsWith("..") || isAbsolute(scoped)) {
    return `[outside-workspace]/${basename(absolute)}`;
  }
  return scoped;
}
```

- [ ] **Step 5: Give unrestricted Evidence its own temporary run directory**

In `packages/agent-codex/src/codex-client.ts`, create the marked private temp for every non-read-only thread:

```ts
const privateTemp = options.sandboxMode === "read-only"
  ? undefined
  : mkdtempSync(join(options.workingDirectory, AGENT_PRIVATE_TEMP_PREFIX));
```

Extend `privateTempEnvironment` with the sandbox mode and set:

```ts
...(sandboxMode === "danger-full-access"
  ? { CODEX_EVIDENCE_RUN_DIR: privateTemp }
  : {}),
```

Keep `TMPDIR`, `TMP`, and `TEMP` pointed to the same directory. Export `privateTempEnvironment` from this module for focused unit coverage, but do not re-export it from the package root.

- [ ] **Step 6: Test environment injection and cleanup**

In `packages/agent-codex/test/codex-client.test.ts`, add:

```ts
expect(privateTempEnvironment({}, "/tmp/evidence-run", "danger-full-access"))
  .toMatchObject({
    TMPDIR: "/tmp/evidence-run",
    TMP: "/tmp/evidence-run",
    TEMP: "/tmp/evidence-run",
    CODEX_EVIDENCE_RUN_DIR: "/tmp/evidence-run",
  });
```

Add a lifecycle case for `danger-full-access` matching the existing writable-thread test: one private temp appears before the turn and is removed after `dispose()`.

- [ ] **Step 7: Verify guardrails and cancellation regressions**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/evidence.test.ts test/codex-client.test.ts test/cancellation.test.ts
pnpm --filter @oh-my-bug/agent-codex typecheck
```

Expected: all tests pass. Assessment and Repair still remain active past 900 seconds until explicitly canceled; only Evidence has the five-minute timer.

- [ ] **Step 8: Commit the Evidence execution boundary**

```bash
git add packages/agent-codex/src/codex-agent-adapter.ts packages/agent-codex/src/codex-client.ts packages/agent-codex/test/evidence.test.ts packages/agent-codex/test/codex-client.test.ts
git commit -m "fix(agent): bound evidence acceptance turns"
```

### Task 4: Route Outcomes Through Runtime with Safe Diagnostics

**Files:**
- Create: `apps/runtime/src/orchestration/evidence-diagnostics.ts`
- Create: `apps/runtime/test/evidence-diagnostics.test.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/test/evidence-worker.test.ts`
- Modify: `apps/runtime/test/helpers/fakes.ts`

- [ ] **Step 1: Write failing diagnostic and worker-routing tests**

In `apps/runtime/test/evidence-diagnostics.test.ts`, verify that formatting:

- includes outcome, diagnosis, failed command, and error summary;
- limits diagnosis/error to 4,000 characters and command to 2,000;
- replaces macOS, Unix, and Windows absolute paths with `[PATH]`;
- replaces bearer tokens and `KEY=value` secrets with `[REDACTED]`.

In `apps/runtime/test/evidence-worker.test.ts`, add one test for each non-captured outcome. For a product defect:

```ts
harness.agent.nextEvidenceResult = {
  outcome: "PRODUCT_DEFECT",
  diagnosis: "Shortcut leaves the rail visible.",
  failedCommand: "pnpm test:e2e",
  errorSummary: "Expected hidden, received visible",
};

await harness.worker.drainOne();

expect(harness.store.getIssue(harness.issue.id)).toMatchObject({
  status: "REPAIRING",
  repair: {
    iteration: 2,
    evidenceRetries: 0,
    automaticRepairRetries: 1,
    feedback: expect.stringContaining("Shortcut leaves the rail visible"),
  },
});
expect(harness.store.listPendingOperations()[0]?.operation).toBe("REPAIR");
```

Repeat for `ACCEPTANCE_DEFECT`. For `ENVIRONMENT_FAILURE`, assert status remains `EVIDENCE_CAPTURE`, `evidenceRetries` increments, Repair iteration and `automaticRepairRetries` do not change, and pending operation is `CAPTURE_EVIDENCE`.

Add a cap test starting at `automaticRepairRetries: 5`; another defect must produce `REPAIR_FAILED`, `AUTOMATIC_REPAIR_LIMIT_REACHED`, and no pending operation.

- [ ] **Step 2: Run focused Runtime tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/evidence-diagnostics.test.ts test/evidence-worker.test.ts
```

Expected: FAIL because diagnostics and outcome routing do not exist.

- [ ] **Step 3: Implement bounded diagnostic formatting**

Create `apps/runtime/src/orchestration/evidence-diagnostics.ts` with:

```ts
type FailedEvidenceOutcome = Exclude<EvidenceCaptureResult, { outcome: "CAPTURED" }>;

export interface PublicEvidenceDiagnosis {
  feedback: string;
  eventData: {
    outcome: FailedEvidenceOutcome["outcome"];
    code?: string;
    diagnosis: string;
    failedCommand?: string;
    errorSummary?: string;
  };
}

export function publicEvidenceDiagnosis(
  result: FailedEvidenceOutcome,
): PublicEvidenceDiagnosis {
  const diagnosis = sanitize(result.diagnosis, 4000);
  const failedCommand = result.failedCommand
    ? sanitize(result.failedCommand, 2000)
    : undefined;
  const errorSummary = result.errorSummary
    ? sanitize(result.errorSummary, 4000)
    : undefined;
  const eventData = {
    outcome: result.outcome,
    ...(result.code ? { code: result.code } : {}),
    diagnosis,
    ...(failedCommand ? { failedCommand } : {}),
    ...(errorSummary ? { errorSummary } : {}),
  };
  return {
    eventData,
    feedback: [
      `Evidence outcome: ${result.outcome}`,
      `Diagnosis: ${diagnosis}`,
      ...(failedCommand ? [`Failed command: ${failedCommand}`] : []),
      ...(errorSummary ? [`Error: ${errorSummary}`] : []),
    ].join("\n"),
  };
}

function sanitize(value: string, maxLength: number): string {
  return value
    .trim()
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(API_KEY|TOKEN|PASSWORD|SECRET)=[^\s"']+/gi,
      (_match, key: string) => `${key}=[REDACTED]`,
    )
    .replace(/\b[A-Za-z]:\\(?:[^\\\s"']+\\)*[^\\\s"']*/g, "[PATH]")
    .replace(/\/(?:Users|home|private|tmp)\/[^\s"']+/g, "[PATH]")
    .slice(0, maxLength);
}
```

Use this one sanitizer for both `feedback` and `eventData`; do not persist the unsanitized result anywhere in the Issue or event stream.

- [ ] **Step 4: Branch on Agent outcomes in `captureEvidence`**

Change the worker's local value from `RepairEvidencePath[]` to `EvidenceCaptureResult`. Wrap host capture as:

```ts
result = {
  outcome: "CAPTURED",
  evidence: [await this.captureWithHost(project, claimed, intake.directory)],
};
```

After the Agent or host returns:

```ts
if (result.outcome === "PRODUCT_DEFECT" || result.outcome === "ACCEPTANCE_DEFECT") {
  this.queueAutomaticRepair(claimed, result);
  return;
}
if (result.outcome === "ENVIRONMENT_FAILURE") {
  const diagnostic = publicEvidenceDiagnosis(result);
  const pendingEvents: PendingEvent[] = [{
    type: "EVIDENCE_ENVIRONMENT_FAILURE",
    actor: "AGENT",
    data: {
      ...diagnostic.eventData,
      iteration: claimed.repair?.iteration,
      evidenceRetries: claimed.repair?.evidenceRetries ?? 0,
      automaticRepairRetries: claimed.repair?.automaticRepairRetries ?? 0,
    },
  }];
  if (result.code === "EVIDENCE_CAPTURE_TIMEOUT") {
    pendingEvents.push({
      type: "EVIDENCE_CAPTURE_TIMED_OUT",
      actor: "AGENT",
      data: {
        code: result.code,
        iteration: claimed.repair?.iteration,
        evidenceRetries: claimed.repair?.evidenceRetries ?? 0,
        automaticRepairRetries: claimed.repair?.automaticRepairRetries ?? 0,
      },
    });
  }
  this.queueEvidenceCapture(
    claimed,
    diagnostic.feedback,
    result.code,
    pendingEvents,
  );
  return;
}
const delivered = await this.importDelivery(claimed, intake, result.evidence);
```

The `finally` block must still clean the intake for every branch.

- [ ] **Step 5: Implement the five-round automatic Repair transaction**

Add:

```ts
const MAX_AUTOMATIC_REPAIR_RETRIES = 5;
```

Implement `queueAutomaticRepair` as one store transaction. It must re-read the current revision, sanitize the outcome, and append the defect-detected event plus exactly one terminal/queued event:

```ts
private queueAutomaticRepair(
  previous: Issue,
  result: Extract<EvidenceCaptureResult, {
    outcome: "PRODUCT_DEFECT" | "ACCEPTANCE_DEFECT";
  }>,
): void {
  const diagnostic = publicEvidenceDiagnosis(result);
  this.dependencies.store.transaction((tx) => {
    const current = this.dependencies.store.getIssue(previous.id);
    if (!current || current.revision !== previous.revision) return;
    const detectedType = result.outcome === "PRODUCT_DEFECT"
      ? "EVIDENCE_PRODUCT_DEFECT_DETECTED"
      : "EVIDENCE_ACCEPTANCE_DEFECT_DETECTED";
    tx.appendEvent(this.event(current.id, detectedType, "AGENT", {
      ...diagnostic.eventData,
      iteration: current.repair?.iteration,
      evidenceRetries: current.repair?.evidenceRetries ?? 0,
      automaticRepairRetries: current.repair?.automaticRepairRetries ?? 0,
    }));

    if ((current.repair?.automaticRepairRetries ?? 0) >= MAX_AUTOMATIC_REPAIR_RETRIES) {
      const failed = recordAutomaticRepairExhaustion(
        current,
        diagnostic.feedback,
        this.dependencies.now(),
      );
      tx.updateIssue(failed, current.revision, null);
      tx.appendEvent(this.event(
        current.id,
        "AUTOMATIC_REPAIR_LIMIT_REACHED",
        "AGENT",
        {
          iteration: failed.repair?.iteration,
          evidenceRetries: failed.repair?.evidenceRetries ?? 0,
          automaticRepairRetries: failed.repair?.automaticRepairRetries,
        },
      ));
      return;
    }

    const next = recordEvidenceDefect(
      current,
      diagnostic.feedback,
      this.dependencies.now(),
    );
    tx.updateIssue(next, current.revision, "REPAIR");
    tx.appendEvent(this.event(
      current.id,
      "EVIDENCE_AUTOMATIC_REPAIR_QUEUED",
      "AGENT",
      {
        iteration: next.repair?.iteration,
        evidenceRetries: next.repair?.evidenceRetries,
        automaticRepairRetries: next.repair?.automaticRepairRetries,
      },
    ));
  });
}
```

Add a `PendingEvent` argument to `queueEvidenceCapture` and `complete` so environment-detection events and the state update remain in one transaction:

```ts
interface PendingEvent {
  type: string;
  actor?: "SYSTEM" | "AGENT";
  data?: Record<string, unknown>;
}
```

Use these trailing parameters and pass `pendingEvents` through both the retry-exhausted and requeued branches:

```ts
private queueEvidenceCapture(
  current: Issue,
  feedback: string,
  failureCode = "EVIDENCE_NOT_REVIEWABLE",
  pendingEvents: PendingEvent[] = [],
): void

private complete(
  previous: Issue,
  next: Issue,
  type: string,
  pending: PendingOperation | null = null,
  data: Record<string, unknown> = {},
  pendingEvents: PendingEvent[] = [],
): boolean
```

`complete` must append every pending event before its existing terminal event:

```ts
for (const pendingEvent of pendingEvents) {
  tx.appendEvent(this.event(
    next.id,
    pendingEvent.type,
    pendingEvent.actor ?? "AGENT",
    pendingEvent.data ?? {},
  ));
}
tx.appendEvent(this.event(next.id, type, "AGENT", data));
```

For an environment result, pass `EVIDENCE_ENVIRONMENT_FAILURE` with `diagnostic.eventData`; when `result.code === "EVIDENCE_CAPTURE_TIMEOUT"`, also pass `EVIDENCE_CAPTURE_TIMED_OUT`. Preserve the existing two-retry `queueEvidenceCapture` behavior.

- [ ] **Step 6: Update Runtime fakes for the union**

Change the default in `apps/runtime/test/helpers/fakes.ts` to:

```ts
nextEvidenceResult = {
  outcome: "CAPTURED" as const,
  evidence: repairResult.evidence,
};
```

Only create `proof.png` in `FakeAgent.captureEvidence` when the selected outcome is `CAPTURED`. This prevents defect tests from accidentally leaving media that looks valid.

- [ ] **Step 7: Verify Runtime routing and regressions**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/evidence-diagnostics.test.ts test/evidence-worker.test.ts test/repair-worker.test.ts
pnpm --filter @oh-my-bug/runtime typecheck
```

Expected: all tests pass. Existing media import failures still stop after two automatic retries without entering Repair.

- [ ] **Step 8: Commit Runtime routing**

```bash
git add apps/runtime/src/orchestration/evidence-diagnostics.ts apps/runtime/src/orchestration/worker.ts apps/runtime/test/evidence-diagnostics.test.ts apps/runtime/test/evidence-worker.test.ts apps/runtime/test/helpers/fakes.ts
git commit -m "feat(runtime): return evidence defects to repair"
```

### Task 5: Cover Recovery, Manual Reset, Demo Agent, and the Full Loop

**Files:**
- Modify: `apps/runtime/src/testing/demo-agent.ts`
- Modify: `apps/runtime/test/helpers/fakes.ts`
- Modify: `apps/runtime/test/commands.test.ts`
- Modify: `apps/runtime/test/recovery.test.ts`
- Modify: `apps/runtime/test/acceptance/evidence-capture-flow.test.ts`

- [ ] **Step 1: Write the failing full-loop acceptance test**

Extend `FakeAgent` with an optional FIFO:

```ts
evidenceResults: EvidenceCaptureResult[] = [];
```

In `captureEvidence`, consume and materialize the selected result exactly once:

```ts
const result = this.evidenceResults.shift() ?? this.nextEvidenceResult;
if (result.outcome === "CAPTURED") {
  await mkdir(input.evidenceDirectory, { recursive: true });
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#45a978" },
  }).png().toFile(join(input.evidenceDirectory, "proof.png"));
}
return result;
```

In `apps/runtime/test/acceptance/evidence-capture-flow.test.ts`, add a test that configures:

```ts
agent.nextRepairResult = { summary: "Implemented", evidence: [] };
agent.evidenceResults = [
  {
    outcome: "PRODUCT_DEFECT",
    diagnosis: "The shortcut leaves the details rail visible.",
    failedCommand: "pnpm test:e2e:electron",
    errorSummary: "Expected hidden, received visible",
  },
  {
    outcome: "CAPTURED",
    evidence: [{ type: "screenshot", label: "Rail hidden", relativePath: "proof.png" }],
  },
];
```

Run the approved Issue through `runtime.drain()` and assert:

```ts
expect(runtime.getIssue(issue.id)).toMatchObject({
  status: "ACCEPTANCE_REVIEW",
  repair: { iteration: 2, delivery: { evidence: [expect.any(Object)] } },
});
expect(agent.repairSessions).toHaveLength(2);
expect(agent.evidenceSessions).toHaveLength(2);
expect(agent.repairInputs[1]?.feedback)
  .toContain("The shortcut leaves the details rail visible");
```

Assert the event order includes defect detection, automatic Repair queued, second implementation ready, and evidence acceptance.

- [ ] **Step 2: Add manual-reset and restart assertions**

In `apps/runtime/test/commands.test.ts`, extend the Retry Repair fixture with `automaticRepairRetries: 5` and assert the retried Issue no longer has that field.

In `apps/runtime/test/recovery.test.ts`, add:

- a `REPAIRING` Issue with `automaticRepairRetries: 3` recovers pending `REPAIR` without changing the counter;
- an `EVIDENCE_CAPTURE` Issue with `automaticRepairRetries: 3` and `evidenceRetries: 1` recovers pending `CAPTURE_EVIDENCE` without incrementing either counter.

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/acceptance/evidence-capture-flow.test.ts test/commands.test.ts test/recovery.test.ts
```

Expected: FAIL until the fake queue, demo contract, and reset expectations are updated.

- [ ] **Step 4: Update Demo Agent and Fake Agent result shapes**

Change `DemoAgentAdapter.captureEvidence` to return:

```ts
return {
  outcome: "CAPTURED",
  evidence: [{ type: "screenshot", label: "Checkout acceptance", relativePath }],
};
```

Implement the Fake Agent FIFO and create `proof.png` only for the chosen `CAPTURED` result.

- [ ] **Step 5: Verify the complete bounded loop and recovery**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test
pnpm --filter @oh-my-bug/runtime typecheck
```

Expected: the full Runtime suite passes, including the automatic Repair-to-Evidence acceptance flow and restart counter preservation.

- [ ] **Step 6: Commit compatibility and acceptance coverage**

```bash
git add apps/runtime/src/testing/demo-agent.ts apps/runtime/test/helpers/fakes.ts apps/runtime/test/commands.test.ts apps/runtime/test/recovery.test.ts apps/runtime/test/acceptance/evidence-capture-flow.test.ts
git commit -m "test(runtime): cover bounded evidence repair loop"
```

### Task 6: Run Full Verification and Review the Permission Boundary

**Files:**
- Verify: `packages/core/**`
- Verify: `packages/agent-codex/**`
- Verify: `apps/runtime/**`
- Verify: repository-wide consumers of `EvidenceCaptureResult`

- [ ] **Step 1: Search for stale Evidence result producers and consumers**

Run:

```bash
rg -n "EvidenceCaptureResult|nextEvidenceResult|captureEvidence\(|evidence: repairResult\.evidence" packages apps --glob '*.ts'
```

Expected: every producer returns a discriminated `outcome`; every consumer branches before reading `evidence`.

- [ ] **Step 2: Run all affected package tests in parallel**

Run:

```bash
pnpm --filter @oh-my-bug/core test &
core_pid=$!
pnpm --filter @oh-my-bug/agent-codex test &
agent_pid=$!
pnpm --filter @oh-my-bug/runtime test &
runtime_pid=$!
wait "$core_pid" "$agent_pid" "$runtime_pid"
```

Expected: all three package suites exit zero with no failed tests.

- [ ] **Step 3: Run repository-wide type checking**

Run:

```bash
pnpm typecheck
```

Expected: all workspace and repository TypeScript checks pass. This catches Demo Agent, Desktop, storage, and protocol consumers not exercised by the focused tests.

- [ ] **Step 4: Run repository-wide tests and lint**

Run:

```bash
pnpm test
pnpm lint
git diff --check
```

Expected: all commands exit zero with no test, lint, or whitespace failures.

- [ ] **Step 5: Audit the final permission and state boundaries**

Run:

```bash
rg -n -C 4 "sandboxMode|networkAccessEnabled" packages/agent-codex/src/codex-agent-adapter.ts
rg -n "EVIDENCE_DEFECT|AUTOMATIC_REPAIR_EXHAUSTED|MAX_AUTOMATIC_REPAIR_RETRIES|MAX_AUTOMATIC_EVIDENCE_RETRIES" packages/core apps/runtime
git status --short
git log -7 --oneline
```

Expected:

- Assessment is `read-only`, network disabled.
- Repair is `workspace-write`, network disabled.
- Evidence alone is `danger-full-access`, network enabled, with the five-minute policy.
- automatic Repair is capped at five and Evidence retry remains capped at two.
- the worktree is clean and the four implementation commits follow the plan commit.
