# Compact Review Dock Design

**Date:** 2026-08-26
**Status:** Approved direction, pending implementation planning

## Problem

The current `REVIEW_REQUIRED` UI renders a large form inside the Issue document. Its summary, decision context, full-width radio rows, always-visible feedback field, and footer actions consume most of the detail viewport. This makes the human gate visually dominant before the user has finished inspecting the Assessment, Delivery, and evidence that should inform the decision.

The redesign must preserve explicit human authority while returning the main viewport to the Issue details.

## Design Goals

- Keep Assessment, Delivery, and evidence as the dominant content.
- Make the pending review continuously discoverable and reachable.
- Keep the common Delivery acceptance path to one compact row.
- Reveal feedback and complex choice content only when it is needed.
- Preserve Runtime-provided choice labels and the explanation of what approval unlocks.
- Preserve keyboard access, visible focus, accessible names, and safe busy/error states.

## Chosen Interaction

Replace the large in-document review form with a compact review dock at the bottom of the Issue detail column.

The collapsed dock is approximately 56–64 px tall and contains:

- a compact pending-review label;
- bounded context, such as `迭代 2 · 1 项证据`;
- one short consequence statement, such as `接受后发布已验证 commit`;
- explicit decision actions using the Runtime-provided labels.

For a two-choice Delivery review, render `要求修改` as the secondary action and `接受交付` as the primary action. Do not render a radio group plus a duplicate submit button. The action label itself is the confirmation language, so an ambiguous `确认` action is never introduced.

## Progressive Disclosure

### Accepting Delivery

`接受交付` submits immediately from the collapsed dock. While submitting, all dock actions are disabled and the primary action reads `提交中…`. Submission failures appear in a compact error row attached to the dock and do not discard the current decision state.

Optional feedback is not displayed for acceptance. The Delivery acceptance path remains one row.

### Requesting Changes

Selecting `要求修改` expands a compact composer directly above the dock. The composer contains:

- a focused feedback textarea;
- a `取消` action that returns to the collapsed dock without submitting;
- a primary `提交修改要求` action.

Feedback is required for this path whenever the selected Runtime choice declares `feedbackRequired`. The submit action remains disabled until the requirement is satisfied.

### Assessment Reviews

Assessment reviews reuse the same dock shell. Straightforward actions remain visible in the dock. An action that requires response data, such as editing the confirmed Issue title or specifying a duplicate target, opens the compact composer above the dock with only the fields required for that action. The proposed verdict and exact Assessment revision remain in the compact context line.

### Business Merge Conflict Reviews

Business conflict choices remain explicit and unselected by default. The dock shows the pending conflict and a `选择处理方式` trigger. Activating it expands the existing intent comparison, incompatibility explanation, affected paths, recommendation, and Runtime-provided choices above the dock. The AI recommendation never preselects a business outcome.

### Unknown Review Kinds

Unknown extension review kinds use the safe bounded summary already provided by `ReviewRenderer`. They open in the expanded area because the UI cannot safely infer which context can be omitted.

## Placement and Scrolling

The dock is sticky to the bottom of the Issue detail viewport, not the application window. It spans only the detail column and does not cover the Issue list or metadata rail.

The Issue document reserves enough bottom space for the dock's collapsed height. When the composer expands, the detail viewport remains scrollable and the focused control is brought into view. The last evidence item and its controls must remain reachable rather than being permanently covered by the dock.

At narrow widths or 200% zoom, actions may wrap into a second row. For coarse pointers, targets retain the project's minimum touch sizing.

## Visual Treatment

- Use the existing product surface, border, accent, danger, and focus tokens.
- Separate the dock from the document with a single top border and an opaque or near-opaque application surface.
- Avoid a large card, large status icon, nested panels, decorative shadow, or full-width radio cards.
- Use semantic text and icons together when an icon appears; color is never the only state signal.
- Keep the context line concise and truncate only nonessential prose, never the action labels.

## Component Boundaries

`ReviewPanel` continues to own review selection, response data, submission, busy state, and errors. Its presentation changes from a stacked form to a dock state machine:

- `collapsed`: compact context and immediate actions;
- `composing`: fields for the selected action;
- `expanded`: complex review context and choices;
- `submitting`: actions disabled with stable progress copy;
- `error`: previous state preserved with an attached error message.

`ReviewRenderer` remains responsible for review-kind-specific decision context. It gains compact output for Assessment and Delivery and continues to provide full expanded output for business conflicts and unknown kinds.

No Runtime API or persisted Issue schema changes are required.

## Cancel Issue

Canceling the Issue is not part of the review decision and must not compete visually with approval. Move it into a low-emphasis overflow action associated with the dock, while preserving its existing confirmation and disabled behavior.

## Verification

Add or update focused component tests for:

- collapsed Delivery dock content and absence of the old radio form;
- immediate Delivery acceptance submission;
- request-changes composer expansion, validation, cancellation, and submission;
- Assessment response fields opening only for the selected action;
- business-conflict choices remaining unselected until the user chooses;
- busy and error states preserving context;
- keyboard focus order and accessible region/action names.

Update browser and Electron workflow tests to use the explicit action buttons. Capture the deterministic Delivery review state at the target desktop viewport and verify that the collapsed dock is approximately one row tall, the Issue evidence remains visible, and the final evidence controls are reachable. Also inspect narrow width, 200% zoom, and both supported appearance themes.

## Non-Goals

- Changing review semantics, Runtime choices, or continuation operations.
- Redesigning Assessment, Delivery, evidence cards, the Issue list, or metadata rail.
- Adding approval keyboard shortcuts.
- Adding a modal or a right-side review drawer.
