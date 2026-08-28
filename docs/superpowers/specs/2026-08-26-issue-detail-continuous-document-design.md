# Issue Detail Continuous Document Redesign

Date: 2026-08-26

## Goal

Redesign the Oh My Bug ?! Issue detail page as a continuous document while preserving every current information area and action. The result must remove the card-first feeling without introducing a new product architecture or visual language.

## Approved direction

- Continuous document flow in the main content area.
- A narrow, fixed metadata rail remains on the right.
- A fixed bottom action bar remains visible.
- Existing light theme, typography scale, violet accent, borders, density, and control styles remain authoritative.

## Page structure

The page contains three stable regions:

1. Main document, approximately 760 px wide.
2. Right metadata rail, approximately 280 px wide.
3. Fixed bottom action bar spanning the detail workspace.

The global application sidebar and Issue list are outside the redesign scope and must not appear in generated concept images.

## Main document

The main region is one continuous white document surface. It does not wrap Assessment, Evidence, Changed Files, Verification, or Delivery in separate cards.

Content order:

1. Issue ID, title, description, and current status notice.
2. Assessment verdict.
3. Assessment reasoning.
4. Bug root cause.
5. Proposed solution.
6. Evidence screenshots.
7. Changed files.
8. Verification results.
9. Delivery summary.

Sections are separated by a 1 px neutral divider and 20–24 px vertical spacing. Headings and alignment—not filled containers—provide hierarchy.

Assessment rows use a small leading icon and a text column. Long text expands naturally in the page; it must not create a nested scroll area.

The evidence area uses the current responsive thumbnail grid. Each thumbnail may retain its own thin border and short caption because the image needs a visible boundary. The grid must not have an enclosing card.

Changed files and verification results use compact review-style rows. Paths, additions, deletions, and result labels align into readable columns. Code and long paths truncate with access to the complete value rather than expanding the layout.

## Right metadata rail

The existing rail remains fixed and visually quiet. It contains:

- Project
- Branch and worktree state
- Source
- Status
- Agent session
- Open in Terminal
- Created time
- Updated time
- Agent activity and event count

Metadata groups use spacing and horizontal rules rather than cards. Agent activity is collapsed by default.

## Bottom action bar

The bottom bar stays fixed and uses one top border only.

- Left: Cancel Issue and Retry implementation.
- Right: the context-sensitive violet primary action, such as Confirm assessment or Confirm delivery and close.

Secondary actions remain directly visible and are not moved into an overflow menu. On narrow widths, labels may compact, but actions must not disappear.

## Visual rules

- Use the current light neutral canvas, white document, cool gray dividers, charcoal text, muted metadata, and restrained violet accent.
- Keep the current title, body, metadata, and control scale: roughly 20 px title, 12–13 px body and section labels, 10–11 px metadata, and 30–32 px controls.
- Use no gradients, glow, glass effects, decorative shadows, oversized headings, atmospheric background, or new branding.
- Do not use outer borders, rounded filled panels, or background colors to separate normal document sections.
- Retain necessary local boundaries only for status notices, evidence thumbnails, code snippets, inputs, and buttons.
- Failure uses the existing light red status treatment. Review and confirmation use violet, not yellow.

## Responsive behavior

At narrower desktop widths, the metadata rail moves below the document in the same reading order. The bottom action bar remains a single stable row where possible. The document keeps comfortable text measure and does not introduce horizontal page scrolling.

## Empty, long, and error states

- Missing evidence is represented by one lightweight inline empty-state row, not an empty card.
- Long Assessment content grows vertically in the main document.
- Long branch names, session IDs, and file paths truncate predictably and expose the full value through the existing interaction pattern.
- Error and failed implementation states keep the existing inline status notice and available recovery actions.

## Image deliverables

Generate two views of the same approved architecture:

1. Balanced document: comfortable 20–24 px section spacing and four evidence thumbnails.
2. Dense document: slightly tighter 14–18 px section spacing and compact review rows, while preserving the same tokens, components, and actions.

Both images must show only the Issue detail workspace, metadata rail, and bottom action bar at a 1440×960 desktop framing. They are density variants, not different design systems.

## Acceptance criteria

- Every current content area and action remains visible or clearly represented.
- The main content reads as one continuous document, not a stack of cards.
- Normal sections are distinguished without enclosing boxes or filled backgrounds.
- The metadata rail and fixed bottom bar preserve current behavior and visual conventions.
- Short and long content do not destabilize the bottom action area.
- Generated visuals are immediately recognizable as the current Oh My Bug ?! product.
