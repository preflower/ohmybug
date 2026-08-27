# Issue Detail Responsive Rail Polish

Date: 2026-08-27
Status: Direction approved, pending written review

## Goal

Refine the approved Issue metadata card at narrow widths so the floating surface is smaller and visually self-contained, while ensuring the Issue action footer remains fully visible and the return-to-list action belongs to the outer Issues header rather than the detail document.

This is a focused follow-up to `2026-08-27-issue-detail-metadata-rail-card-design.md`. It does not change metadata content, Issue workflow, action availability, or desktop document design.

## Verified problem

At a `566×753` runtime viewport:

- The metadata rail is a `280px` gray overlay with `16px` padding and the shadow on the full overlay; its card is `248px` wide.
- The detail pane is `669px` tall.
- The internal mobile return toolbar adds `40px` before an Issue detail that is itself `669px` tall.
- The Issue action footer therefore ends at `793px`, exactly `40px` below the `753px` viewport bottom.

The clipping is caused by stacking a separate toolbar above a full-height Issue detail inside a mobile detail pane that is rendered as a block.

## Responsive metadata rail

### Width

- Desktop and narrow desktop use a `280px` metadata rail slot instead of `320px`.
- At `680px` and below, use `min(260px, calc(100% - 40px))`.
- Preserve the existing open/close state, `Ctrl/Cmd+B`, toggle controls, field order, and Terminal action.

### Floating presentation

At overlay breakpoints (`1200px` and below):

- The outer `issue-metadata-rail` remains the positioning, scrolling, and accessibility boundary only.
- Give the outer rail a transparent background and remove its shadow.
- Use a `12px` inset at `681px`–`1200px` and a `10px` inset at `680px` and below so the card reads as floating instead of edge-attached.
- Apply `0 12px 32px rgb(0 0 0 / 18%)` directly to `issue-metadata-card` at overlay breakpoints.
- Do not add a second visible panel, tinted backdrop, border stripe, or scrim.

At wider desktop widths, use a `12px` inset and retain the quiet card treatment without adding a shadow.

## Return-to-list action

- Remove `mobile-detail-toolbar` from inside the detail pane.
- Add one `issue-list-back-action` immediately before the `Issues` heading in the outer `view-header`.
- Render the action only when an Issue is selected; show it visually only at `680px` and below.
- Use the existing `ChevronLeft` icon and accessible name `返回 Issue 列表`.
- Selecting the action clears the selected Issue through the existing `onDeselect` callback.
- Do not add a second return action inside the document, breadcrumb, or footer.

## Detail and Footer layout

- With the internal toolbar removed, `detail-pane-scroll` uses one `minmax(0, 1fr)` row.
- `IssueDetail` occupies that row and continues to use its existing two-row layout: scrollable document plus automatic-height `IssueActions`.
- The document is the only vertically growing/scrolling region.
- The Issue action footer must remain fully visible at the bottom of the detail pane when it exists.
- At `566×753`, the footer bottom must equal the detail pane bottom and viewport bottom (`753px` in the deterministic fixture), not extend below it.
- Preserve the existing footer content, actions, background, border, overflow behavior, and workflow ownership.

## Components and data flow

- `IssueWorkspace` continues to own selected-Issue state and `onDeselect`.
- The outer `view-header` receives the return button because it is stable outside the list/detail replacement area.
- `IssueDetail` and `IssueActions` require no new props or state.
- `IssueMetadataRail` retains its current inner card markup; this change is responsive CSS only for its size and elevation ownership.

## Testing

Add or update focused tests to prove:

- The return action is a child of the Issues `view-header`, not `.detail-pane`.
- Clicking it still deselects the Issue and returns to the list.
- No `mobile-detail-toolbar` remains.
- The base workspace rail column is `280px`.
- The overlay shadow is absent from `issue-metadata-rail` and present on `issue-metadata-card`.
- The phone rail rule uses `260px` with the bounded viewport calculation.
- `detail-pane-scroll` uses a single `minmax(0, 1fr)` row.

Runtime validation must capture:

- A narrow-desktop state that shows a floating card with card-owned shadow and no tinted outer panel.
- A `566×753` selected-Issue state with the back action beside `Issues` and the entire Issue action footer visible.
- A `566×753` state with the metadata card open, confirming its bounded width and preserved operations.

## Acceptance criteria

- The right metadata area is visibly smaller at every relevant breakpoint.
- Floating elevation belongs to the metadata card, not its outer rail.
- No visible gray overlay container surrounds the floating card.
- The mobile return action appears to the left of `Issues` and nowhere inside the Issue document.
- The Issue action footer is fully visible and flush with the detail pane bottom.
- All existing metadata fields, Terminal action, footer actions, shortcuts, and accessibility labels remain functional.
- Focused tests, desktop typecheck, complete desktop tests, and the three runtime screenshots pass inspection.
