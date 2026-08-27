# Issue Detail Four-stage Visual Variants

Date: 2026-08-27

## Goal

Redesign the Oh My Bug Issue detail page so its process model is immediately readable as four distinct stages: Assessment, Execution, Evidence, and Delivery. Generate three visual treatments of the same content architecture without returning to a card-first layout or departing from the existing product design system.

## Shared architecture

All three concepts use the same desktop page architecture:

1. One continuous main document.
2. One narrow fixed metadata rail on the right.
3. One fixed action bar at the bottom.
4. Four fully expanded process stages in the main document.

The global navigation sidebar and Issue list are outside the concept-image scope.

## Stage model and content ownership

### 01 Assessment / 评估

Contains:

- Verdict
- Assessment reasoning
- Bug root cause
- Proposed solution
- Assessment review result

Assessment explains why the Issue needs or does not need a code change. Its approval boundary permits the Agent to modify the local Issue workspace and run project verification.

### 02 Execution / 执行

Contains:

- Current or completed implementation state
- Concise Agent execution summary
- Changed files
- Additions and deletions
- Execution failure or retry state when applicable

The Agent session entry remains in the metadata rail because it is a cross-stage workspace control. Execution-specific activity and file changes belong in this stage rather than in generic metadata.

### 03 Evidence / 证据

Contains:

- Screenshot and recording thumbnails
- Evidence count
- Verification results
- Evidence capture, failure, retry, and acceptance states

Verification is grouped with Evidence because it answers whether the implementation is demonstrably correct. Evidence thumbnails may keep their individual thin borders, but the stage has no enclosing card.

### 04 Delivery / 交付

Contains:

- Delivery summary
- Target branch
- Issue commit or commit summary
- Final acceptance result
- Close-Issue outcome

Delivery represents publishing or accepting the verified implementation, not the evidence itself.

## Cross-stage metadata rail

The fixed right rail contains only Issue-level or workspace-level metadata:

- Project
- Branch and worktree state
- Source
- Current Issue status
- Agent session and Open in Terminal
- Created time
- Updated time
- Collapsed Agent activity entry and event count

Execution details and evidence results must not be duplicated in the rail.

## Fixed action bar

Cancel Issue and the relevant retry action stay directly visible. The violet primary action changes with the current stage, such as Confirm Assessment or Confirm Delivery and close. The action bar uses one top divider and no enclosing card.

## Common visual system

- Follow the current Oh My Bug light desktop design system exactly.
- Use the current neutral canvas, white document, cool-gray dividers, charcoal text, muted metadata, and restrained violet accent.
- Keep compact typography and controls: approximately 20 px title, 12–13 px body and stage labels, 10–11 px metadata, and 30–32 px controls.
- Use no gradients, glow, glass effects, decorative shadows, oversized headings, atmospheric backgrounds, fake branding, or yellow review state.
- Do not enclose Assessment, Execution, Evidence, or Delivery in rounded cards or filled panels.
- Keep local boundaries only for status notices, evidence thumbnails, code snippets, inputs, and buttons.
- Show all four stages expanded and emphasize the current stage.

## Variant A: Vertical process rail

Add a slim vertical process rail inside the left edge of the main document. Four nodes align with the four stage headings and are connected by one neutral line.

- Completed stage: green check node.
- Current stage: violet filled node with a subtle violet stage label.
- Future stage: gray hollow node.
- Stage content flows to the right of the rail without an outer container.

This variant prioritizes process continuity and makes stage progress legible at a glance.

## Variant B: Stage title bands

Begin each stage with a full-width title row containing the stage number, Chinese name, English name, and status.

- Use typography, a 1 px top or bottom divider, and whitespace only.
- Do not use filled bands, rounded backgrounds, or large pills.
- The current-stage label uses violet; completed stages use a small green check.
- Content flows directly beneath each title row.

This variant is the quietest and closest to the current document layout while restoring explicit stage boundaries.

## Variant C: Section index column

Split the main document internally into a narrow index column of approximately 120 px and a wider content column.

- The index lists 01 Assessment, 02 Execution, 03 Evidence, and 04 Delivery.
- Completed entries show a green check.
- The current entry uses violet text and a short violet vertical indicator.
- The index remains visually stable while the main document content continues vertically.
- The index must not become a second navigation sidebar or reduce body readability.

This variant prioritizes orientation and fast scanning in long Issue histories.

## Image deliverables

Generate three 1440×960 desktop concept images with identical Issue data and stage state:

1. `issue-detail-four-stage-rail.png`
2. `issue-detail-four-stage-bands.png`
3. `issue-detail-four-stage-index.png`

Use the same current stage and the same content in every concept so the comparison evaluates only the process-stage visualization.

## Acceptance criteria

- The viewer can identify Assessment, Execution, Evidence, and Delivery within three seconds.
- Every stage is fully expanded and has unambiguous content ownership.
- The current stage is visually distinct without relying on a filled card.
- Changed files appear under Execution.
- Screenshots and verification results appear under Evidence.
- Delivery contains the final summary and acceptance outcome.
- The right rail contains only cross-stage metadata.
- The fixed bottom bar retains Cancel, Retry, and the context-sensitive primary action.
- All three concepts remain immediately recognizable as the current Oh My Bug product.
