# Agent Activity Turn Terminal Design

## Goal

Present each complete Codex turn as one default-collapsed terminal disclosure. A user opens the terminal by clicking the turn title, such as “Codex 开始分析” or “Codex 开始实现”, rather than expanding an outer activity container or inspecting command-sized panels.

## Scope

This change is limited to the desktop Agent activity renderer, its styles, and renderer tests. Runtime events, persistence, subscriptions, pagination, command correlation, redaction, and backend contracts remain unchanged.

## Interaction Model

- “Agent 活动” becomes a static section heading and compact current-state summary, not a disclosure button.
- Every Codex turn is rendered as an independent disclosure row.
- The disclosure label uses the `AGENT_TURN_STARTED` message, including “Codex 开始分析” and “Codex 开始实现”.
- Every turn is collapsed on initial render, including the active turn.
- Clicking or keyboard-activating the full turn header toggles only that turn.
- Multiple turns may be expanded at the same time.
- Each header retains the start and finish timestamps plus the truthful turn status.
- Events that are not enclosed by a Codex turn are grouped under an independent “活动记录” disclosure, also collapsed by default.
- Loading older activity adds the earlier disclosure rows without automatically opening them.

## Terminal Presentation

An expanded turn contains one continuous terminal surface. Commands, command output, file changes, status messages, failures, interruptions, and cancellations appear in chronological order inside that surface.

Command lifecycle events remain merged into one logical line by the existing correlation logic. Command output is rendered inline beneath its command without a separate raised background, border, or card-shaped container. Entries may use restrained separators and spacing, but the expanded turn must read as one terminal rather than a stack of command panels.

Long output remains scrollable and bounded so activity cannot displace the Assessment or Delivery content. Failure, interruption, cancellation, and running states continue to use both text and semantic color.

## Component Structure

- `AgentActivity` owns the static section heading, pagination, event grouping, and the set of expanded group IDs.
- A turn disclosure component owns an accessible header button and its terminal body.
- `CommandLogLine` continues to render a merged command and output inside the shared terminal surface.
- `EventLogLine` continues to render non-command events and the existing nested reassessment-detail disclosure.
- `groupEvents` remains the source of turn boundaries and truthful statuses; no runtime event semantics are reinterpreted in the view.

Expanded state is keyed by group ID so one turn can be toggled without changing another. When the selected Issue changes, obsolete expanded IDs must not cause a turn in the new Issue to open.

## Accessibility

- Each turn header is a real button with `aria-expanded` and `aria-controls`.
- The accessible name includes the turn label.
- The expanded terminal keeps its log semantics and an accessible name derived from the turn label.
- Header status and time remain readable without relying on color.
- Keyboard focus uses the existing application focus treatment.
- Chevron rotation respects the existing reduced-motion behavior.

## Testing

Renderer tests will verify:

1. The section no longer requires an outer “Agent 活动” expansion.
2. Turn bodies are absent by default.
3. Clicking “Codex 开始分析” opens one continuous terminal and clicking again closes it.
4. Command start and completion still merge into one logical command record.
5. Multiple turns expand independently and may remain open together.
6. Loose system activity uses its own default-collapsed disclosure.
7. Running, completed, failed, interrupted, and canceled states remain truthful.
8. Pagination and Issue switching preserve their current behavior without leaking expanded state.
9. Turn headers expose the required disclosure ARIA attributes.

Focused renderer tests, the desktop test suite, and the repository typecheck will run before completion. The local page will be inspected in both collapsed and expanded states at desktop and narrow widths.

## Acceptance Criteria

- A visible “Codex 开始分析” row is collapsed by default.
- Activating that row reveals the full activity for that Codex turn as one terminal surface.
- Individual command exchanges do not look or behave like separate cards.
- The user can distinguish and independently inspect separate analysis, reassessment, implementation, and recovery turns.
- Existing activity facts, outputs, statuses, pagination, and redaction remain intact.
