# Issue Detail Unified Layout Design

## Problem

The Issue document and metadata card are currently sibling grid items of the workspace. The action footer belongs to the document sibling, so its background stops abruptly before the metadata column. The metadata card and footer therefore read as unrelated layers even though both belong to the selected Issue.

## Goal

Make the document, metadata card, and action footer children of one Issue detail container. Preserve the current content, actions, metadata fields, responsive toggle behavior, and compact card styling.

## Structure

The workspace keeps two responsibilities:

```text
workspace
├─ Issue list
└─ Issue detail container
   ├─ document
   ├─ metadata rail
   └─ action footer
```

`IssueDetail` owns the detail container and accepts the metadata rail as a composition slot. This keeps metadata state and data preparation in `App`, while the component that owns the document and action footer also owns their shared layout.

## Wide layout

At widths above 1200px, the Issue detail container uses two columns and two rows:

```text
minmax(0, 1fr) 280px
┌────────────────┬──────────────┐
│ document       │ metadata     │
├────────────────┴──────────────┤
│ action footer                 │
└───────────────────────────────┘
```

- The 280px metadata track reduces the document width instead of covering it.
- The metadata rail stays transparent; its inset card owns border, radius, elevation, height constraint, and scrolling.
- The action footer spans both columns.
- Footer controls stay aligned to the document content track, not under the metadata card.

## Narrow layout

At 1200px and below, the detail container becomes one column. The metadata rail is positioned over the document area only and does not cover the action footer. The existing 280px tablet width and 260px phone width remain unchanged.

At phone widths, the Issue list and selected Issue continue to switch as navigable views, and the existing header back action remains unchanged.

## Component boundaries

- `App` continues to own metadata visibility, keyboard shortcuts, project lookup, workspace lookup, and Terminal availability.
- `IssueMetadataRail` remains responsible only for rendering metadata and its close control.
- `IssueDetail` receives an optional `metadataRail` node and places it beside the document.
- `IssueActions` remains the single renderer for all current review, permission, failure, pause, resume, cancel, retry, and rebuild operations.

No API, state-machine, copy, action, or metadata-content change is included.

## Visual treatment

- Preserve the natural two-layer metadata-card shadow already approved.
- Preserve metadata row spacing at 16px vertical padding and 6px label/value gap.
- Preserve the footer's full-width raised surface and top divider.
- Do not add another card, overlay background, or decorative container around the detail layout.

## Verification

- A component test proves the metadata rail is rendered inside the Issue detail article.
- CSS contract tests prove the workspace has only list and detail tracks, the Issue detail container owns the two-column grid, and the action footer spans both columns.
- Existing metadata toggle, keyboard shortcut, review action, and responsive tests remain green.
- Desktop typecheck and the complete desktop test suite pass serially.
- Runtime inspection covers one wide viewport and one narrow viewport when the local Browser policy permits capture; otherwise the visual limitation is reported explicitly.
