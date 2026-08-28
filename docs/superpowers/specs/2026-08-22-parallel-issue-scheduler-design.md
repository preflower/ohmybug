# Parallel Issue Scheduler Design

## Goal

Allow Oh My Bug ?! to advance up to three independent Issues concurrently. A newly accepted Issue must start as soon as a scheduler slot is available instead of waiting for an unrelated Issue's Agent turn, evidence capture, or finalization to finish.

The scheduler must preserve the existing state-machine and session guarantees: operations for one Issue remain strictly ordered, and only one operation for a given Issue may be in flight at a time.

## Current behavior and root cause

`RuntimeWorker` owns one `running` promise. Its pump selects the first pending operation, awaits that operation to completion, and only then selects another. Separate Git worktrees isolate Issue files, but the Runtime never schedules more than one Issue operation concurrently.

The observed OHMYBUG-9/OHMYBUG-10 timeline demonstrates this behavior. OHMYBUG-10 was accepted while OHMYBUG-9 was capturing evidence, then began workspace preparation immediately after OHMYBUG-9's active operation ended.

## Chosen approach

Replace the serial pump with one in-process, bounded scheduler. The scheduler owns a set of active Issue IDs and fills at most three slots from durable pending operations.

This approach is preferred over three independent polling workers because it prevents two workers from selecting the same pending Issue before its operation claims state. It is preferred over SQLite leases because Oh My Bug ?! currently has one Runtime process; cross-process leases, expiry, and recovery would add complexity without a current consumer.

The concurrency limit defaults to three and is an internal `RuntimeWorker` option so tests can use smaller limits deterministically. This change does not add a settings UI or persistent configuration.

## Scheduling model

The scheduler maintains these in-memory structures:

- `active`: Issue ID to in-flight operation promise;
- `failedInPump`: Issue IDs whose operation threw an unexpected error during the current pump;
- one pump promise used by `kick()` and `drain()`.

Each scheduling cycle performs the following steps:

1. Read durable pending operations from `RuntimeStore`.
2. Exclude Issues already in `active` or `failedInPump`.
3. Select pending operations in the store's existing deterministic order until the three-slot limit is reached.
4. Add each selected Issue ID to `active` synchronously before invoking asynchronous workspace or Agent work.
5. Wait until at least one active operation settles, remove its Issue ID from `active`, and fill the open slot.
6. Finish when no eligible pending work and no active operation remain.

An operation may enqueue the next stage for its own Issue. That next stage becomes eligible only after the current promise settles and the Issue ID leaves `active`, preserving per-Issue serialization.

`drainOne()` remains a deterministic single-operation testing and maintenance primitive. The concurrent behavior belongs to `kick()` and `drain()` through the scheduler pump.

## Wake-up and drain semantics

`kick()` remains idempotent: if a pump is already running, a wake-up does not create a second pump. The existing pump observes newly durable pending work whenever it fills an available slot.

`drain()` starts the pump when needed and resolves only after:

- all operations started by the pump have settled; and
- no eligible durable pending operation remains.

This preserves existing callers that use `drain()` as a quiescence boundary while allowing several Issues to make progress inside that boundary.

## Error handling

Expected Agent, evidence, and workspace failures continue to use their existing state transitions and events.

If an operation throws an unexpected error:

- record the Issue ID in `failedInPump` so the same durable pending operation is not retried in a tight loop;
- keep scheduling and awaiting unrelated Issues;
- retain the first unexpected error and reject `drain()` after all other eligible work has reached quiescence.

A later explicit `kick()` creates a fresh pump and may retry that Issue, matching the current recoverable wake-up behavior without allowing one broken Issue to block the queue.

## Shutdown behavior

`beginShutdown()` prevents the scheduler from starting additional operations. Operations already in `active` remain visible to `drain()` while Runtime cancellation propagates to their Agent sessions. Runtime shutdown waits for all active operations to settle before closing modules and SQLite.

No new persistent claim state is required. Existing recovery logic remains responsible for operations interrupted by process termination.

## Ordering and isolation guarantees

- Different Issues may run concurrently, including Issues from the same Project.
- The existing per-Issue Git worktree remains the filesystem isolation boundary.
- A single Issue never runs two stages concurrently.
- Store compare-and-swap updates remain the durable state guard.
- Pending selection retains the store's existing deterministic ordering; concurrency changes start time, not priority policy.

## Test strategy

Add focused RuntimeWorker tests with controllable Agent barriers:

1. Submit at least three Issues and prove all three Agent assessments start before any is released.
2. Submit four Issues with a concurrency limit of three and prove the fourth does not start until one slot is released.
3. Requeue a next stage for an active Issue and prove it cannot overlap the Issue's current operation.
4. Make one Issue throw unexpectedly and prove an unrelated Issue still completes while `drain()` ultimately reports the error.
5. Begin shutdown with active and queued work and prove queued work does not start.
6. Run the existing Runtime, recovery, shutdown, acceptance, typecheck, and lint suites to detect regressions.

## Non-goals

- Running multiple Runtime processes against the same SQLite database.
- User-configurable concurrency in Desktop settings.
- Changing Issue priority or pending-operation ordering.
- Parallelizing multiple operations within one Issue.
- Changing Codex Agent session, worktree, approval, or evidence semantics.
