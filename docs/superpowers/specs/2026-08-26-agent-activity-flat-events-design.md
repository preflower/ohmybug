# Agent Activity Flat Events and Page Scrolling Design

## Goal

Simplify Agent activity after the turn-level terminal redesign. Events outside a Codex turn appear directly in the Agent activity timeline instead of being hidden inside an additional “活动记录” disclosure. Expanded turn content uses the Issue page's scrolling rather than introducing nested scroll regions.

## Scope

This is an incremental desktop renderer change. Runtime event production, persistence, event order, command correlation, pagination, redaction, and backend contracts remain unchanged.

## Information Hierarchy

- “Agent 活动” remains the static section heading and current-state summary.
- Events outside a Codex turn render immediately as chronological timeline rows beneath the heading.
- There is no “活动记录” label, button, wrapper disclosure, or empty terminal shell.
- Each Codex turn remains an independent, default-collapsed disclosure titled by its `AGENT_TURN_STARTED` message.
- Multiple Codex turns may remain expanded independently.
- Pagination stays above the chronological rows and continues to reveal older events without changing disclosure state.

## Scrolling

The Agent activity region, expanded turn terminal, event details, and command output do not set their own vertical height limits or vertical scrolling. Content grows naturally and the Issue page owns vertical scrolling. Long technical lines continue to wrap, so removing internal scrolling does not add a horizontal overflow requirement.

## Rendering Model

The grouping pass still finds explicit Codex turn boundaries and merges command lifecycle events within each turn. Events outside a turn are represented as flat activity lines rather than a synthetic `ActivityGroup`. The renderer therefore has two chronological item types:

1. a flat non-turn event or command line;
2. a collapsible Codex turn containing its terminal lines.

Flat lines reuse the existing event and command line renderers so status icons, timestamps, error treatment, details, and command correlation stay consistent. A loose command start and completion may still merge into one flat command line.

## Accessibility

- Non-turn events are readable content, not controls, unless the event already exposes a detail disclosure.
- Codex turn headers retain `aria-expanded`, `aria-controls`, keyboard activation, truthful text status, and accessible terminal names.
- Removing nested scroll areas keeps keyboard and 200% zoom navigation in the page's normal document flow.

## Testing

Renderer tests verify that non-turn events are visible without interaction and that no “活动记录” button is rendered. Existing turn tests continue to verify default collapse and independent expansion. Style tests verify that Agent activity, turn bodies, and output no longer impose `overflow-y`, `overflow: auto`, or vertical `max-height` limits. Focused renderer tests, the desktop suite, typecheck, and local browser inspection cover the final behavior.

## Acceptance Criteria

- No standalone “活动记录” disclosure appears.
- Non-turn activity is visible directly under the Agent activity heading.
- Codex turn disclosures keep their current hierarchy and default-collapsed behavior.
- Expanded turn content and command output show no internal scrollbar.
- The Issue page is the single vertical scrolling surface for the resulting content.
