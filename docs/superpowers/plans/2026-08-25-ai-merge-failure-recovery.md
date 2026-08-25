# AI Merge Failure Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send every Git finalization failure from the `merge` step through one bounded AI recovery turn, deterministically validate the retained Issue Worktree, and complete OHMYBUG-21 through evidence plus renewed acceptance without giving the Agent ownership of Git publication.

**Architecture:** Core owns the public recovery classification and durable Issue summary; Module API transports bounded provider context; Runtime spends the one-attempt budget and orchestrates the Agent. Git first attempts its existing object-level automatic merge, then persists either a provider-prepared conflict session or an inspection-only environment fingerprint. The Agent may diagnose and edit working files, while the Git Provider exclusively owns merge setup, the real index, commits, refs, push, and release. Conflict resolutions always return through evidence and human acceptance before the Provider creates the two-parent merge commit.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, Git CLI 2.38+, Codex SDK, React 19

---

## File structure

- Modify `packages/core/src/issue/types.ts`, `schema.ts`, `results.ts`, and their tests to add a bounded public recovery classification and persist it with the existing attempt state.
- Modify `packages/core/src/agent/adapter.ts` and its test to pass structured merge context into the Agent turn.
- Modify `packages/module-api/src/workspace.ts` and its contract test to return the classification and merge context from providers.
- Modify `packages/workspace-git/src/git-client.ts` and its test to preserve bounded, sanitized failed-command stdout.
- Create `packages/workspace-git/src/merge-recovery.ts` and `packages/workspace-git/test/merge-recovery.test.ts` for merge diagnostics, provider-owned preparation, fingerprints, temporary-index validation, and base movement checks.
- Modify `packages/workspace-git/src/finalization-recovery.ts` and its test only at the dispatch boundary; keep generated-artifact behavior unchanged.
- Modify `packages/workspace-git/src/provider.ts`, `src/index.ts`, and publication tests to persist/resume merge sessions and finalize an accepted resolution.
- Modify Runtime coordinator, worker, demo Agent, and focused tests to persist context, emit merge events, and route every merge diagnostic to AI.
- Modify the Codex recovery prompt and test to give conflict-aware instructions without granting Git mutation authority.
- Modify Desktop Issue detail/activity components and tests to show merge-aware active, resolved, and unsafe states.
- Add a Runtime acceptance test reproducing OHMYBUG-21 and run package plus repository regression verification.

### Task 1: Add shared recovery classification and durable public context

**Files:**
- Modify: `packages/core/src/issue/types.ts`
- Modify: `packages/core/src/issue/schema.ts`
- Modify: `packages/core/src/issue/results.ts`
- Modify: `packages/core/src/agent/adapter.ts`
- Modify: `packages/core/test/issue/schema.test.ts`
- Modify: `packages/core/test/issue/results.test.ts`
- Modify: `packages/core/test/agent/adapter.test.ts`
- Modify: `packages/module-api/src/workspace.ts`
- Modify: `packages/module-api/test/contracts.test.ts`

- [ ] **Step 1: Write failing Core schema and result tests**

Add a merge recovery fixture and prove that the bounded context survives schema parsing and `beginFinalizationRecovery()`:

```ts
const mergeContext: FinalizationRecoveryContextSummary = {
  recoveryKind: "MERGE_CONFLICT",
  merge: {
    kind: "MERGE_CONFLICT",
    baseBranch: "main",
    baseCommit: "a".repeat(40),
    issueBranch: "ohmybug/ohmybug-21",
    issueCommit: "b".repeat(40),
    conflictPaths: ["apps/desktop/src/web/issues/issue-detail.tsx"],
    mergeMessages: ["CONFLICT (content): Merge conflict in issue-detail.tsx"],
    mergePrepared: true,
  },
};

const recovering = beginFinalizationRecovery(finalizing, {
  attemptId: "recovery-21",
  diagnostic: { ...diagnostic, step: "merge", code: "GIT_AUTO_MERGE_CONFLICT" },
  fingerprintRef: "workspace-21:finalization:recovery-21",
  context: mergeContext,
}, now);

expect(issueSchema.parse(recovering).finalizationRecovery?.context).toEqual(mergeContext);
```

Also prove that an old Issue containing no `context` still parses, `MERGE_ENVIRONMENT` accepts no `baseCommit`, and the schema rejects absolute/traversal conflict paths, more than 50 paths, more than 20 messages, or messages over 1,000 characters.

- [ ] **Step 2: Write failing Agent and Module API contract tests**

Compile a `FinalizationRecoveryInput` and provider result with the same typed merge context:

```ts
const context: WorkspaceFinalizationRecoveryContext = {
  fingerprintRef: "workspace-21:finalization:recovery-21",
  workspaceStatus: "UU apps/desktop/src/web/issues/issue-detail.tsx",
  fingerprintSummary: "prepared merge with 1 conflict",
  ...mergeContext,
};

const input: FinalizationRecoveryInput = {
  issue,
  project,
  diagnostic,
  workspaceStatus: context.workspaceStatus,
  fingerprintSummary: context.fingerprintSummary,
  recoveryKind: context.recoveryKind,
  merge: context.merge,
};
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/schema.test.ts test/issue/results.test.ts test/agent/adapter.test.ts
pnpm --filter @oh-my-bug/module-api exec vitest run test/contracts.test.ts
```

Expected: FAIL because the shared classification, merge context, and `context` input field do not exist.

- [ ] **Step 4: Add bounded shared types and schemas**

Define the public shapes in `packages/core/src/issue/types.ts` so Core, Agent adapters, Module API, Runtime, and Desktop use one vocabulary:

```ts
export type FinalizationRecoveryKind =
  | "GENERATED_ARTIFACT_CLEANUP"
  | "MERGE_CONFLICT"
  | "MERGE_ENVIRONMENT";

export interface FinalizationRecoveryMergeContext {
  kind: "MERGE_CONFLICT" | "MERGE_ENVIRONMENT";
  baseBranch: string;
  baseCommit?: string;
  issueBranch: string;
  issueCommit: string;
  conflictPaths: string[];
  mergeMessages: string[];
  mergePrepared: boolean;
}

export interface FinalizationRecoveryContextSummary {
  recoveryKind: FinalizationRecoveryKind;
  merge?: FinalizationRecoveryMergeContext;
}

export interface FinalizationRecoveryState {
  automaticAttempts: 0 | 1;
  attemptId?: string;
  diagnostic?: WorkspaceFinalizationDiagnostic;
  fingerprintRef?: string;
  context?: FinalizationRecoveryContextSummary;
  summary?: string;
}
```

Export matching strict Zod schemas from `issue/schema.ts`. Refine the discriminated relationship: generated cleanup has no merge object; `MERGE_CONFLICT` requires `merge.kind === "MERGE_CONFLICT"`, `mergePrepared === true`, `baseCommit`, and at least one conflict path; `MERGE_ENVIRONMENT` requires `merge.kind === "MERGE_ENVIRONMENT"` and `mergePrepared === false`.

Extend `BeginFinalizationRecoveryInput` with `context` and store it unchanged. Extend `FinalizationRecoveryInput` with `recoveryKind` and optional `merge`.

- [ ] **Step 5: Extend the provider contract without leaking private session state**

Make `WorkspaceFinalizationRecoveryContext` extend the public summary:

```ts
export interface WorkspaceFinalizationRecoveryContext
  extends FinalizationRecoveryContextSummary {
  fingerprintRef: string;
  workspaceStatus: string;
  fingerprintSummary: string;
}
```

Do not add merge indexes, ref snapshots, filesystem hashes, repository paths, raw file contents, or credentials to Core or Module API. Those remain private Git module state.

- [ ] **Step 6: Run tests and typechecks**

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/schema.test.ts test/issue/results.test.ts test/agent/adapter.test.ts
pnpm --filter @oh-my-bug/module-api exec vitest run test/contracts.test.ts
pnpm --filter @oh-my-bug/core typecheck
pnpm --filter @oh-my-bug/module-api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the public contract**

```bash
git add packages/core packages/module-api
git commit -m "feat(core): classify merge finalization recovery"
```

### Task 2: Preserve bounded merge-tree failure output

**Files:**
- Modify: `packages/workspace-git/src/git-client.ts`
- Modify: `packages/workspace-git/test/git-client.test.ts`

- [ ] **Step 1: Write failing failed-stdout sanitization tests**

Run a temporary executable through the existing Git test fixture that exits non-zero with a worktree path and token-like text on stdout. Assert:

```ts
await expect(runGit(repository, ["merge-tree", "--write-tree", "missing", "missing"]))
  .rejects.toMatchObject({
    name: "GitCommandError",
    command: "merge-tree",
    stdout: expect.any(String),
  });
```

Add direct `GitCommandError` construction coverage proving `stdout` is at most 8,000 characters, replaces the current workspace with `<workspace>`, redacts `token=secret-value`, and strips control characters. Preserve the existing stderr assertions.

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/git-client.test.ts
```

Expected: FAIL because `GitCommandError` currently discards stdout.

- [ ] **Step 3: Add sanitized stdout to `GitCommandError`**

Implement the symmetric bounded field:

```ts
export class GitCommandError extends Error {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(input: { cwd: string; args: readonly string[]; cause: unknown }) {
    super(`GIT_COMMAND_FAILED:${input.args[0] ?? "unknown"}`, { cause: input.cause });
    this.name = "GitCommandError";
    this.command = input.args[0] ?? "unknown";
    this.args = [...input.args];
    this.exitCode = numericProperty(input.cause, "code");
    this.stdout = sanitizeGitDiagnosticText(
      stringProperty(input.cause, "stdout"),
      input.cwd,
      8_000,
    );
    this.stderr = sanitizeGitDiagnosticText(
      stringProperty(input.cause, "stderr"),
      input.cwd,
      8_000,
    );
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/git-client.test.ts
pnpm --filter @oh-my-bug/workspace-git typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the Git diagnostic primitive**

```bash
git add packages/workspace-git/src/git-client.ts packages/workspace-git/test/git-client.test.ts
git commit -m "feat(git): retain bounded failed command output"
```

### Task 3: Produce structured merge-conflict diagnostics

**Files:**
- Create: `packages/workspace-git/src/merge-recovery.ts`
- Create: `packages/workspace-git/test/merge-recovery.test.ts`
- Modify: `packages/workspace-git/src/finalization-recovery.ts`
- Modify: `packages/workspace-git/src/provider.ts`
- Modify: `packages/workspace-git/test/publish.test.ts`

- [ ] **Step 1: Add a failing divergent-branch publication test**

Create compatible base and Issue branches that edit the same line, call `publish()`, and assert the thrown `WorkspaceFinalizationError` contains bounded conflict paths:

```ts
await expect(provider.publish({ issue: finalizing, resourceId }))
  .rejects.toMatchObject({
    diagnostic: {
      step: "merge",
      code: "GIT_AUTO_MERGE_CONFLICT",
      relatedPaths: ["src/feature.ts"],
    },
  });
```

Also test a filename containing spaces and a message containing an absolute path. Assert path parsing remains repository-relative and messages are sanitized.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/publish.test.ts test/merge-recovery.test.ts
```

Expected: FAIL because the current `GIT_AUTO_MERGE_CONFLICT` diagnostic has no paths or merge messages.

- [ ] **Step 3: Add a typed internal conflict error and parser**

In `merge-recovery.ts`, add an internal error that carries only sanitized, bounded metadata:

```ts
export class GitAutomaticMergeConflictError extends Error {
  constructor(
    readonly conflictPaths: string[],
    readonly mergeMessages: string[],
    cause: unknown,
  ) {
    super("GIT_AUTO_MERGE_CONFLICT", { cause });
    this.name = "GitAutomaticMergeConflictError";
  }
}
```

Implement `parseMergeTreeConflictOutput(stdout, stderr)` by accepting only normalized repository-relative paths from `CONFLICT (...)` and `Auto-merging` records, de-duplicating and sorting them, limiting paths to 50 and messages to 20 × 1,000 characters. Treat the later prepared index as authoritative; this parser only improves the initial diagnostic.

- [ ] **Step 4: Wire the diagnostic into object-level automatic merge**

When `merge-tree --write-tree` exits `1`, throw `GitAutomaticMergeConflictError`. Extend `finalizationError()` to recognize it:

```ts
const mergeConflict = input.error instanceof GitAutomaticMergeConflictError
  ? input.error
  : undefined;

return new WorkspaceFinalizationError({
  providerId: input.providerId,
  step: input.step,
  code: mergeConflict?.message ?? code,
  message,
  relatedPaths: mergeConflict?.conflictPaths
    ?? generatedArtifactsError?.relatedPaths
    ?? relatedPaths(stderr ?? code, input.worktreePath),
}, input.error);
```

Keep clean merge behavior, Git 2.38 gating, and non-conflict error codes unchanged.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/git-client.test.ts test/publish.test.ts test/merge-recovery.test.ts
pnpm --filter @oh-my-bug/workspace-git typecheck
git add packages/workspace-git
git commit -m "feat(git): expose structured merge conflict diagnostics"
```

Expected: PASS.

### Task 4: Prepare and persist provider-owned merge recovery sessions

**Files:**
- Modify: `packages/workspace-git/src/merge-recovery.ts`
- Modify: `packages/workspace-git/src/finalization-recovery.ts`
- Modify: `packages/workspace-git/src/provider.ts`
- Modify: `packages/workspace-git/src/index.ts`
- Modify: `packages/workspace-git/test/merge-recovery.test.ts`
- Modify: `packages/workspace-git/test/finalization-recovery.test.ts`

- [ ] **Step 1: Write failing conflict preparation tests**

Cover all preparation invariants with real temporary repositories:

- `step: "merge"` is accepted regardless of diagnostic code or `relatedPaths`.
- A content conflict runs only in the Issue Worktree; base checkout `HEAD`, status, and index remain unchanged.
- `HEAD` remains the approved Issue commit, `MERGE_HEAD` equals the immutable failed-publication base commit, and `git ls-files -u` yields the authoritative conflict set.
- Repeating the same `attemptId` resumes the exact session without running a second merge.
- A different/foreign `MERGE_HEAD` is preserved and returns inspection-only `MERGE_ENVIRONMENT` context.
- Missing local base, unsupported Git, dirty pre-existing Issue Worktree, ref lock, and specialized preparation failure return `MERGE_ENVIRONMENT` with `mergePrepared: false` instead of throwing `FINALIZATION_RECOVERY_DIAGNOSTIC_UNSUPPORTED`.
- An unreadable/missing Issue Worktree is still a preparation error.
- Existing `add` generated-artifact recovery passes unchanged; non-add, non-merge diagnostics remain unsupported.

Assert the conflict context exactly:

```ts
expect(context).toMatchObject({
  recoveryKind: "MERGE_CONFLICT",
  merge: {
    kind: "MERGE_CONFLICT",
    baseBranch: "main",
    baseCommit,
    issueBranch: "ohmybug/ohmybug-21",
    issueCommit,
    conflictPaths: ["src/feature.ts"],
    mergePrepared: true,
  },
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/finalization-recovery.test.ts test/merge-recovery.test.ts
```

Expected: FAIL because merge preparation is rejected by the generated-artifact allowlist.

- [ ] **Step 3: Define versioned private provider state**

Add a backward-compatible union in `provider.ts`/`merge-recovery.ts`:

```ts
export type GitFinalizationRecoveryState =
  | {
      version: 1;
      kind: "GENERATED_ARTIFACT_CLEANUP";
      fingerprint: GitFinalizationFingerprint;
    }
  | {
      version: 1;
      kind: "MERGE_CONFLICT";
      session: GitMergeRecoverySession;
    }
  | {
      version: 1;
      kind: "MERGE_ENVIRONMENT";
      fingerprint: GitFinalizationFingerprint;
      merge: FinalizationRecoveryMergeContext;
    };

export interface GitMergeRecoverySession {
  version: 1;
  attemptId: string;
  fingerprintRef: string;
  baseBranch: string;
  baseCommit: string;
  issueBranch: string;
  issueCommit: string;
  headRef: string;
  conflictPaths: string[];
  mergeMessages: string[];
  preparedIndexHash: string;
  conflictStagesHash: string;
  repositoryStateHash: string;
  refsHash: string;
  configHash: string;
  preparedContent: GitMergeContentFingerprint[];
}
```

Change `GitWorkspaceState.finalizationRecovery` to accept this union plus the legacy bare `GitFinalizationFingerprint`. Normalize legacy state to `GENERATED_ARTIFACT_CLEANUP` on read without rewriting it merely for inspection. Reject a malformed active merge session as unsafe and preserve the Worktree.

- [ ] **Step 4: Implement bounded conflict preparation and fallback**

Dispatch in `prepareFinalizationRecovery()`:

```ts
if (input.diagnostic.step === "merge") {
  return prepareGitMergeRecovery({
    state,
    diagnostic: input.diagnostic,
    attemptId: input.attemptId,
    fingerprintRef,
  });
}
return prepareGitFinalizationRecovery({
  worktreePath: state.worktreePath,
  diagnostic: input.diagnostic,
  attemptId: input.attemptId,
  fingerprintRef,
});
```

For conflict preparation, verify the saved issue branch and current issue `HEAD`; capture config/refs/index/status; run Provider-owned `git merge --no-commit --no-ff` with the exact recorded 40-character base commit as the final argument; require conflict exit `1`, expected `MERGE_HEAD`, and non-empty `ls-files -u`; then fingerprint the prepared index, conflict stages, non-conflicting result, and all visible content.

If a check fails before Provider mutation, return `MERGE_ENVIRONMENT`. If Provider started the merge, either prove exact restoration to the pre-merge fingerprint or retain and fingerprint the provider-owned state; never run `merge --abort`, `reset`, `clean`, or overwrite a foreign merge state. Set `mergePrepared: false` for inspection-only context and tell the Agent not to edit.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/finalization-recovery.test.ts test/merge-recovery.test.ts
pnpm --filter @oh-my-bug/workspace-git typecheck
git add packages/workspace-git
git commit -m "feat(git): prepare merge recovery sessions"
```

Expected: PASS.

### Task 5: Validate Agent merge work with a temporary index

**Files:**
- Modify: `packages/workspace-git/src/merge-recovery.ts`
- Modify: `packages/workspace-git/src/provider.ts`
- Modify: `packages/workspace-git/test/merge-recovery.test.ts`
- Modify: `packages/workspace-git/test/finalization-recovery.test.ts`

- [ ] **Step 1: Write failing deterministic validation tests**

For a prepared conflict session, add one passing source resolution and one test per rejection boundary:

- resolved files with no markers and unchanged Git state return `CHANGED` even when Agent says `RECOVERED`;
- real index bytes/hash remain identical before and after validation;
- unresolved entries, missing conflict paths, or conflict markers return `UNSAFE`;
- changed `HEAD`, `HEAD` ref, `MERGE_HEAD`, refs, config, real index, index flags, or foreign merge metadata return `UNSAFE`;
- an undeclared out-of-conflict edit returns `UNSAFE`; an Agent-reported directly related path is accepted only when it is a normal tracked file and included in the temporary resolved tree;
- new generated roots, Gitlinks, dirty submodules, hidden-index entries, symlink escapes, and new untracked files return `UNSAFE`;
- temporary `read-tree`/`add`/`write-tree` failure returns `UNSAFE` without touching the real index;
- `MERGE_ENVIRONMENT` unchanged content plus passing publication preflight returns `UNCHANGED`;
- `MERGE_ENVIRONMENT` changed approved source returns `CHANGED`;
- unresolved external/ref/policy failure returns `UNSAFE`.

Use the Agent result only as an input hint:

```ts
const result: FinalizationRecoveryResult = {
  summary: "Preserved the base preview changes and the Issue X icon intent.",
  diagnosis: "Both branches changed the cancel-button block.",
  disposition: "RECOVERED",
  affectedPaths: ["src/feature.ts"],
};

expect(await provider.validateFinalizationRecovery?.({
  issue,
  resourceId,
  fingerprintRef,
  result,
})).toEqual({ kind: "CHANGED", changedPaths: ["src/feature.ts"] });
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/merge-recovery.test.ts test/finalization-recovery.test.ts
```

Expected: FAIL because validation currently understands only generated-artifact fingerprints.

- [ ] **Step 3: Implement private-state dispatch and invariant checks**

Dispatch by normalized persisted kind. For `MERGE_CONFLICT`, compare immutable session fields first. Read unmerged paths from the real index but never stage it. Scan bounded text files for standard conflict marker lines and reject binary/conflicted content that cannot be proven resolved.

Construct the candidate tree in a temporary directory:

```ts
const options: RunGitOptions = {
  env: {
    GIT_INDEX_FILE: temporaryIndex,
    GIT_OBJECT_DIRECTORY: temporaryObjects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: repositoryObjects,
  },
};

await copyFile(realIndex, temporaryIndex);
await runGit(worktreePath, ["add", "--", ...literalPathspecs(allowedPaths)], options);
const remaining = await runGit(worktreePath, ["ls-files", "-u", "-z"], options);
if (remaining) return unsafe("GIT_MERGE_RECOVERY_UNRESOLVED", conflictPaths);
const resolvedTree = await runGit(worktreePath, ["write-tree"], options);
```

Persist the candidate tree ID in private module state only after all validation succeeds, because final publication must recompute and compare it after renewed acceptance. Always return `CHANGED` for a valid prepared source conflict. For environment recovery, reuse the existing content fingerprint and publication preflight rules; do not let Agent disposition override deterministic results.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/merge-recovery.test.ts test/finalization-recovery.test.ts
pnpm --filter @oh-my-bug/workspace-git typecheck
git add packages/workspace-git
git commit -m "feat(git): validate merge recovery trees"
```

Expected: PASS.

### Task 6: Finalize a reaccepted merge resolution and reject stale bases

**Files:**
- Modify: `packages/workspace-git/src/merge-recovery.ts`
- Modify: `packages/workspace-git/src/provider.ts`
- Modify: `packages/workspace-git/test/publish.test.ts`
- Modify: `packages/workspace-git/test/merge-recovery.test.ts`

- [ ] **Step 1: Write failing post-acceptance publication tests**

Prepare and validate a conflict, simulate evidence plus renewed delivery acceptance, then call `publish()` and assert:

```ts
const mergeCommit = await runGit(issueWorktree, ["rev-parse", "HEAD"]);
expect((await runGit(repository, ["show", "-s", "--format=%P", mergeCommit])).split(" "))
  .toEqual([issueCommit, baseCommit]);
expect(await runGit(repository, ["rev-parse", "refs/heads/main"]))
  .toBe(mergeCommit);
```

Also assert the Provider stages only the validated allowlist into the real index, recomputes the candidate tree, uses the expected two parents, clears the merge session only after successful branch info persistence, and keeps existing push/release behavior.

Add movement cases:

- exact prepared base continues;
- base advanced from prepared base returns `GIT_AUTO_MERGE_BASE_MOVED` without committing the stale resolution;
- rewritten or deleted base returns unsafe merge failure;
- re-entering publication after a process restart resumes the saved session;
- a candidate tree changed after validation is rejected and never committed;
- a clean automatic merge still avoids all recovery state.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/publish.test.ts test/merge-recovery.test.ts
```

Expected: FAIL because `publish()` does not recognize or verify a prepared merge session.

- [ ] **Step 3: Add the provider-owned finalization branch**

At the start of `publish()`, after status ownership checks and before the ordinary add/commit path, detect a validated `MERGE_CONFLICT` session. Require the Issue to be in `FINALIZING`, the current base ref to equal `session.baseCommit`, `HEAD` to equal `session.issueCommit`, and `MERGE_HEAD` to match. Recompute deterministic validation, stage only allowed paths into the real index, compare `write-tree` with the saved candidate tree, and run:

```ts
await runGit(state.worktreePath, [
  "commit",
  "-m",
  `Merge ${state.branch} into ${state.baseBranch}`,
]);
```

Verify the resulting parents are `[session.issueCommit, session.baseCommit]`. Then let the existing `mergeIntoBaseBranch()` ancestor fast path update the base safely. Do not use `commit-tree` for the prepared Worktree path because the Provider must close its own `MERGE_HEAD` state through the normal merge commit.

When the base moved, throw `GIT_AUTO_MERGE_BASE_MOVED`; Runtime will spend a fresh recovery attempt only after the latest human approval reset the budget. Never silently replay a resolution onto another base.

- [ ] **Step 4: Run Git regressions and commit**

```bash
pnpm --filter @oh-my-bug/workspace-git test
pnpm --filter @oh-my-bug/workspace-git typecheck
git add packages/workspace-git
git commit -m "feat(git): publish accepted merge resolutions"
```

Expected: PASS.

### Task 7: Orchestrate every merge failure through the Agent

**Files:**
- Modify: `apps/runtime/src/orchestration/workspace-coordinator.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/src/testing/demo-agent.ts`
- Modify: `apps/runtime/test/workspace-finalization.test.ts`
- Modify: `apps/runtime/test/finalization-recovery-worker.test.ts`
- Modify: `apps/runtime/test/recovery.test.ts`

- [ ] **Step 1: Write failing coordinator and worker tests**

Prove these Runtime behaviors:

- every diagnostic with `step: "merge"`, a READY readable binding, Agent support, and unused budget queues `RECOVER_FINALIZATION`, independent of diagnostic code and paths;
- `beginFinalizationRecovery()` receives the public context summary;
- `DELIVERY_FINALIZATION_RECOVERY_STARTED` persists bounded `recoveryKind`, merge context, workspace status, and fingerprint summary;
- prepared conflicts additionally emit `DELIVERY_FINALIZATION_MERGE_PREPARED` with commits, conflict count, and paths, but no raw file content;
- Worker reconstructs and passes `recoveryKind`/`merge` to the existing Agent session after a Runtime restart;
- valid conflict validation routes to `EVIDENCE_CAPTURE` even if Agent says `RECOVERED` and emits `DELIVERY_FINALIZATION_MERGE_RESOLVED` plus `DELIVERY_FINALIZATION_REVALIDATION_REQUIRED`;
- rejecting that changed delivery returns to Repair without clearing or aborting the provider-owned merge session;
- environment `UNCHANGED` retries `FINALIZE` once;
- `UNSAFE` stops in `FINALIZATION_FAILED` with actionable bounded reason;
- if the base advances after renewed acceptance, `GIT_AUTO_MERGE_BASE_MOVED` starts a new bounded recovery because that acceptance reset the attempt budget; a rewritten or deleted base stays unsafe;
- missing/unreadable Worktree, unavailable Agent adapter, and spent budget remain terminal gates;
- capability pause/resume retains the same attempt and context;
- stale Agent results cannot validate a newer Issue revision/session.

Use a merge context fixture rather than a provider-specific cast:

```ts
expect(agent.recoveryInputs[0]).toMatchObject({
  recoveryKind: "MERGE_CONFLICT",
  merge: {
    baseBranch: "main",
    conflictPaths: ["apps/desktop/src/web/issues/issue-detail.tsx"],
    mergePrepared: true,
  },
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/workspace-finalization.test.ts test/finalization-recovery-worker.test.ts test/recovery.test.ts
```

Expected: FAIL because Runtime does not persist or pass structured recovery classification and emits no merge events.

- [ ] **Step 3: Persist and forward the bounded context**

Pass `context: { recoveryKind: context.recoveryKind, ...(context.merge ? { merge: context.merge } : {}) }` to `beginFinalizationRecovery()`. Persist the same bounded fields in `DELIVERY_FINALIZATION_RECOVERY_STARTED`. In Worker, validate event fields structurally before invoking the Agent; a malformed event becomes `FINALIZATION_RECOVERY_CONTEXT_REQUIRED`, not an unchecked cast.

Keep eligibility generic in Runtime. Do not add merge code/path allowlists there. The Git Provider is responsible for converting specialized preparation failures into `MERGE_ENVIRONMENT`; coordinator preparation errors continue to mean the Worktree/provider cannot safely provide an Agent turn.

- [ ] **Step 4: Emit semantic merge events**

On prepared context append:

```ts
transaction.appendEvent(this.event(issue.id, "DELIVERY_FINALIZATION_MERGE_PREPARED", {
  attemptId,
  baseCommit: context.merge.baseCommit,
  issueCommit: context.merge.issueCommit,
  conflictCount: context.merge.conflictPaths.length,
  conflictPaths: context.merge.conflictPaths,
}));
```

On `CHANGED` validation for `MERGE_CONFLICT`, append `DELIVERY_FINALIZATION_MERGE_RESOLVED` with changed-path count, bounded paths, validation kind, and Agent summary. Reuse generic recovery events for the overall lifecycle.

- [ ] **Step 5: Run Runtime tests and commit**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/workspace-finalization.test.ts test/finalization-recovery-worker.test.ts test/recovery.test.ts
pnpm --filter @oh-my-bug/runtime typecheck
git add apps/runtime
git commit -m "feat(runtime): orchestrate merge recovery turns"
```

Expected: PASS.

### Task 8: Make the Codex recovery prompt merge-aware

**Files:**
- Modify: `packages/agent-codex/src/finalization-recovery-prompt.ts`
- Modify: `packages/agent-codex/test/finalization-recovery.test.ts`

- [ ] **Step 1: Write failing prompt tests for all recovery kinds**

For `MERGE_CONFLICT`, assert the prompt includes Issue intent, accepted delivery summary, base/Issue branches and commits, every conflict path, merge messages, current status, fingerprint summary, and the ownership boundary. Assert it explicitly forbids `git add`, `commit`, `merge`, `rebase`, `reset`, `clean`, `push`, ref updates, and release.

For `MERGE_ENVIRONMENT`, assert `mergePrepared: false` instructs diagnosis-only behavior and says not to edit unless the context proves a safe Issue-Worktree-only repair. For generated cleanup, assert the existing generated-root instructions remain present and merge-specific directions are absent.

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/finalization-recovery.test.ts
```

Expected: FAIL because the prompt is generated-artifact specific.

- [ ] **Step 3: Split shared safety text from kind-specific instructions**

Keep one response envelope and capability section, then dispatch:

```ts
function recoveryInstructions(input: FinalizationRecoveryInput): string[] {
  if (input.recoveryKind === "MERGE_CONFLICT" && input.merge?.mergePrepared) {
    return [
      "Resolve the Provider-prepared content conflicts in the retained Issue Worktree.",
      "Preserve both the Issue intent and compatible base-branch behavior.",
      "Edit working files only. Never stage files or mutate Git state.",
      `Merge context: ${JSON.stringify(input.merge)}`,
    ];
  }
  if (input.recoveryKind === "MERGE_ENVIRONMENT") {
    return [
      "Diagnose this merge environment or policy failure.",
      "Do not edit the base checkout, refs, hooks, Git configuration, permissions, or repository policy.",
      `Merge context: ${JSON.stringify(input.merge)}`,
    ];
  }
  return generatedArtifactInstructions(input.fingerprintSummary);
}
```

Require `REVALIDATION_REQUIRED` whenever source was edited. Clarify that Agent disposition is advisory and the Provider validates independently.

- [ ] **Step 4: Run tests, typecheck, and commit**

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/finalization-recovery.test.ts
pnpm --filter @oh-my-bug/agent-codex typecheck
git add packages/agent-codex
git commit -m "feat(agent): guide merge finalization recovery"
```

Expected: PASS.

### Task 9: Show merge-aware recovery state in Desktop

**Files:**
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`
- Modify: `apps/desktop/src/web/issues/issue-status.tsx`
- Modify: `apps/desktop/src/web/issues/agent-activity.tsx`
- Modify: `apps/desktop/test/web/issues.test.tsx`
- Modify: `apps/desktop/test/web/agent-activity.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Render a `FINALIZATION_RECOVERY` Issue with `context.recoveryKind === "MERGE_CONFLICT"`. Assert the list/status badge shows `AI 正在修复合并`, the detail panel shows `AI 正在解析合并问题`, base branch `main`, and the bounded conflict path; assert no manual retry button exists while active.

Render `MERGE_ENVIRONMENT` and assert it explains that AI is diagnosing a merge environment problem without claiming it can always auto-fix it. Render generated cleanup and assert the existing generic copy remains unchanged.

Add activity fixtures for:

```ts
"DELIVERY_FINALIZATION_MERGE_PREPARED"
"DELIVERY_FINALIZATION_MERGE_RESOLVED"
```

Assert the labels are `已准备合并冲突供 AI 解析` and `AI 已解析合并冲突，等待重新验证`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/issues.test.tsx test/web/agent-activity.test.tsx
```

Expected: FAIL because the UI has only generic finalization-recovery copy and no merge event labels.

- [ ] **Step 3: Implement bounded merge presentation**

Branch only on the public Issue context, never on provider-private fields. Extend `IssueStatusBadge` with an optional `recoveryKind` prop, pass `issue.finalizationRecovery?.context?.recoveryKind` from the list, summary, and detail call sites in `app.tsx`/`issue-detail.tsx`, and select `AI 正在修复合并` only for the two merge kinds. Show at most the schema-bounded 50 paths, preserve repository-relative text, and do not render raw merge output. Keep existing recovery/failure controls and list behavior intact; use diagnostic step `merge` only as a backward-compatible fallback for old Issues lacking `context`.

- [ ] **Step 4: Run Desktop tests and typecheck**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/issues.test.tsx test/web/agent-activity.test.tsx
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the UI**

```bash
git add apps/desktop/src/web/app.tsx apps/desktop/src/web/issues apps/desktop/test/web
git commit -m "feat(desktop): explain AI merge recovery"
```

### Task 10: Prove the OHMYBUG-21 lifecycle end to end

**Files:**
- Create: `apps/runtime/test/acceptance/merge-finalization-recovery.test.ts`
- Modify: `apps/runtime/test/acceptance/finalization-recovery.test.ts`

- [ ] **Step 1: Write the failing OHMYBUG-21 acceptance scenario**

Build a real temporary Git repository and Git Workspace provider:

1. Create the Issue Worktree from an older `main` commit.
2. In the Issue branch, change the icon import and cancel button to use `X`.
3. In `main`, change the same component block with compatible image-preview and recovery UI behavior, then return the fixture checkout to the Issue Worktree so the Provider alone owns later Git mutations.
4. Approve delivery and observe `GIT_AUTO_MERGE_CONFLICT`.
5. Assert Runtime enters `FINALIZATION_RECOVERY` and the scripted Agent receives the component path, both immutable commits, Issue request, and accepted delivery summary.
6. Have the scripted Agent write the semantically combined component without running Git mutation.
7. Assert validation is `CHANGED`, the Issue enters `EVIDENCE_CAPTURE`, and no merge commit or base update exists yet.
8. Complete evidence capture and renewed acceptance.
9. Assert the Provider creates a two-parent merge commit, safely updates `main`, releases the Worktree, and Runtime reaches `COMPLETED`.

Also assert durable event order includes:

```ts
[
  "WORKSPACE_PUBLISH_FAILED",
  "DELIVERY_FINALIZATION_RECOVERY_STARTED",
  "DELIVERY_FINALIZATION_MERGE_PREPARED",
  "DELIVERY_FINALIZATION_RECOVERY_COMPLETED",
  "DELIVERY_FINALIZATION_MERGE_RESOLVED",
  "DELIVERY_FINALIZATION_REVALIDATION_REQUIRED",
  "ISSUE_COMPLETED",
]
```

- [ ] **Step 2: Add regression acceptance cases**

Keep the existing OHMYBUG-14 generated-artifact scenario unchanged. Add a merge-environment case showing an unknown merge error still reaches the Agent and ends `FINALIZATION_FAILED` only after the Agent/provider classify it unsafe. Add a clean automatic merge case proving no Agent recovery turn occurs. Add a rejection case proving the resolved Worktree and provider session survive when the user rejects the new delivery, with no automatic abort, reset, or cleanup.

- [ ] **Step 3: Run acceptance tests and verify RED, then GREEN**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/acceptance/finalization-recovery.test.ts test/acceptance/merge-finalization-recovery.test.ts
```

Expected before final fixture/wiring adjustments: FAIL at the first missing lifecycle assertion. Expected after completing the acceptance harness: PASS.

- [ ] **Step 4: Commit acceptance coverage**

```bash
git add apps/runtime/test/acceptance
git commit -m "test(runtime): cover OHMYBUG-21 merge recovery"
```

### Task 11: Run cross-package regression and review safety boundaries

**Files:**
- Modify only files required to fix regressions found by these commands.

- [ ] **Step 1: Run all affected package suites**

```bash
pnpm --filter @oh-my-bug/core test
pnpm --filter @oh-my-bug/module-api test
pnpm --filter @oh-my-bug/workspace-git test
pnpm --filter @oh-my-bug/agent-codex test
pnpm --filter @oh-my-bug/runtime test
pnpm --filter @oh-my-bug/desktop test
```

Expected: PASS. If Desktop/runtime Electron evidence tests fail solely because `Electron Framework.framework/Electron Framework` is absent in the local installation, record that exact environment failure and separately prove every touched focused suite passes; do not weaken or skip the tests in source.

- [ ] **Step 2: Run repository typechecks**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the full repository suite in a valid Electron environment**

```bash
pnpm test
```

Expected: PASS when Electron is valid. The pre-existing local broken Framework symlink is an environment repair prerequisite, not an accepted product failure.

- [ ] **Step 4: Audit the authority boundary**

Inspect the diff and tests to prove:

- Runtime has no merge error-code/path allowlist before the Agent turn.
- The Agent prompt never authorizes mutating Git.
- Only Git Provider code runs `merge --no-commit`, stages the real/temporary index, commits, updates refs, pushes, or releases.
- A valid source conflict can never validate as `UNCHANGED`.
- A base-ref mismatch can never publish a stale resolution.
- Events and public Issue state contain no raw conflict contents, absolute paths, credentials, index bytes, or unrestricted Git output.
- Legacy generated-artifact recovery and old module state still work.

- [ ] **Step 5: Review the implementation against the approved design**

Read `docs/superpowers/specs/2026-08-25-ai-merge-failure-recovery-design.md` and check every Success Criterion and Testing bullet against a named automated test. Search for accidental suppression markers and the old unsupported gate:

```bash
rg -n "@ts-ignore|@ts-expect-error|FINALIZATION_RECOVERY_DIAGNOSTIC_UNSUPPORTED" packages apps
```

Expected: no new TypeScript suppression; the unsupported diagnostic string may remain only for non-merge legacy behavior and its explicit regression test.

- [ ] **Step 6: Commit any verified regression fixes**

```bash
git status --short
git add packages apps
git commit -m "fix: close merge recovery regressions"
```

Skip this commit when the worktree is clean. Do not commit generated test output, Electron installation changes, or unrelated workspace modifications.
