# macOS Menu Bar Task List Design

## Goal

Replace the generic macOS status icon with a recognizable Oh My Bug mascot icon and make the icon a useful, native entry point for pending Issue work.

## Current behavior and root cause

`apps/desktop/src/electron/main.ts` creates the tray image from macOS's built-in `NSStatusAvailable` image. It is therefore unrelated to the Oh My Bug application artwork. The tray's context menu contains only “打开 Oh My Bug” and “退出”, while its click handler only shows and focuses the main window. The tray has no path to `listIssues`, no status classification, and no way to navigate the renderer to a particular Issue.

## Chosen interaction

Use a native macOS tray menu rather than a custom floating `BrowserWindow`.

Both the primary click and the context click on the menu bar icon open the same task menu. Before opening the menu, the main process requests the latest Issues from the local Runtime so the menu does not knowingly present stale task state.

The menu has this structure:

1. **需要你操作 (N)**
   - Up to four Issue items.
   - If more than four match, an “还有 N 条…” item opens the full Issues view.
2. **AI 处理中 (N)**
   - Up to four Issue items.
   - If more than four match, an “还有 N 条…” item opens the full Issues view.
3. A separator followed by “打开全部 Issues” and “退出 Oh My Bug”.

Group headings are disabled menu items. The count is the total matching count, not just the number currently displayed. Each Issue item uses the form `identifier · title — status`. The displayed title is limited to 32 Unicode grapheme clusters and ends with an ellipsis when truncated; truncation never changes stored Issue data. Within each group, Issues sort by `updatedAt` descending, with numeric-aware `identifier` descending as a deterministic tie-breaker.

When both groups are empty, the task area contains one disabled “暂无待处理任务” item. The permanent open and quit actions remain available.

## Status classification

“需要你操作” contains states that require a decision, permission, acceptance, or manual recovery action:

- `ASSESSMENT_REVIEW`
- `PERMISSION_REQUIRED`
- `ACCEPTANCE_REVIEW`
- `ASSESSMENT_FAILED`
- `EVIDENCE_FAILED`
- `REPAIR_FAILED`
- `FINALIZATION_FAILED`

“AI 处理中” contains unfinished states in which the Runtime or Agent owns the next step:

- `RECEIVED`
- `ASSESSING`
- `REPAIRING`
- `EVIDENCE_CAPTURE`
- `EVIDENCE_CHECK`
- `FINALIZING`
- `FINALIZATION_RECOVERY`

Terminal states are excluded:

- `COMPLETED`
- `CLOSED`
- `CANCELED`

The menu reuses the existing Chinese status wording from the desktop UI through a shared, renderer-independent mapping so menu labels and Issue badges cannot drift independently.

## Menu bar icon

Add a dedicated monochrome macOS Template Image derived from the recognizable Oh My Bug mascot silhouette. Do not shrink and display the shaded 1024-pixel application artwork directly: its three-dimensional shading is not legible at menu bar size. The tray asset keeps the mascot's head and question/exclamation antenna silhouette, uses transparent padding appropriate for the macOS menu bar, and ships as an 18-by-18 standard image plus a 36-by-36 `@2x` Retina image.

Electron marks the result as a template image so macOS controls its foreground color in light, dark, active, and disabled appearances. The Dock icon, packaged application icon, browser favicon, and in-app brand artwork remain unchanged.

## Components and responsibilities

### Tray task model

A renderer-independent module owns:

- status-to-group classification;
- stable sorting;
- the four-items-per-group limit and overflow count;
- shared menu status labels;
- safe display-title truncation.

It accepts Issue DTO-shaped values and returns a small menu view model. It does not import Electron and can be covered by fast unit tests.

### Tray menu controller

A focused Electron main-process controller owns:

- loading the latest Issues through the existing supervised Runtime client;
- suppressing overlapping loads caused by rapid repeated clicks;
- converting the task view model into an Electron `Menu`;
- asking the `Tray` to display that menu;
- dispatching open-all, open-Issue, and quit callbacks.

`main.ts` remains responsible for application startup, creating the actual `Tray`, showing the main window, and application shutdown. This keeps task-menu policy out of the already central Electron entry point.

### Issue navigation bridge

Add a one-way, named main-to-renderer IPC event containing only a validated Issue ID. Selecting a task:

1. shows and focuses the main window;
2. switches the renderer to the Issues view;
3. clears any project-only list filter;
4. selects and loads the chosen Issue.

The preload exposes a subscribe/unsubscribe function rather than a general IPC primitive. The renderer registers the listener during application lifetime and removes it on cleanup. If the renderer is not ready when a task is selected, the main process retains the latest requested Issue ID and delivers it after `did-finish-load`.

Selecting an overflow row or “打开全部 Issues” follows the same path without an Issue ID: it opens the unfiltered Issues view.

## Error and edge behavior

- If the Runtime is starting, restarting, or disconnected, clicking still opens a native menu. Its task area contains a disabled “任务列表暂不可用” item, while open and quit remain functional.
- Runtime request failures are handled and do not become unhandled promise rejections.
- Rapid repeated clicks share one in-flight load and cannot open overlapping task menus.
- If an Issue becomes terminal or disappears between menu construction and selection, the renderer falls back to the unfiltered Issues view instead of leaving a stale selection or surfacing a navigation error.
- A long identifier or title is truncated only in the menu presentation.
- Closing the main window continues to hide it while Runtime work proceeds; tray changes do not alter the existing window lifecycle.

## Testing and verification

### Automated tests

- Tray task model tests cover every `IssueStatus`, the two groups, terminal exclusion, update-time ordering, deterministic ties, four-item limits, overflow counts, empty state, and title truncation.
- Tray menu controller tests use narrow Electron-like and Runtime-like interfaces to cover successful loading, empty results, Runtime unavailability, request failure, repeated clicks, item selection, open-all, and quit.
- Desktop IPC/preload tests cover valid Issue navigation delivery, listener cleanup, and rejection/ignoring of malformed payloads.
- Renderer tests verify that a tray navigation event opens the unfiltered Issues view and selects the requested Issue, and that a missing/terminal Issue falls back safely.
- Icon asset tests verify that the standard and Retina template resources exist, have the intended pixel dimensions, retain transparency, and use a menu-bar-appropriate opaque bounding box.
- Existing desktop unit tests, Electron lifecycle tests, type checking, and packaging tests must remain green.

### Visual verification

Run the macOS desktop application and capture the menu bar icon and opened native menu in both light and dark appearances. Confirm that the mascot remains recognizable at native scale, menu labels do not produce an excessive width, both click types open the list, every row opens the intended Issue, and empty/unavailable states remain actionable.

## Non-goals

- A custom popover or mini renderer window.
- Inline approval, retry, cancellation, or other Issue mutations from the tray menu.
- Notification badges, unread counts, or persistent numeric text beside the icon.
- Changes to the main Issue list's general filtering or visual design.
- Changes to application, Dock, favicon, or in-app icon artwork.
