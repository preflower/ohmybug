# Issue List Live Status Design

## Problem

The renderer loads the Issue list once during application startup. It subscribes to Runtime events only for the currently selected Issue. A non-selected Issue can therefore move through Assessment, Repair, publication, or completion while its list row keeps the old status. Selecting that Issue fetches its latest snapshot, which makes selection appear to be required for status refresh.

## Goal

Keep every loaded, non-terminal Issue row synchronized with Runtime changes without requiring selection, while preserving the selected Issue's existing detailed activity history.

## Design

Add a list-level synchronization hook in the desktop renderer.

- The existing `useIssueEvents` subscription remains the owner of the selected Issue's event history and snapshot refresh.
- The new hook subscribes to every loaded, non-terminal Issue except the selected Issue.
- When a subscription receives one or more events, the hook debounces refreshes per Issue, calls `api.issue(issueId)`, and passes the returned snapshot to a shared snapshot-merging callback.
- The snapshot-merging callback updates the matching list row and updates the detail only when the snapshot ID still matches `selectedId`. It ignores a snapshot whose revision is older than the currently stored revision.
- Starting a subscription from cursor zero intentionally triggers one initial snapshot refresh. This closes the race between the initial `api.issues()` response and subscription setup.
- When selection changes, subscription ownership transfers: the newly selected Issue is handled by `useIssueEvents`, and the previously selected non-terminal Issue becomes list-managed.
- When an Issue becomes terminal or disappears from the loaded list, its list-level subscription and pending timer are removed.

Terminal statuses are `COMPLETED`, `CLOSED`, and `CANCELED`.

## Error Handling

A failed per-Issue refresh leaves the last known snapshot visible. The subscription remains active so a later event can trigger another refresh. Errors from background list synchronization do not replace the application-wide error banner or disturb other Issue subscriptions.

Async refresh results are ignored after their subscription has been removed. Together with the revision guard, this prevents a late response from restoring an obsolete row, replacing the selected detail, or overwriting a newer snapshot.

## Testing

Add a renderer regression test with two Issues:

1. Load and select the first Issue.
2. Deliver an event through the second Issue's subscription without selecting it.
3. Return a newer snapshot for the second Issue.
4. Assert that the second list row changes status while the first Issue remains selected.

Also verify that the selected Issue has only the existing detailed subscription and that terminal Issues do not receive list-level subscriptions. Run the focused renderer tests, desktop test suite, typecheck, and repository tests.

## Non-Goals

- Adding polling for the complete Issue list.
- Adding a new Runtime or IPC-wide change-feed protocol.
- Changing Issue workflow states or publication behavior.
- Loading Issue activity histories into list rows.
