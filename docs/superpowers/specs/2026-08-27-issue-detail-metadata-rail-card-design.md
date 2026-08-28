# Issue Detail Metadata Rail Card Redesign

Date: 2026-08-27
Status: Direction approved, pending written review

## Goal

Bring the right-side Issue metadata rail into alignment with the approved reference image while preserving the current Oh My Bug ?! shell, all metadata fields, and every existing operation. This change applies only to the Issue detail rail labeled “详情”; it does not redesign the global navigation sidebar, Issue list, main Issue document, or bottom action area.

## Reference contract

The sole visual source of truth is:

- `docs/design/issue-detail-transient-terminal-active.png`
- Prepared reference hash: `275738155408a2d716b220de08a18f80b20e1d0a8bef59a305317e162aa0bb2c`
- Prepared dimensions: `1536×1024`

The implementation must reproduce the reference's inset white card, quiet page surround, compact bordered surface, rounded corners, structured header, and comfortably separated metadata rows. Existing project tokens and source-native Lucide icons remain authoritative where raster evidence cannot prove exact color or icon metrics.

## Scope

### In scope

- The right-side `IssueMetadataRail` visual structure and responsive presentation.
- The “详情” header and its collapse control.
- Metadata row spacing, dividers, typography, and value wrapping.
- Desktop and narrow-desktop behavior of this rail.
- Deterministic visual validation against the prepared reference.

### Out of scope

- Global navigation sidebar and Issue list.
- Issue title, Assessment, Terminal, Evidence, Delivery, and fixed action area.
- Workflow states, data model, keyboard shortcuts, and runtime behavior.
- Adding, removing, renaming, or reordering metadata fields or actions.

## Structure

Keep `IssueMetadataRail` as the layout and accessibility boundary, with `aria-label="Issue 详情栏"`. Add one inner `issue-metadata-card` surface that owns both the header and metadata list.

The hierarchy is:

1. Rail layout slot and scroll container.
2. Inset metadata card.
3. Card header with “详情” and the existing collapse control.
4. Definition list containing all current metadata rows and inline actions.

This separates page placement from the card surface and avoids styling the entire grid column as one gray sidebar.

## Desktop layout

- Use a stable `320px` rail column in the existing three-column workspace. This is intentionally narrower than the isolated reference card so the current navigation and Issue list do not make the main Issue document unusably narrow.
- Remove the rail's full-height gray fill and hard left divider.
- Give the rail a quiet canvas/page background and `16px` inset spacing around the card, with no bottom padding requirement beyond the natural scroll area.
- The card uses the existing surface token, one-pixel border token, approximately `10px` radius, and no decorative shadow, gradient, glow, or colored edge.
- The card ends after its final metadata row rather than filling the viewport.

## Header

- Height: `56px`.
- Horizontal padding: `20px`.
- Title: `15px`, semibold, primary text color.
- Keep the current collapse button in the right-side alignment track and preserve its accessible label and shortcut behavior.
- Use one subtle bottom divider between header and metadata content.
- The header is part of the card surface and is not independently gray or permanently sticky inside the card.

## Metadata rows

Preserve the current order and functionality:

1. 项目
2. 分支 / Worktree
3. 来源
4. Agent 会话, including the existing conditional Terminal action
5. 创建时间
6. 更新时间

Row treatment:

- Horizontal content padding: `20px`.
- Vertical padding: approximately `18px`.
- Label-to-value gap: `8px`.
- Labels use the current muted text token at `11px`–`12px`.
- Values use the current stronger secondary/primary text token at `12px`–`13px`.
- Technical identifiers may retain the project monospace stack; ordinary labels and timestamps use the standard UI stack.
- Each row has a subtle divider except the final row.
- Long project paths, branches, Agent session IDs, and sources must wrap or break without causing horizontal overflow.
- Keep the existing branch pill, project icon, source icon, and action affordances, but tune their alignment to the new row rhythm rather than inventing replacement artwork.

## Responsive behavior

- At the existing narrow-desktop breakpoint, retain the current right-side overlay interaction but render the same inset card treatment at `320px` total width.
- The overlay may retain the existing elevation needed to distinguish it from content; the card itself should not gain a large decorative shadow.
- Preserve current small-screen hiding behavior and all toggle/keyboard semantics.
- Do not move the rail below the Issue document or change the content order as part of this task.

## Behavior and states

- The rail remains open or closed according to the current state and `Ctrl/Cmd+B` shortcut.
- No new loading, selected, status, or completion state is introduced.
- The Agent session Terminal action remains in the metadata row only under its existing visibility condition.
- No field, icon, button, or operation is removed.

## Asset decision

The reference contains no standalone raster assets needed for this rail. All visible elements can be implemented with existing CSS, text, project tokens, and source-native Lucide icons. No ImageGen or external asset generation is required.

## Validation

Functional checks:

- The card wrapper contains both the rail header and metadata list.
- The rail toggle, `Ctrl/Cmd+B`, branch presentation, project link, and Terminal action retain their current behavior.
- All six metadata groups remain rendered in their existing order.

Visual checks:

- Run the app with the deterministic Issue-detail fixture at `1536×1024`.
- Capture the full Issue detail page and a locator-level screenshot of the metadata rail/card.
- Compare against the prepared reference, using a documented deterministic crop of the reference's right rail when isolating the component. Cropping may exclude unrelated global navigation and main Issue content but must include the complete implemented rail card and surrounding inset.
- Confirm by inspection that the rail is an inset finite-height card, not a full-height gray panel.
- Confirm header height, border, radius, row rhythm, wrapping, and toggle alignment at desktop and narrow-desktop widths.
- Store screenshots and diff artifacts under `.artifacts/visual-diff/`; do not commit transient validation output.

## Acceptance criteria

- Only the right Issue “详情” rail changes visually.
- The rail uses an inset bordered white card on a quiet page background.
- The card ends after 更新时间 and does not fill the viewport.
- The header and row density visibly match the approved reference direction.
- Every current metadata field and operation remains available.
- Long values do not overflow.
- Desktop, overlay, and small-screen behavior remain functional.
- Existing focused tests pass, and deterministic screenshot validation records the final result.
