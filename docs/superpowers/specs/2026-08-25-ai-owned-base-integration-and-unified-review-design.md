# AI-Owned Base Integration and Unified Review Design

**Date:** 2026-08-25

## Goal

Make base-branch integration part of the AI's normal Issue repair responsibility instead of a deterministic publication attempt followed by a separate AI recovery workflow.

The AI works only in the isolated Issue Worktree. It integrates the latest configured base branch, resolves compatible conflicts, verifies the resulting code, and commits the integrated result before evidence and delivery acceptance. The Workspace Provider performs only the final guarded fast-forward of the base branch.

Unify human review in Core so Core models one generic review pause without understanding whether the review concerns assessment, delivery, or a mutually exclusive business decision discovered during integration.

## Problem

The current finalization flow splits one conceptual task across incompatible owners:

1. The AI implements the Issue and leaves the turn before base integration.
2. The Git Workspace Provider computes a merge tree and attempts to publish it.
3. When publication fails, Runtime starts a separate finalization-recovery operation.
4. That recovery AI can inspect or edit only a constrained subset of state, while the Provider continues to own the merge, index, commits, refs, validation, retry, and release lifecycle.

This division has created overlapping merge algorithms, recovery fingerprints, retry budgets, merge-environment classification, generated-artifact recovery, revalidation paths, and UI states. It also produces situations in which the AI understands the failure but is not authorized to perform the semantic merge work needed to resolve it.

Human review is similarly encoded as stage-specific Issue statuses such as `ASSESSMENT_REVIEW` and `ACCEPTANCE_REVIEW`. Adding another stage-specific merge-decision status would further couple Core to product-specific review reasons.

## Product Decisions

1. Base integration is part of Repair. A repair is not delivery-ready until the Issue branch contains the observed base commit, has no unresolved merge state, passes required verification, and has a clean Worktree.
2. The AI may run mutating Git commands only in the isolated Issue Worktree. It may merge the configured base branch, resolve files, stage, and commit there.
3. The AI must never modify, stash, stage, commit, reset, clean, or discard changes in the user's checked-out base Worktree.
4. The Workspace Provider no longer performs semantic merge computation during publication. It verifies the accepted Issue commit and advances the base branch only by safe fast-forward.
5. Ordinary textual conflicts and compatible business changes are resolved automatically by the AI.
6. Human review is requested only when the branches require a mutually exclusive product decision or the AI cannot determine the intended business behavior safely.
7. Business-decision review is not an error. It pauses and resumes the same Repair operation and Agent session without consuming a retry or recovery budget.
8. Core exposes one generic `REVIEW_REQUIRED` state and generic review submission. Core validates review integrity and continuations but does not interpret the review reason or payload.
9. Existing delivery evidence and acceptance remain required after base integration. A business-decision review is an additional gate only when semantic behavior is mutually exclusive.
10. If the base branch advances after integration, the accepted snapshot is stale. The Issue returns to the same AI Repair session, integrates the new base, captures new evidence, and receives new delivery acceptance.

## Selected Flow

```text
create Issue branch from base
  -> AI implements the Issue in the Issue Worktree
  -> AI merges the latest configured base into the Issue branch
  -> compatible conflict: AI resolves, tests, and commits
  -> mutually exclusive behavior: generic human review pause
  -> AI applies the decision, tests, and commits
  -> evidence capture and inspection
  -> delivery acceptance
  -> Provider verifies the accepted commit and base ancestry
  -> Provider safely fast-forwards the base branch
  -> release Issue Worktree and complete Issue
```

The merge direction is deliberate. The AI merges the base branch into the Issue branch inside the isolated Issue Worktree. After that commit, the base commit is an ancestor of the Issue commit, so publication needs only a fast-forward and cannot produce a semantic branch conflict.

## Responsibilities

### AI Repair

The Repair prompt receives:

- the configured base branch and its observed commit;
- the Issue branch and Worktree path;
- the Issue request, assessment, prior feedback, and any submitted review response;
- authority to merge, stage, and commit only within the Issue Worktree;
- an explicit prohibition on changing the base Worktree, other Worktrees, refs outside the Issue branch, remotes, hooks, configuration, or user changes.

The AI must:

1. implement or repair the requested behavior;
2. merge the observed base commit into the Issue branch;
3. inspect both sides of every conflict;
4. automatically preserve compatible intent from both sides;
5. request review instead of selecting a mutually exclusive business behavior;
6. run the smallest relevant verification followed by configured broader checks when feasible;
7. commit the resolved integration result;
8. return the integrated base commit, resulting Issue commit, conflict classification, affected paths, and verification summary.

The AI may resume the same merge after a review response or Runtime restart. A review response is continuation context for the same repair iteration, not a new repair attempt.

### Core

Core owns generic Issue state integrity. It does not own Git semantics and does not interpret review business content.

Core replaces stage-specific review statuses with a single additional status and a generic request envelope:

```ts
type ReviewIssueStatus = "REVIEW_REQUIRED";

interface ReviewRequest {
  id: string;
  kind: string;
  payload: ConfigValue;
  choices: ReviewChoice[];
  requestedAt: string;
}

interface ReviewChoice {
  id: string;
  label: string;
  feedbackRequired?: boolean;
  continuation: ReviewContinuation;
}

interface ReviewContinuation {
  operation?: "ASSESS" | "REPAIR" | "FINALIZE";
  resumeStatus: "ASSESSING" | "REPAIRING" | "FINALIZING" | "CLOSED";
  resolution?: IssueResolution;
}
```

The concrete types may use a stricter JSON-compatible value type and bounded labels, but the review payload remains opaque to Core.

Core exposes two generic actions:

```text
REQUEST_REVIEW
SUBMIT_REVIEW
```

Core guarantees:

- at most one current review per Issue;
- review IDs and Issue revisions reject stale submissions;
- the submitted choice exists in the current request;
- every choice's continuation operation, resume status, and optional resolution are from bounded Core-owned enums;
- only continuations permitted for the requesting source status can be installed or selected;
- the current review is cleared atomically when its response is recorded;
- terminal state, cancellation, and resolution invariants remain enforced;
- review request and response events are durable and bounded.

Core does not decide what `assessment`, `delivery`, `business-merge-conflict`, or future review kinds mean. The stage that requested the review creates the payload and consumes the response.

### Runtime

Runtime adapts existing stage-specific review commands to the generic Core contract.

- Assessment creates a generic review with choices for implementation, reassessment, not-a-bug, and duplicate outcomes.
- Delivery creates a generic review with accept and reject-with-feedback choices.
- Repair creates a `business-merge-conflict` review only when the Agent reports mutually exclusive behavior.

For a business merge conflict, Runtime persists a bounded payload containing:

- observed base and Issue commits;
- sanitized conflict paths;
- the base behavior and intent;
- the Issue behavior and intent;
- why the behaviors cannot both be preserved;
- the AI recommendation and rationale;
- allowed user choices and an optional feedback path.

Submitting the review response queues `REPAIR` against the same Agent session and repair iteration. It does not set `lastFailure`, increment a retry counter, or enter finalization recovery.

Runtime verifies the Agent result before evidence capture:

- the returned base commit matches the Repair input;
- that base commit is an ancestor of Issue `HEAD`;
- Issue `HEAD` equals the returned result commit;
- the Issue branch and Worktree are the expected resource;
- the Worktree and index are clean;
- no merge metadata or unmerged entries remain;
- required result fields and verification summaries are present.

Invalid Agent results are Repair errors. A valid request for business review is not.

### Git Workspace Provider

The Provider continues to acquire, persist, describe, publish, and release Issue Worktrees. Publication becomes smaller:

1. Verify that the accepted delivery token identifies the current Issue commit.
2. Read the current configured base commit.
3. Require the base commit to be an ancestor of the accepted Issue commit.
4. If the base moved beyond the integrated commit, return a stable stale-base result that routes to Repair instead of finalization recovery.
5. If the base is checked out, verify that advancing it will not overwrite personal local state, then run `git merge --ff-only <issueCommit>` in the base Worktree.
6. If the base is not checked out, advance it with compare-and-swap `git update-ref` using the observed base commit.
7. Optionally push according to project configuration, release the Issue Worktree, and complete the Issue.

Publication does not call `merge-tree`, create a synthetic merge commit, resolve conflicts, or start AI recovery. Semantic integration must already exist in the accepted Issue history.

## Personal Changes in the Base Worktree

Personal uncommitted changes are outside AI authority.

- Unrelated tracked, staged, or untracked changes are preserved while the base fast-forwards.
- Exact and ancestor/descendant overlap with paths changed by the accepted Issue commit blocks publication before the base moves.
- Ignored-file checks consider only actual path overlap. A broad parent directory such as `apps` must not recursively classify unrelated ignored descendants as collisions.
- Hidden index entries, populated unsafe submodules, and overlapping Gitlink changes continue to fail closed.
- The system never stashes, commits, resets, cleans, deletes, or rewrites personal changes.

An overlap with personal changes is a user-actionable publication error, not a business merge review. The AI cannot resolve content that is not part of a committed branch history.

## Conflict Classification

The presence of Git conflict markers does not by itself require human review.

### Automatic AI Resolution

Examples include:

- imports added by both branches;
- a rename combined with compatible validation;
- compatible additions to the same component or service;
- formatting, ordering, fixture, snapshot, or test conflicts;
- two behaviors that can be preserved together without changing product intent.

The AI resolves these conflicts, verifies the result, commits, and continues to evidence capture without an additional merge review.

### Human Business Decision

Review is required when:

- one branch enables a behavior that the other intentionally disables;
- both branches assign incompatible meanings to the same API, schema, state, or user action;
- one branch removes a workflow that the other extends;
- both outcomes are reasonable but only one can exist;
- specifications or tests require mutually exclusive observable behavior;
- the AI lacks enough product intent to choose safely.

The AI must explain both intents, the incompatibility, and its recommendation. It must not silently choose one side before review. After the user submits a decision or feedback, the AI applies that instruction in the Issue Worktree, completes the merge, verifies, and commits.

## Review State Model

The unified review state replaces stage-specific review statuses rather than adding another one.

Conceptually:

```text
ASSESSING
  -> REVIEW_REQUIRED(kind=assessment)
  -> ASSESSING | REPAIRING | CLOSED

REPAIRING
  -> REVIEW_REQUIRED(kind=business-merge-conflict)
  -> REPAIRING

EVIDENCE_CHECK
  -> REVIEW_REQUIRED(kind=delivery)
  -> REPAIRING | FINALIZING
```

The concrete continuation selected after submission comes from the current Review Request's bounded choices. UI and Runtime map existing user-facing commands to those choices during migration.

Permission requests remain separate. They represent missing execution authority and resume an active operation after a grant; they are not human product review.

## Base Movement and Concurrency

The Agent integrates one immutable observed base commit. That commit is recorded in the Repair result and delivery draft.

Before final publication:

- if the configured base still equals or is already contained by the accepted Issue history, publication may fast-forward;
- if a newer base commit is not contained by the accepted Issue history, the delivery snapshot is stale;
- Runtime preserves prior evidence as audit history but invalidates the stale delivery snapshot and acceptance, preserves the Issue branch and Agent session, and queues Repair with the new base commit;
- the AI merges the new base, resolves compatible conflicts, requests review only for new mutually exclusive behavior, and returns a new integrated commit;
- new evidence and delivery acceptance are required.

The Provider uses compare-and-swap or Git's checked-out-branch fast-forward checks for the final ref movement. A race during that movement returns the same stale-base outcome. It never overwrites another Issue delivery.

## Error Handling

Business review and technical failure are distinct.

Review path:

- mutually exclusive product behavior;
- insufficient product intent to select one valid behavior;
- explicit user decision needed before the AI continues.

Error path:

- repository corruption or unreadable Worktree;
- missing Git capability or permission;
- unexpected Agent termination or malformed result;
- unresolved merge state after the Agent claims completion;
- personal base-Worktree changes that overlap the accepted delivery;
- forbidden mutation of the base Worktree, refs, hooks, configuration, remotes, or other Worktrees;
- a state that cannot be resumed or restored safely.

Technical errors retain actionable diagnostics and the Issue Worktree. Retrying a technical error may resume the same Agent session when its state is valid, but it is not modeled as a review response.

## UI

The desktop app renders `REVIEW_REQUIRED` from the generic Review Request.

The shared review shell provides:

- review title and summary;
- kind-specific body renderer;
- bounded choices;
- optional feedback input;
- stale-response and submission progress handling;
- cancel behavior consistent with the Issue lifecycle.

Kind-specific renderers include:

- assessment verdict and proposed solution;
- delivery evidence and acceptance controls;
- business merge conflict with both branch intents, incompatible behavior, affected paths, recommendation, and feedback.

Ordinary merge conflicts do not appear as review UI. Activity may report that the AI integrated the base and resolved compatible conflicts, but no user action is required.

## Existing Finalization Recovery

The AI merge-conflict and merge-environment finalization-recovery paths become obsolete after AI-owned integration is fully active.

Generated-artifact cleanup moves into Repair completion validation. If a Repair turn leaves generated artifacts or private temporary content, Runtime rejects that result as a Repair error and resumes the same Repair session with bounded diagnostics. Finalization no longer owns generated-artifact cleanup.

Migration must be staged so existing persisted Issues remain readable:

- existing `ASSESSMENT_REVIEW` and `ACCEPTANCE_REVIEW` rows decode and are converted to equivalent generic Review Requests on recovery or command handling;
- an already-active `FINALIZATION_RECOVERY` operation at upgrade continues under the legacy handler until it reaches a terminal or failed state;
- retrying an existing `FINALIZATION_FAILED` Issue routes it to the new Repair integration flow instead of starting another legacy recovery attempt;
- new Issues use only generic review state and AI-owned base integration;
- unknown future review kinds remain serializable and render through a safe generic fallback.

## Testing

### Core

- generic review request and submission transitions;
- stale ID and revision rejection;
- invalid choice and continuation rejection;
- assessment, delivery, and business-merge reviews represented through one status;
- review response durability and atomic clearing;
- cancellation and terminal-state invariants;
- legacy review-status decoding and migration behavior.

### Agent and Runtime

- Repair receives the observed base commit and Issue-Worktree-only Git authority;
- a clean integration returns delivery-ready with base ancestry metadata;
- ordinary textual conflict is resolved without review;
- compatible business changes are both preserved without review;
- mutually exclusive business behavior requests generic review;
- review submission resumes the same Agent session and repair iteration;
- AI completion with unresolved entries, dirty Worktree, wrong branch, or wrong base ancestry is rejected;
- Runtime restart resumes an active merge or pending review safely;
- a moved base invalidates evidence and requeues Repair against the latest base.

### Git Workspace

- publication performs only a guarded fast-forward of an already-integrated Issue commit;
- publication rejects an Issue commit that does not contain the current base;
- a checked-out base with unrelated tracked, staged, untracked, or ignored content preserves that content exactly;
- overlapping personal content blocks publication without moving the base;
- unrelated ignored descendants under broad parent directories do not create false collisions;
- a non-checked-out base uses compare-and-swap ref update;
- concurrent base movement returns stale-base without losing either Issue;
- no publication path invokes semantic merge-tree recovery.

### Desktop

- one shared review shell renders assessment, delivery, and business-conflict requests;
- business review shows both intents, incompatibility, affected paths, and recommendation;
- ordinary conflict activity requires no review action;
- submitting a choice or feedback disables stale duplicate submissions and resumes Repair;
- legacy review states remain usable during migration.

### End-to-End

1. Create an Issue branch from `main`.
2. Implement the Issue while another committed change advances `main`.
3. Have both branches modify the same behavior compatibly; verify the AI integrates both without extra review.
4. Repeat with mutually exclusive business behavior; verify generic review pauses before the AI chooses.
5. Submit a user decision; verify the same Agent session resolves, tests, commits, captures evidence, and reaches delivery acceptance.
6. Keep unrelated personal modifications in the checked-out `main`; verify final fast-forward preserves them.
7. Add an overlapping personal modification; verify final publication stops without changing `main` or the personal file.
8. Advance `main` after acceptance; verify the delivery returns to Repair, reintegrates, and requires new evidence and acceptance.

## Non-Goals

- Giving the AI authority over the user's base Worktree or personal uncommitted changes.
- Automatically choosing between mutually exclusive product behaviors.
- Replacing evidence capture or delivery acceptance.
- Treating permission requests as product reviews.
- Allowing arbitrary review payloads to select unrestricted Core state transitions.
- Rebasing or rewriting accepted Issue history.
- Automatically pushing when project configuration disables push.

## Success Criteria

- The AI owns semantic base integration as part of normal Repair.
- Compatible conflicts complete without an additional human gate.
- Mutually exclusive business behavior pauses in a generic Core review state and resumes the same Repair session after a user decision.
- Core contains one generic review mechanism rather than stage-specific review statuses.
- Final publication is a guarded fast-forward and never performs semantic merge resolution.
- Personal uncommitted base-Worktree changes are never modified or discarded.
- Base movement produces reintegration, new evidence, and renewed acceptance instead of merge recovery.
- The existing finalization merge-recovery complexity can be removed without losing restart, concurrency, or safety guarantees.
