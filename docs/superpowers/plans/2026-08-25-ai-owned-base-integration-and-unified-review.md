# AI-Owned Base Integration and Unified Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI integrate the latest configured base commit into the isolated Issue branch during normal Repair, pause only for mutually exclusive business decisions through one generic Core review state, and reduce final publication to a guarded fast-forward that never edits or discards personal base-Worktree changes.

**Architecture:** Core owns a bounded, reason-agnostic `REVIEW_REQUIRED` state and continuation integrity. Runtime creates assessment, delivery, and business-conflict review envelopes and resumes the selected operation. The Agent implements and semantically merges only in the Issue Worktree. The Workspace Provider supplies the immutable base observation, validates the Agent's branch/commit/cleanliness claims before evidence, and finally advances the base with checked-out-Worktree `--ff-only` or compare-and-swap `update-ref`. Existing active finalization-recovery rows remain on an isolated legacy path, but no new Issue enters that path.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, Git CLI, SQLite/JSON1, Codex SDK, React 19, Electron

---

## Implementation invariants

- The Agent may mutate Git state only beneath the acquired Issue Worktree. The prompt and adapter must explicitly prohibit changes to the base Worktree, other Worktrees, non-Issue refs, remotes, hooks, and repository configuration.
- A delivery-ready Git Repair result names one immutable observed base commit and the current Issue `HEAD`; the base commit must be an ancestor of that `HEAD`.
- A valid business-decision request may leave a real merge in progress in the Issue Worktree. It is review, not failure, and resumes the same Agent session and `repair.iteration`.
- `REVIEW_REQUIRED` is the only status used by new assessment, delivery, or business-decision review flows. Permission requests remain `PERMISSION_REQUIRED`.
- Final publication never calls `merge-tree`, `commit-tree`, or an Agent. It either fast-forwards, returns `BASE_STALE`, or reports a technical publication error.
- Unrelated personal changes in a checked-out base Worktree remain byte-for-byte and index-for-index unchanged. Actual path overlap blocks before moving the base.
- A base-stale result clears the accepted delivery snapshot, preserves historical evidence externally, increments the repair iteration, and queues `REPAIR` without setting `lastFailure` or spending a retry budget.
- Existing active `FINALIZATION_RECOVERY` work may finish through the legacy handler. New failures never start finalization recovery, and retrying legacy `FINALIZATION_FAILED` routes to Repair.

## Working-tree preflight

The repository currently contains user-owned edits in the following files:

```text
apps/desktop/scripts/dev.cjs
apps/desktop/test/electron/dev-entry.test.ts
packages/agent-codex/src/output-schemas.ts
packages/agent-codex/src/prompts.ts
packages/agent-codex/test/assessment.test.ts
packages/agent-codex/test/repair.test.ts
```

Before implementing any task, inspect those diffs and preserve them. Four files overlap this plan's Agent work; edit around the current contents and stage only the intended hunks. Do not reset, stash, or overwrite the user's changes.

## File structure

- Add generic review types, schemas, transitions, result helpers, and legacy decoders under `packages/core/src/issue/`.
- Extend `packages/core/src/agent/` with base-integration input, delivery-ready metadata, business-decision output, and review continuation.
- Migrate persisted review rows and read-only decoding in `packages/storage/src/sqlite/`.
- Add generic review request factories and response adapters in `apps/runtime/src/orchestration/reviews.ts`.
- Extend `packages/module-api/src/workspace.ts` with Repair observation/validation and typed publication outcomes.
- Add Git Repair validation in `packages/workspace-git/src/repair-integration.ts`; simplify normal publication in `provider.ts`.
- Update Codex output schemas, prompt, adapter, demo Agent, and focused tests.
- Update Runtime worker, commands, service, protocol, restart recovery, and acceptance tests.
- Add a shared Desktop review shell plus assessment, delivery, business-conflict, and fallback renderers.
- Isolate legacy finalization recovery so existing rows can finish without allowing new entry.

### Task 1: Add the generic Core review state machine

**Files:**
- Modify: `packages/core/src/issue/types.ts`
- Modify: `packages/core/src/issue/schema.ts`
- Modify: `packages/core/src/issue/workflow.ts`
- Modify: `packages/core/src/issue/results.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/issue/schema.test.ts`
- Modify: `packages/core/test/issue/workflow.test.ts`
- Modify: `packages/core/test/issue/results.test.ts`

- [ ] **Step 1: Write failing schema tests for one bounded review envelope**

Cover an opaque nested payload, unique bounded choices, a valid continuation, and the new status:

```ts
const request: ReviewRequest = {
  id: "review-19",
  kind: "business-merge-conflict",
  requestedFrom: "REPAIRING",
  payload: {
    baseIntent: "Keep legacy rounding",
    issueIntent: "Use per-line rounding",
    paths: ["packages/billing/src/total.ts"],
  },
  choices: [{
    id: "use-issue-behavior",
    label: "采用 Issue 行为",
    continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
  }],
  requestedAt: "2026-08-25T00:00:00.000Z",
};

expect(issueSchema.parse({ ...repairingIssue, status: "REVIEW_REQUIRED", review: request }))
  .toMatchObject({ status: "REVIEW_REQUIRED", review: request });
```

Reject payloads over 32 KiB when JSON encoded, depth over 8, more than 10 choices, duplicate choice IDs, labels over 200 characters, and unknown Core continuation operations/statuses. Core deliberately does not interpret strings inside the opaque payload; Runtime validates path semantics for the review kinds that define paths.

- [ ] **Step 2: Write failing transition/result tests**

Prove:

1. `ASSESSING`, `REPAIRING`, and `EVIDENCE_CHECK` may request review.
2. A source status may install only the allowed continuations.
3. A request cannot replace another active request.
4. Submission rejects stale Issue revision, stale request ID, unknown choice, missing required feedback, and unexpected feedback over 4,000 characters.
5. Submission clears `issue.review` atomically and returns the selected pending operation.
6. `REVIEW_REQUIRED + CANCEL` remains legal and clears review state.

Use this exact continuation matrix:

```ts
const allowedReviewContinuations = {
  ASSESSING: new Set([
    "ASSESSING:ASSESS:-",
    "REPAIRING:REPAIR:-",
    "CLOSED:-:NOT_A_BUG",
    "CLOSED:-:DUPLICATE",
  ]),
  REPAIRING: new Set(["REPAIRING:REPAIR:-"]),
  EVIDENCE_CHECK: new Set([
    "REPAIRING:REPAIR:-",
    "FINALIZING:FINALIZE:FIXED",
    "FINALIZING:FINALIZE:IMPLEMENTED",
  ]),
} as const;
```

- [ ] **Step 3: Run the focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/schema.test.ts test/issue/workflow.test.ts test/issue/results.test.ts
```

Expected: FAIL because `REVIEW_REQUIRED`, `ReviewRequest`, `requestReview()`, and `submitReview()` do not exist.

- [ ] **Step 4: Add bounded generic review types**

Add these public shapes to `issue/types.ts`:

```ts
export type ReviewJson =
  | null
  | boolean
  | number
  | string
  | ReviewJson[]
  | { [key: string]: ReviewJson };

export type ReviewSourceStatus = "ASSESSING" | "REPAIRING" | "EVIDENCE_CHECK";
export type ReviewOperation = "ASSESS" | "REPAIR" | "FINALIZE";
export type ReviewResumeStatus = "ASSESSING" | "REPAIRING" | "FINALIZING" | "CLOSED";

export interface ReviewContinuation {
  operation?: ReviewOperation;
  resumeStatus: ReviewResumeStatus;
  resolution?: IssueResolution;
}

export interface ReviewChoice {
  id: string;
  label: string;
  feedbackRequired?: boolean;
  continuation: ReviewContinuation;
}

export interface ReviewRequest {
  id: string;
  kind: string;
  requestedFrom: ReviewSourceStatus;
  payload: ReviewJson;
  choices: ReviewChoice[];
  requestedAt: string;
}

export interface ReviewSubmission {
  expectedRevision: number;
  requestId: string;
  choiceId: string;
  feedback?: string;
  data?: ReviewJson;
}
```

Add `REVIEW_REQUIRED` to `IssueStatus` and `review?: ReviewRequest` to `Issue`. Do not add assessment-, delivery-, or merge-specific fields to Core.

- [ ] **Step 5: Implement strict schemas and generic result helpers**

Export `reviewJsonSchema`, `reviewRequestSchema`, and `reviewSubmissionSchema`. Validate JSON size and depth after structural parsing. Implement:

```ts
export function requestReview(
  issue: Issue,
  requestInput: ReviewRequest,
  now: string,
): Issue;

export function submitReview(
  issue: Issue,
  submission: ReviewSubmission,
  now: string,
): {
  issue: Issue;
  operation: ReviewOperation | null;
  request: ReviewRequest;
  choice: ReviewChoice;
};
```

`requestReview()` validates the continuation matrix before storing anything. `submitReview()` validates `expectedRevision` and request identity, applies only the selected bounded continuation/resolution, clears the request, increments revision once, and never writes stage-specific feedback.

- [ ] **Step 6: Stop Core readiness helpers from selecting stage-specific review statuses**

Keep `recordAssessment()` and `recordEvidenceAcceptance()` as readiness updates, but leave their statuses at `ASSESSING` and `EVIDENCE_CHECK` respectively. Runtime will compose them with `requestReview()` in one storage transaction. Remove new-flow transitions to `ASSESSMENT_REVIEW` and `ACCEPTANCE_REVIEW`; retain legacy status decoding only in Task 2.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/schema.test.ts test/issue/workflow.test.ts test/issue/results.test.ts
pnpm --filter @oh-my-bug/core typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the generic Core contract**

```bash
git add packages/core
git commit -m "feat(core): unify issue review state"
```

### Task 2: Decode and migrate legacy review rows

**Files:**
- Create: `packages/core/src/issue/legacy-review.ts`
- Modify: `packages/core/src/issue/schema.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/issue/schema.test.ts`
- Modify: `packages/storage/src/sqlite/database.ts`
- Modify: `packages/storage/src/sqlite/runtime-store.ts`
- Modify: `packages/storage/src/sqlite/workspace-store.ts`
- Modify: `packages/storage/test/sqlite/database.test.ts`
- Modify: `packages/storage/test/sqlite/issue-store.test.ts`
- Modify: `packages/storage/test/sqlite/workspace-store.test.ts`

- [ ] **Step 1: Write failing legacy parse and migration tests**

Insert raw rows for `ASSESSMENT_REVIEW` and `ACCEPTANCE_REVIEW`, reopen the database, and assert both the top-level `issues.status` column and `data_json.status` become `REVIEW_REQUIRED`. Assert the generated request is deterministic across restarts and contains valid choices.

Also open the same pre-migration fixture with `openRuntimeDatabaseReadOnly()` and prove `getIssue()` returns an in-memory generic request without attempting a write.

- [ ] **Step 2: Run storage tests and verify RED**

```bash
pnpm --filter @oh-my-bug/storage exec vitest run test/sqlite/database.test.ts test/sqlite/issue-store.test.ts test/sqlite/workspace-store.test.ts
```

Expected: FAIL because current reads call `issueSchema.parse()` directly and the new schema no longer accepts the two legacy statuses.

- [ ] **Step 3: Add one persisted-Issue decoder**

Export `parsePersistedIssue(value: unknown): Issue` from Core. It must:

1. detect only `ASSESSMENT_REVIEW` and `ACCEPTANCE_REVIEW` before current-schema parsing;
2. validate the rest of the legacy Issue shape;
3. build deterministic IDs such as `legacy:<issueId>:<revision>:assessment`;
4. use `updatedAt` as `requestedAt`;
5. map assessment choices to `implement`, `reassess`, `not-a-bug`, or `duplicate` according to the current verdict;
6. map delivery choices to `accept` and `request-changes`, using `FIXED` or `IMPLEMENTED` from the assessment verdict;
7. return a current `issueSchema` value.

This file is migration-only. New review creation remains in Runtime.

- [ ] **Step 4: Use the decoder at every persistence read boundary**

Replace direct Issue JSON reads in `runtime-store.ts` and `workspace-store.ts` with `parsePersistedIssue()`. Writes continue to use strict current `issueSchema`, preventing legacy statuses from being re-persisted.

- [ ] **Step 5: Migrate writable databases transactionally**

Add `migrateUnifiedReviewStatuses(database)` after schema creation and before ordinary reads. Select only the two legacy statuses, decode each row, then update `status`, `revision`, and `data_json` in one SQLite transaction. Preserve identifiers, pending operations, events, and timestamps. Do not migrate `FINALIZATION_RECOVERY`; active legacy recovery remains readable.

- [ ] **Step 6: Run storage and Core tests**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/schema.test.ts
pnpm --filter @oh-my-bug/storage exec vitest run test/sqlite/database.test.ts test/sqlite/issue-store.test.ts test/sqlite/workspace-store.test.ts
pnpm --filter @oh-my-bug/storage typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit migration support**

```bash
git add packages/core/src/issue/legacy-review.ts packages/core/src/issue/schema.ts packages/core/src/index.ts packages/core/test/issue/schema.test.ts packages/storage
git commit -m "feat(storage): migrate legacy issue reviews"
```

### Task 3: Adapt Runtime and protocol to generic reviews

**Files:**
- Create: `apps/runtime/src/orchestration/reviews.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/src/orchestration/commands.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `apps/runtime/src/service.ts`
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Modify: `apps/runtime/src/protocol/operations.ts`
- Modify: `apps/runtime/test/assessment-worker.test.ts`
- Modify: `apps/runtime/test/evidence-worker.test.ts`
- Modify: `apps/runtime/test/commands.test.ts`
- Modify: `apps/runtime/test/protocol/operations.test.ts`
- Modify: `apps/runtime/test/protocol/service.test.ts`

- [ ] **Step 1: Write failing assessment and delivery review tests**

Assert that successful assessment and evidence inspection now persist:

```ts
expect(issue).toMatchObject({
  status: "REVIEW_REQUIRED",
  review: { kind: "assessment", requestedFrom: "ASSESSING" },
});

expect(deliveryIssue).toMatchObject({
  status: "REVIEW_REQUIRED",
  review: { kind: "delivery", requestedFrom: "EVIDENCE_CHECK" },
});
```

Submit `{ expectedRevision, requestId, choiceId, feedback?, data? }` through one new `submitReview` operation. Prove the command writes exactly one `REVIEW_SUBMITTED` event, uses the choice's pending operation, and rejects duplicate/stale submissions atomically.

- [ ] **Step 2: Run focused Runtime tests and verify RED**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/assessment-worker.test.ts test/evidence-worker.test.ts test/commands.test.ts test/protocol/operations.test.ts test/protocol/service.test.ts
```

Expected: FAIL because stage-specific statuses and commands are still the only review API.

- [ ] **Step 3: Add review request factories and kind-specific submission validation**

Implement in `reviews.ts`:

```ts
export function assessmentReview(issue: Issue, id: string, now: string): ReviewRequest;
export function deliveryReview(issue: Issue, id: string, now: string): ReviewRequest;
export function validateReviewSubmission(
  issue: Issue,
  submission: ReviewSubmission,
): { title?: string; duplicateOf?: string };
```

Assessment response `data` is `{ title: string }` for implementation and `{ duplicateOf: string }` for duplicate. Delivery rejection uses required `feedback`. Runtime validates these opaque fields before calling Core and applies title/duplicate fields afterward. Core only applies the selected status, operation, and resolution.

- [ ] **Step 4: Compose readiness and request creation atomically**

After `recordAssessment()`, create the assessment request before `updateIssue()`. After `recordEvidenceAcceptance()`, create the delivery request before `updateIssue()`. Emit bounded `REVIEW_REQUESTED` events containing `requestId`, `kind`, `choiceIds`, and the resulting revision, but not the entire payload.

- [ ] **Step 5: Add the generic command and protocol operation**

Expose:

```ts
submitReview(input: {
  id: string;
  input: ReviewSubmission;
}): Promise<Issue>;
```

The command validates kind-specific response data, calls Core `submitReview()`, persists the selected pending operation, appends a bounded `REVIEW_SUBMITTED` event with `revision`, and wakes the worker when an operation is present.

Keep `approveAssessment`, `confirmNotABug`, `confirmDuplicate`, `requestReassessment`, `rejectDelivery`, and `approveDelivery` as deprecated wrappers for one migration release. Each wrapper locates the matching current review choice and delegates to `submitReview`; none performs its own status transition.

- [ ] **Step 6: Preserve lifecycle behavior**

Emit `issue.userApproved` only when the selected delivery choice resumes `FINALIZE`. Keep duplicate target lookup and self/cross-project validation in Runtime before generic submission. Do not emit approval lifecycle events for business review choices.

- [ ] **Step 7: Run tests and typecheck**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/assessment-worker.test.ts test/evidence-worker.test.ts test/commands.test.ts test/protocol/operations.test.ts test/protocol/service.test.ts
pnpm --filter @oh-my-bug/runtime typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Runtime review unification**

```bash
git add apps/runtime packages/core
git commit -m "feat(runtime): route approvals through generic reviews"
```

### Task 4: Define Repair integration and publication contracts

**Files:**
- Modify: `packages/core/src/agent/types.ts`
- Modify: `packages/core/src/agent/schemas.ts`
- Modify: `packages/core/src/agent/adapter.ts`
- Modify: `packages/core/test/agent/adapter.test.ts`
- Modify: `packages/core/test/agent/contracts.test.ts`
- Modify: `packages/module-api/src/workspace.ts`
- Modify: `packages/module-api/test/contracts.test.ts`
- Modify: `packages/workspace-local/src/index.ts`
- Modify: `packages/workspace-local/test/provider.test.ts`

- [ ] **Step 1: Write failing shared-contract tests**

Cover a Git integration observation, delivery-ready result, business-decision result, validation call, and the standalone typed stale publication result used by Task 8. Also prove the local provider can opt out of integration.

- [ ] **Step 2: Run focused contract tests and verify RED**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/agent/adapter.test.ts test/agent/contracts.test.ts
pnpm --filter @oh-my-bug/module-api exec vitest run test/contracts.test.ts
pnpm --filter @oh-my-bug/workspace-local exec vitest run test/provider.test.ts
```

- [ ] **Step 3: Replace the single Repair result with a discriminated union**

Add:

```ts
export interface RepairIntegrationInput {
  baseBranch: string;
  observedBaseCommit: string;
  issueBranch: string;
}

export interface RepairVerification {
  command: string;
  outcome: "PASSED" | "FAILED" | "NOT_RUN";
  summary: string;
}

export interface RepairConflictResolution {
  path: string;
  classification: "TEXTUAL" | "COMPATIBLE_BUSINESS";
  resolution: string;
}

export type RepairResult =
  | {
      kind: "DELIVERY_READY";
      summary: string;
      evidence: RepairEvidencePath[];
      integration?: {
        baseCommit: string;
        issueCommit: string;
        conflicts: RepairConflictResolution[];
      };
      verification: RepairVerification[];
    }
  | {
      kind: "BUSINESS_DECISION_REQUIRED";
      summary: string;
      decision: {
        baseCommit: string;
        issueCommit: string;
        conflictPaths: string[];
        baseIntent: string;
        issueIntent: string;
        incompatibility: string;
        recommendation: string;
        rationale: string;
        choices: Array<{ id: string; label: string; description: string }>;
      };
    };
```

Bound all text/path arrays in strict Zod schemas. Require at least one verification entry for `DELIVERY_READY`. Integration is required only when the Workspace observation says `required: true`.

- [ ] **Step 4: Add review continuation to the Agent contract**

Extend `AgentContinuation` with:

```ts
{
  reason: "REVIEW_SUBMITTED";
  requestId: string;
  kind: string;
  choiceId: string;
  feedback?: string;
  data?: ReviewJson;
}
```

Add `integration?: RepairIntegrationInput` to `RepairInput`.

- [ ] **Step 5: Add Workspace orchestration contracts**

Define:

```ts
export interface WorkspaceRepairObservation {
  required: boolean;
  baseBranch?: string;
  baseCommit?: string;
  issueBranch?: string;
}

export type WorkspaceRepairValidation =
  | { kind: "DELIVERY_READY"; branch: BranchInfo }
  | { kind: "BUSINESS_DECISION_REQUIRED" };

export type WorkspacePublishResult =
  | { kind: "PUBLISHED"; branch?: BranchInfo }
  | { kind: "BASE_STALE"; currentBaseCommit: string };
```

Add these optional provider methods without changing `publish()` yet:

```ts
observeRepair?(input: {
  issue: Issue;
  resourceId: string;
}): Promise<WorkspaceRepairObservation>;

validateRepair?(input: {
  issue: Issue;
  resourceId: string;
  observation: WorkspaceRepairObservation;
  result: RepairResult;
}): Promise<WorkspaceRepairValidation>;
```

Define `WorkspacePublishResult` now, but narrow the `publish()` signature and update every implementation/caller together in Task 8 so this contract commit does not partially change publication. Local returns `required: false` and validates only the non-Git result shape.

- [ ] **Step 6: Run tests and typechecks**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/agent/adapter.test.ts test/agent/contracts.test.ts
pnpm --filter @oh-my-bug/module-api exec vitest run test/contracts.test.ts
pnpm --filter @oh-my-bug/workspace-local exec vitest run test/provider.test.ts
pnpm --filter @oh-my-bug/core typecheck
pnpm --filter @oh-my-bug/module-api typecheck
pnpm --filter @oh-my-bug/workspace-local typecheck
```

- [ ] **Step 7: Commit the shared integration contract**

```bash
git add packages/core packages/module-api packages/workspace-local
git commit -m "feat(workspace): define repair integration contract"
```

### Task 5: Teach the Codex Agent to integrate the base or request a business decision

**Files:**
- Modify carefully around user edits: `packages/agent-codex/src/output-schemas.ts`
- Modify carefully around user edits: `packages/agent-codex/src/prompts.ts`
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`
- Modify carefully around user edits: `packages/agent-codex/test/repair.test.ts`
- Modify: `packages/agent-codex/test/assessment.test.ts` only if shared fixtures require it
- Modify: `apps/runtime/src/testing/demo-agent.ts`
- Modify: `apps/runtime/test/testing/demo-agent.test.ts`

- [ ] **Step 1: Reconcile the current user-owned diffs**

Run:

```bash
git diff -- packages/agent-codex/src/output-schemas.ts packages/agent-codex/src/prompts.ts packages/agent-codex/test/repair.test.ts packages/agent-codex/test/assessment.test.ts
```

Record which hunks belong to the user. Do not restore them. Build the new discriminated output schema on top of the current working contents.

- [ ] **Step 2: Write failing schema/parser tests**

Prove the parser accepts both union members, rejects an integrated result missing verification/base ancestry fields, bounds decision text/choices/paths, and retains the existing no-evidence path.

- [ ] **Step 3: Write failing prompt tests**

For Git integration, require the prompt to contain all of these facts:

```text
Observed base: main@${observedBaseCommit}
Issue branch: ohmybug/ohmybug-19
Merge the observed base commit into the Issue branch in this Issue Worktree.
Resolve textual and compatible business conflicts yourself.
Return BUSINESS_DECISION_REQUIRED only when the observable business behaviors are mutually exclusive.
You may stage and commit only in this Issue Worktree.
Do not mutate the base Worktree, another Worktree, non-Issue refs, remotes, hooks, or Git configuration.
Do not rebase or rewrite accepted history.
```

Also prove a `REVIEW_SUBMITTED` continuation includes the exact selected choice, feedback, and opaque response data.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/repair.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run test/testing/demo-agent.test.ts
```

- [ ] **Step 5: Implement strict Codex output schemas and prompt**

Use a top-level `kind` discriminator; do not infer business review from missing fields or error text. Reverse the current prompt sentence that says Oh My Bug does not manage Git operations. Explicitly distinguish Issue-Worktree Git authority from forbidden base-Worktree authority.

- [ ] **Step 6: Keep adapter execution rooted in the acquired Issue project path**

Ensure the Codex turn uses `issue.projectPath`/Repair `project.path` as `cwd`, keeps approval policy `never`, and does not add the repository root or base checkout as another writable root. Parsing errors remain Repair failures; `BUSINESS_DECISION_REQUIRED` is returned normally.

- [ ] **Step 7: Update DemoAgent fixtures**

Default to `{ kind: "DELIVERY_READY", verification: [{ command: "pnpm test", outcome: "PASSED", summary: "configured tests passed" }] }`, allow a queued business decision, and capture the Repair integration/continuation for Runtime tests.

- [ ] **Step 8: Run tests and typecheck**

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/repair.test.ts test/assessment.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run test/testing/demo-agent.test.ts
pnpm --filter @oh-my-bug/agent-codex typecheck
```

- [ ] **Step 9: Stage only intended Agent hunks and commit**

```bash
git diff --check
git add -p packages/agent-codex apps/runtime/src/testing/demo-agent.ts apps/runtime/test/testing/demo-agent.test.ts
git diff --cached --check
git commit -m "feat(agent): integrate base during repair"
```

### Task 6: Observe and validate Git integration in the Issue Worktree

**Files:**
- Create: `packages/workspace-git/src/repair-integration.ts`
- Create: `packages/workspace-git/test/repair-integration.test.ts`
- Modify: `packages/workspace-git/src/provider.ts`
- Modify: `packages/workspace-git/src/index.ts`
- Modify: `packages/workspace-git/test/acquire.test.ts`
- Modify: `packages/workspace-git/test/publish.test.ts`

- [ ] **Step 1: Write failing observation tests**

For `mergeToBaseBranch: true`, assert `observeRepair()` reads the current immutable base ref on every Repair turn and returns the saved Issue branch. Advance base between turns and prove the second observation changes. For `mergeToBaseBranch: false`, return `{ required: false }`.

- [ ] **Step 2: Write failing delivery validation tests**

Cover all rejection cases:

- returned base SHA differs from the observation;
- returned Issue SHA differs from `HEAD`;
- `HEAD` is on the wrong branch or detached;
- observed base is not an ancestor of `HEAD`;
- tracked, staged, or untracked files remain;
- `git ls-files -u` returns entries;
- `MERGE_HEAD`, `CHERRY_PICK_HEAD`, rebase, or sequencer metadata remains;
- hidden index flags, unsafe initialized submodules, undeclared Gitlinks, or generated artifact roots remain;
- verification is missing or reports `FAILED`.

Also prove a clean merge commit with compatible conflict metadata passes and returns the Issue branch/commit.

- [ ] **Step 3: Write failing business-review validation tests**

Allow only a result whose `baseCommit` equals the observation, `issueCommit` equals the pre-merge Issue `HEAD`, conflict paths are repository-relative and correspond to actual unmerged entries, and the current branch/worktree matches the saved resource. A business review may have `MERGE_HEAD` and unmerged entries; a delivery-ready result may not.

- [ ] **Step 4: Run focused Git tests and verify RED**

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/repair-integration.test.ts test/acquire.test.ts test/publish.test.ts
```

- [ ] **Step 5: Implement `observeGitRepair()`**

Read `refs/heads/<baseBranch>^{commit}` and the saved Issue branch. Do not check out, fetch, merge, stage, or modify either Worktree. Observation is read-only and must be repeatable after Runtime restart.

- [ ] **Step 6: Implement deterministic validation**

Use Git plumbing to compare branch, `HEAD`, ancestry, index, state files, and status. Reuse `assertPublicationPreflight()`, hidden-index, submodule, and Gitlink safety helpers by exporting or moving them into `repair-integration.ts`; do not duplicate the same checks in Provider publication.

Return stable errors such as:

```text
GIT_REPAIR_BASE_MISMATCH
GIT_REPAIR_HEAD_MISMATCH
GIT_REPAIR_WRONG_BRANCH
GIT_REPAIR_BASE_NOT_ANCESTOR
GIT_REPAIR_WORKTREE_DIRTY
GIT_REPAIR_UNRESOLVED_MERGE
GIT_REPAIR_GENERATED_ARTIFACTS_PRESENT
GIT_REPAIR_VERIFICATION_REQUIRED
```

- [ ] **Step 7: Wire Provider methods and persist no semantic merge session**

`observeRepair()` and `validateRepair()` may read saved `GitWorkspaceState`, but must not create recovery fingerprints, temporary merge indexes, candidate trees, or synthetic commits. Normal Repair state is already durable in the real Issue Worktree and Issue branch.

- [ ] **Step 8: Run tests and typecheck**

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/repair-integration.test.ts test/acquire.test.ts test/publish.test.ts
pnpm --filter @oh-my-bug/workspace-git typecheck
```

- [ ] **Step 9: Commit Git Repair validation**

```bash
git add packages/workspace-git
git commit -m "feat(git): validate AI-owned base integration"
```

### Task 7: Route Repair completion and business decisions in Runtime

**Files:**
- Modify: `packages/core/src/agent/types.ts`
- Modify: `packages/core/src/agent/schemas.ts`
- Modify: `packages/core/src/issue/types.ts`
- Modify: `packages/core/src/issue/schema.ts`
- Modify: `packages/core/src/issue/results.ts`
- Modify: `packages/core/test/issue/results.test.ts`
- Modify: `apps/runtime/src/orchestration/reviews.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/src/orchestration/workspace-coordinator.ts`
- Modify: `apps/runtime/src/orchestration/recovery.ts`
- Modify: `apps/runtime/test/repair-worker.test.ts`
- Modify: `apps/runtime/test/recovery.test.ts`

- [ ] **Step 1: Write failing Core delivery-snapshot tests**

Extend `DeliveryDraft` with an optional validated integration snapshot:

```ts
interface DeliveryIntegrationSnapshot {
  baseBranch: string;
  baseCommit: string;
  issueBranch: string;
  issueCommit: string;
  conflicts: RepairConflictResolution[];
  verification: RepairVerification[];
}
```

Assert `recordImplementationDraft()` stores the snapshot, evidence retries preserve it, a new repair iteration clears it, and schema parsing bounds it.

- [ ] **Step 2: Write failing Runtime Repair tests**

Cover:

1. Worker observes the base before calling Agent.
2. Agent receives the exact integration input.
3. Workspace validation runs before evidence import/capture.
4. Invalid delivery-ready results become `REPAIR_FAILED` with a stable code.
5. `BUSINESS_DECISION_REQUIRED` becomes `REVIEW_REQUIRED` without `lastFailure`, retry increments, evidence work, or session replacement.
6. Submitting the review queues `REPAIR` with the same `repair.iteration` and Agent session.
7. Restart while the review is pending preserves the merge Worktree and queues nothing until submission.
8. Restart after submission reconstructs `REVIEW_SUBMITTED` continuation from the event with the new Issue revision.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/results.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run test/repair-worker.test.ts test/recovery.test.ts
```

- [ ] **Step 4: Add WorkspaceCoordinator Repair methods**

Add `observeRepair(issue)` and `validateRepair(issue, observation, result)`. Resolve the existing binding/provider, require `READY`, and delegate to optional provider methods. Local/non-integrating providers still validate the general result schema.

- [ ] **Step 5: Build the business review in Runtime**

Sanitize Agent decision output into a `business-merge-conflict` request. All choices use `{ operation: "REPAIR", resumeStatus: "REPAIRING" }`; Runtime, not Agent, supplies that continuation. Persist only bounded intent, incompatibility, recommendation, rationale, paths, commits, and choice descriptions.

- [ ] **Step 6: Validate before delivery draft/evidence**

In `worker.repair()`:

```ts
const observation = await workspaces.observeRepair(claimed);
const result = await agent.repair(session, { ...input, integration: toAgentInput(observation) });
const validation = await workspaces.validateRepair(claimed, observation, result);

if (result.kind === "BUSINESS_DECISION_REQUIRED") {
  // request generic review; no failure and no iteration change
  return;
}

// only a validated DELIVERY_READY result may create the draft and evidence
```

If the Agent reports business review but Workspace validation rejects its branch/conflict claims, treat it as a technical Repair failure.

- [ ] **Step 7: Reconstruct review continuation from durable events**

Extend `worker.continuation()` to find the latest `REVIEW_SUBMITTED` event matching operation `REPAIR` and current Issue revision before checking interruption fallback. Return the exact bounded submission. The event must not contain the full original review payload.

- [ ] **Step 8: Run tests and typechecks**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/results.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run test/repair-worker.test.ts test/recovery.test.ts
pnpm --filter @oh-my-bug/core typecheck
pnpm --filter @oh-my-bug/runtime typecheck
```

- [ ] **Step 9: Commit Repair orchestration**

```bash
git add packages/core apps/runtime
git commit -m "feat(runtime): pause repair for business decisions"
```

### Task 8: Replace publication merging with guarded fast-forward

**Files:**
- Modify: `packages/core/src/issue/workflow.ts`
- Modify: `packages/core/src/issue/results.ts`
- Modify: `packages/core/test/issue/workflow.test.ts`
- Modify: `packages/core/test/issue/results.test.ts`
- Modify: `packages/module-api/src/workspace.ts`
- Modify: `packages/module-api/test/contracts.test.ts`
- Modify: `packages/workspace-local/src/index.ts`
- Modify: `packages/workspace-local/test/provider.test.ts`
- Modify: `packages/workspace-git/src/provider.ts`
- Modify: `packages/workspace-git/test/publish.test.ts`
- Modify: `packages/workspace-git/test/merge-recovery.test.ts`
- Modify: `apps/runtime/src/orchestration/workspace-coordinator.ts`
- Modify: `apps/runtime/test/helpers/fakes.ts`
- Modify: `apps/runtime/test/workspace-finalization.test.ts`

- [ ] **Step 1: Write failing Core stale-base tests**

Add `BASE_INTEGRATION_STALE` from `FINALIZING` to `REPAIRING`. Implement `recordBaseIntegrationStale(issue, currentBaseCommit, now)` and prove it:

- increments `repair.iteration` once;
- clears `repair.deliveryDraft`, `repair.delivery`, and the provisional FIXED/IMPLEMENTED resolution;
- stores bounded Repair feedback naming the new base commit;
- preserves assessment, Agent session, and external evidence history;
- clears finalization-recovery state and `lastFailure`;
- is not legal outside `FINALIZING`.

- [ ] **Step 2: Write failing publication tests**

Prove normal `publish()`:

1. never invokes `merge-tree` or `commit-tree`;
2. never creates a commit from dirty Issue files;
3. requires the accepted draft Issue commit to equal Issue `HEAD`;
4. returns `BASE_STALE` when current base is not an ancestor of the accepted Issue commit;
5. fast-forwards a checked-out clean or unrelated-dirty base with `git merge --ff-only ${issueCommit}`;
6. uses `git update-ref ${baseRef} ${issueCommit} ${observedBase}` when base is not checked out;
7. converts a compare-and-swap race to `BASE_STALE`;
8. remains idempotent when base already contains the Issue commit.

- [ ] **Step 3: Add personal-change overlap tests**

Create unrelated tracked, staged, untracked, and ignored files in the checked-out base and snapshot status, index blob IDs, and file contents before publication. Verify all survive unchanged.

Then create exact and ancestor/descendant overlaps with paths changed by the accepted Issue commit. Verify publication rejects before moving the base. Add the regression where the Issue changes `apps/desktop/src/app.ts` while an ignored file exists at `apps/other-tool/cache.bin`; this must not collide merely because both share `apps`.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/workflow.test.ts test/issue/results.test.ts
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/publish.test.ts test/merge-recovery.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run test/workspace-finalization.test.ts
```

- [ ] **Step 5: Narrow the publication contract and simplify normal `publish()`**

Change every Provider implementation, Module API fixture, and Runtime fake to return `WorkspacePublishResult` in this task. Require a validated integration snapshot for `mergeToBaseBranch: true`. Re-read current base. If it is not an ancestor of accepted Issue commit, return `{ kind: "BASE_STALE", currentBaseCommit }`. Otherwise move the base only by guarded fast-forward, then perform configured remote publication, return `{ kind: "PUBLISHED", branch }`, and release later in Runtime. Local returns `{ kind: "PUBLISHED" }`.

Until Task 9 moves the compatibility path behind an explicit interface, an Issue carrying an already persisted legacy merge-recovery session may delegate immediately to a private `publishLegacyRecoveredDelivery()` helper. The normal integrated-delivery branch must not invoke its merge logic, and no new Issue may create the legacy state.

- [ ] **Step 6: Fix ignored collision detection to compare actual paths**

Replace recursive parent pathspec querying with one actual ignored-path list and `gitPathsOverlap()` filtering:

```ts
const ignoredPaths = parseNulPaths(await runGit(baseWorktree, [
  "ls-files", "--others", "--ignored", "--exclude-standard", "-z",
]));

if (ignoredPaths.some((localPath) =>
  changedPaths.some((changedPath) => gitPathsOverlap(localPath, changedPath)))) {
  throw new Error("GIT_WORKTREE_NOT_CLEAN");
}
```

Keep hidden-index, initialized-submodule, Gitlink, tracked, staged, and untracked checks fail-closed.

- [ ] **Step 7: Route stale base back to Repair in Runtime**

When `publish()` returns `BASE_STALE`, atomically call `recordBaseIntegrationStale()`, queue `REPAIR`, append `BASE_INTEGRATION_STALE`, and wake the worker. Do not release the Worktree, emit completion, persist finalization failure, or start finalization recovery.

- [ ] **Step 8: Run tests and typechecks**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/workflow.test.ts test/issue/results.test.ts
pnpm --filter @oh-my-bug/module-api exec vitest run test/contracts.test.ts
pnpm --filter @oh-my-bug/workspace-local exec vitest run test/provider.test.ts
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/publish.test.ts test/merge-recovery.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run test/workspace-finalization.test.ts
pnpm --filter @oh-my-bug/module-api typecheck
pnpm --filter @oh-my-bug/workspace-local typecheck
pnpm --filter @oh-my-bug/workspace-git typecheck
pnpm --filter @oh-my-bug/runtime typecheck
```

- [ ] **Step 9: Commit guarded publication**

```bash
git add packages/core packages/module-api packages/workspace-local packages/workspace-git apps/runtime
git commit -m "feat(git): publish integrated issues by fast-forward"
```

### Task 9: Isolate legacy finalization recovery and stop new entry

**Files:**
- Modify: `packages/core/src/issue/workflow.ts`
- Modify: `packages/core/src/issue/results.ts`
- Modify: `packages/core/test/issue/workflow.test.ts`
- Modify: `packages/core/test/issue/results.test.ts`
- Modify: `packages/module-api/src/workspace.ts`
- Modify: `packages/module-api/test/contracts.test.ts`
- Create: `apps/runtime/src/orchestration/legacy-finalization-recovery.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/src/orchestration/workspace-coordinator.ts`
- Modify: `apps/runtime/src/orchestration/commands.ts`
- Modify: `apps/runtime/src/orchestration/recovery.ts`
- Modify: `apps/runtime/test/finalization-recovery-worker.test.ts`
- Modify: `apps/runtime/test/acceptance/finalization-recovery.test.ts`
- Modify: `packages/workspace-git/src/provider.ts`
- Modify: `packages/workspace-git/src/merge-recovery.ts`
- Modify: `packages/workspace-git/test/finalization-recovery.test.ts`
- Modify: `packages/workspace-git/test/merge-recovery.test.ts`

- [ ] **Step 1: Write compatibility tests before moving code**

Prove an already persisted `FINALIZATION_RECOVERY` + `RECOVER_FINALIZATION` Issue still resumes and can finish. Prove a new normal publication error goes directly to `FINALIZATION_FAILED` with a technical diagnostic and never creates a recovery attempt. Prove retrying a legacy `FINALIZATION_FAILED` clears recovery metadata and queues the new `REPAIR` integration flow.

- [ ] **Step 2: Run legacy tests as a baseline**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/finalization-recovery-worker.test.ts test/acceptance/finalization-recovery.test.ts
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/finalization-recovery.test.ts test/merge-recovery.test.ts
```

Expected before changes: existing tests PASS; new no-entry/retry tests FAIL.

- [ ] **Step 3: Move active-row handling behind a named legacy boundary**

Extract `recoverFinalization()` and its Agent/provider validation dependencies into `legacy-finalization-recovery.ts`. Dispatch `RECOVER_FINALIZATION` only when the persisted Issue already has `status === "FINALIZATION_RECOVERY"`. No current workflow transition may create that status.

- [ ] **Step 4: Remove recovery startup from current finalization**

Delete `beginFinalizationRecovery()` calls from normal `WorkspaceCoordinator.finalize()`. Technical errors become `FINALIZATION_FAILED`; base movement follows Task 8's Repair path. Generated-artifact detection already occurs in Task 6 Repair validation.

- [ ] **Step 5: Keep old Git recovery only for legacy calls**

Normal `publish()` must have no imports from merge-tree recovery. If active rows require the old provider path, expose an explicitly named `publishLegacyRecoveredDelivery()` used only by the legacy coordinator. Keep its tests under the legacy suite and add a source-level assertion that normal `publish()` contains no `merge-tree`, `commit-tree`, candidate-tree, or recovery-session calls.

- [ ] **Step 6: Route legacy failed retry to Repair**

Replace the current `FINALIZATION_FAILED -> FINALIZING` retry with `FINALIZATION_FAILED -> REPAIRING`, increment the repair iteration, clear stale delivery/recovery state and provisional resolution, preserve the Agent session/assessment, and queue `REPAIR`.

- [ ] **Step 7: Run compatibility tests and typecheck**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/finalization-recovery-worker.test.ts test/acceptance/finalization-recovery.test.ts test/workspace-finalization.test.ts
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/finalization-recovery.test.ts test/merge-recovery.test.ts test/publish.test.ts
pnpm --filter @oh-my-bug/runtime typecheck
pnpm --filter @oh-my-bug/workspace-git typecheck
```

- [ ] **Step 8: Commit legacy isolation**

```bash
git add apps/runtime packages/workspace-git
git commit -m "refactor(runtime): isolate legacy finalization recovery"
```

### Task 10: Render all product reviews through one Desktop shell

**Files:**
- Create: `apps/desktop/src/web/issues/review-panel.tsx`
- Create: `apps/desktop/src/web/issues/review-renderers.tsx`
- Create: `apps/desktop/test/web/review-panel.test.tsx`
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`
- Modify: `apps/desktop/src/web/issues/issue-status.tsx`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/api/types.ts`
- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/api/client.ts`
- Modify: `apps/desktop/src/web/api/desktop-transport.ts`
- Modify: `apps/desktop/src/web/api/browser-development-transport.ts`
- Modify: `apps/desktop/src/electron/desktop-api.ts`
- Modify: `apps/desktop/test/web/issues.test.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`
- Modify: `apps/desktop/test/web/approval-panel.test.tsx`
- Modify: `apps/desktop/test/web/transport.test.ts`
- Modify: `apps/desktop/test/electron/desktop-api.test.ts`

- [ ] **Step 1: Write failing shared-shell tests**

Render Issues with `review.kind` values `assessment`, `delivery`, `business-merge-conflict`, and an unknown future kind. Assert one shell supplies title, choices, feedback, loading, error, stale-revision protection, and cancel behavior.

- [ ] **Step 2: Write failing business-conflict renderer tests**

Assert the view shows both intents, incompatibility, affected paths, AI recommendation/rationale, and every bounded choice. Submitting sends the current `issue.revision`, `review.id`, selected choice ID, feedback, and optional response data once; controls remain disabled until refresh completes.

- [ ] **Step 3: Run focused Desktop tests and verify RED**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/review-panel.test.tsx test/web/issues.test.tsx test/web/app-workbench.test.tsx test/web/approval-panel.test.tsx test/web/transport.test.ts test/electron/desktop-api.test.ts
```

- [ ] **Step 4: Add the generic transport method end to end**

Expose `submitReview(id, input)` from renderer transport through the Electron bridge to Runtime protocol. Keep deprecated methods only while older callers/tests remain; new UI calls only `submitReview`.

- [ ] **Step 5: Build the shared shell and safe renderers**

`ReviewPanel` owns choice selection, feedback state, submission/stale errors, and disabled state. `review-renderers.tsx` uses type guards for known payloads and a safe fallback that renders bounded scalar/object summaries without using raw HTML. Assessment/delivery renderers may reuse current visual components, but not current stage-specific submit logic.

- [ ] **Step 6: Replace status-specific UI gates**

Use `issue.status === "REVIEW_REQUIRED" && issue.review` for all review actions. Map `REVIEW_REQUIRED` to the review badge, and derive the user-facing label from kind:

```text
assessment -> 待确认判断
delivery -> 待验收
business-merge-conflict -> 待确认业务冲突
unknown -> 待人工审核
```

Remove the normal `FINALIZATION_RECOVERY` merge UI for new Issues, while retaining a compact legacy display for active persisted rows.

- [ ] **Step 7: Run tests and typecheck**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/review-panel.test.tsx test/web/issues.test.tsx test/web/app-workbench.test.tsx test/web/approval-panel.test.tsx test/web/transport.test.ts test/electron/desktop-api.test.ts
pnpm --filter @oh-my-bug/desktop typecheck
```

- [ ] **Step 8: Stage around unrelated Desktop dev-script edits and commit**

```bash
git diff --check
git add apps/desktop/src apps/desktop/test/web apps/desktop/test/electron/desktop-api.test.ts
git diff --cached --check
git commit -m "feat(desktop): render unified issue reviews"
```

Do not stage `apps/desktop/scripts/dev.cjs` or `apps/desktop/test/electron/dev-entry.test.ts` unless their pre-existing user work independently requires it.

### Task 11: Cover restart, concurrency, and the complete accepted flow

**Files:**
- Create: `apps/runtime/test/acceptance/ai-owned-base-integration.test.ts`
- Modify: `apps/runtime/test/acceptance/restart-flow.test.ts`
- Modify: `apps/runtime/test/acceptance/git-workspace-restart.test.ts`
- Modify: `apps/runtime/test/acceptance/manual-full-flow.test.ts`
- Modify: `apps/desktop/test/electron/e2e/git-workspace.spec.ts`

- [ ] **Step 1: Add a compatible-conflict acceptance test**

Create an Issue branch, change one behavior there, advance `main` with a compatible change to the same file, return a delivery-ready Agent result whose merge commit preserves both, and verify no business review occurs. Complete evidence, delivery review, guarded fast-forward, release, and `COMPLETED`.

- [ ] **Step 2: Add a mutually exclusive behavior acceptance test**

Make base and Issue tests demand incompatible observable behavior. Have the Agent return `BUSINESS_DECISION_REQUIRED`; verify `REVIEW_REQUIRED`, submit one choice, and assert the same logical Agent session and repair iteration receive `REVIEW_SUBMITTED`. Then finish merge, verification, evidence, acceptance, and fast-forward.

- [ ] **Step 3: Add restart tests around both pause points**

Restart Runtime while a real merge conflict is pending review, then after review submission but before the next Agent result. Verify Workspace binding restoration preserves the Issue Worktree merge state, no duplicate review/event is created, and the continuation is reconstructed once.

- [ ] **Step 4: Add base-movement-after-acceptance coverage**

Advance base after delivery acceptance but before finalization. Verify `BASE_INTEGRATION_STALE`, same Agent session, incremented repair iteration, new observed base, new evidence IDs, new delivery review, and eventual fast-forward. Prior evidence remains readable but is not referenced by the current delivery.

- [ ] **Step 5: Add personal base-Worktree safety coverage**

Keep unrelated tracked/staged/untracked/ignored personal state in checked-out `main`; assert exact preservation after completion. Repeat with overlapping personal state and assert publication fails without changing base or personal content and without opening business review.

- [ ] **Step 6: Run acceptance suites**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/acceptance/ai-owned-base-integration.test.ts test/acceptance/restart-flow.test.ts test/acceptance/git-workspace-restart.test.ts test/acceptance/manual-full-flow.test.ts
pnpm exec playwright test -c apps/desktop/playwright.config.ts git-workspace.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit acceptance coverage**

```bash
git add apps/runtime/test/acceptance apps/desktop/test/electron/e2e/git-workspace.spec.ts
git commit -m "test: cover AI-owned base integration flow"
```

### Task 12: Remove stale new-flow APIs, document compatibility, and verify the repository

**Files:**
- Modify: `README.md` if it documents delivery Git ownership
- Modify: `docs/superpowers/specs/2026-08-25-ai-owned-base-integration-and-unified-review-design.md` only for implementation-discovered clarifications

- [ ] **Step 1: Search for forbidden new-flow ownership and old review gates**

```bash
rg -n "ASSESSMENT_REVIEW|ACCEPTANCE_REVIEW|BEGIN_FINALIZATION_RECOVERY|createAutomaticMergeCommit|merge-tree|commit-tree|does not manage Git operations|onApproveAssessment|onRejectDelivery" packages apps README.md
```

Classify every match as migration decoder, isolated active-row legacy handler/test, or obsolete. If an obsolete match remains, return to its owning task, remove it there, rerun that task's tests, and commit only those exact files before continuing. Normal Provider publication and current Desktop paths must contain none of the semantic merge/recovery ownership.

- [ ] **Step 2: Verify event and payload bounds**

Inspect `REVIEW_REQUESTED`, `REVIEW_SUBMITTED`, `BASE_INTEGRATION_STALE`, and Repair completion events. Ensure no event stores raw file content, full review payload, credentials, absolute Worktree paths, unbounded stderr, or entire Agent output.

- [ ] **Step 3: Run package-focused regression suites**

```bash
pnpm --filter @oh-my-bug/core test
pnpm --filter @oh-my-bug/storage test
pnpm --filter @oh-my-bug/module-api test
pnpm --filter @oh-my-bug/workspace-local test
pnpm --filter @oh-my-bug/workspace-git test
pnpm --filter @oh-my-bug/agent-codex test
pnpm --filter @oh-my-bug/runtime test
pnpm --filter @oh-my-bug/desktop test
```

Expected: PASS with no skipped tests added for this feature.

- [ ] **Step 4: Run repository verification**

```bash
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Audit the final diff and user-owned changes**

```bash
git status --short
git diff --stat HEAD~12..HEAD
git log --oneline -12
```

Confirm the original unrelated Desktop and Agent edits were preserved or deliberately incorporated with their exact intent. Confirm no base-Worktree mutation, stash/reset/clean behavior, synthetic publication merge, or stage-specific new review state remains.

- [ ] **Step 6: Commit final cleanup/documentation**

If either documentation file changed, run:

```bash
git add README.md docs/superpowers/specs/2026-08-25-ai-owned-base-integration-and-unified-review-design.md
git diff --cached --check
git commit -m "docs: describe AI-owned issue integration"
```

## Completion criteria

- New assessment, delivery, and business-decision pauses all persist `REVIEW_REQUIRED` plus a generic bounded request.
- A normal or compatible merge conflict is resolved and committed by the Agent in the Issue Worktree without an extra human gate.
- A mutually exclusive business behavior pauses the same Repair session and iteration, then resumes from the selected review response.
- No delivery reaches evidence until Workspace validation proves the observed base is an ancestor of the clean current Issue `HEAD`.
- Final publication performs only guarded fast-forward/ref compare-and-swap and preserves unrelated personal base-Worktree state.
- Base movement after evidence/acceptance returns to Repair and requires new evidence and acceptance.
- New Issues never enter finalization recovery; existing active rows remain recoverable through the isolated legacy path.
- Core, Storage, Module API, Git Workspace, Codex Agent, Runtime, Desktop, acceptance, typecheck, lint, and full repository tests pass.
