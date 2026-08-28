# Issue Detail Four Visual Directions

**Date:** 2026-08-26  
**Status:** Selected directions, pending final written review

## Objective

Generate four independent high-fidelity Issue detail page concepts for Oh My Bug ?!. The concepts compare two approved information architectures while holding theme, content, state, and product design rules constant.

The images show only the Issue detail surface. They do not include the application sidebar, Issue list, marketing frame, device mockup, or an external operation-state atlas.

## Shared Scenario

Every concept shows the same truthful `REVIEW_REQUIRED` Delivery state for `CHK-42`, titled `修复证据预览偶发空白`.

Shared content and controls:

- Issue identifier, title, status, input summary, and occurrence context;
- Assessment verdict, reasoning, bug cause, solution, and revision;
- Delivery iteration, summary, branch, commit, and three visual evidence items;
- two screenshots and one recording, each with a clear preview or play affordance;
- project, source, Worktree branch, Agent session, Terminal action, timestamps, and Agent activity;
- compact human review controls: `要求修改`, `接受交付`, and `更多 Issue 操作`;
- review context: `等待人工决定`, `迭代 2 · 3 项证据`, and `接受后发布已验证 commit`.

Mutually exclusive lifecycle actions do not appear together. Other Issue states reuse the same designated action container and error location but are not mixed into these Delivery review screenshots.

## Shared Visual System

- Register: product.
- Theme: dark, for an engineer reviewing evidence on a large monitor in a dim evening workspace.
- Color strategy: restrained cool tinted neutrals with blue-violet interactive accent below 10% of the surface.
- Typography: Inter or native system sans; monospace for Issue IDs, Git refs, commands, paths, sessions, and timestamps.
- Density: compact expert UI using a 4px spacing base, 30–32px controls, small radii, and one-pixel separators.
- Evidence, current decisions, failures, and pending approvals earn attention. Metadata and completed activity recede.
- No gradients, glass, glow, ambient decoration, large shadows, oversized typography, card grids, decorative charts, chatbot layout, or copied Linear branding.

## Direction 1A: Classic Continuous Document

Use a familiar vertical evidence document:

- compact Issue header at the top;
- Assessment as the first continuous section;
- Delivery branch and commit context immediately below;
- evidence gallery in a two-column grid, with the recording occupying a deliberate wide slot;
- 280px right metadata and Agent activity rail;
- opaque 64px review dock fixed to the bottom of the document viewport.

This is the lowest-risk direction. Reading order is explicit and the user can inspect rationale before evidence without switching modes.

## Direction 1B: Evidence-Weighted Continuous Document

Retain the continuous document model but compress known context:

- a denser single-line Issue header with title, status, branch, and commit;
- Assessment shown as a concise verdict strip with expandable reasoning, cause, and solution summaries;
- Delivery evidence moves above long reasoning content and receives more vertical space;
- metadata and Agent activity remain in a 280px rail but use quieter key/value rows;
- review dock remains fixed and includes the same exact decision context and controls.

This version favors repeat reviewers who already understand the Issue and want to reach evidence faster, while keeping the full Assessment reachable in the same document.

## Direction 2A: Side-by-Side Evidence Inspection Desk

Use a split workspace inside the Issue detail page:

- left decision column, approximately 38%, contains Issue context, Assessment, Delivery summary, branch, commit, and compact metadata;
- right evidence stage, approximately 62%, contains one large selected screenshot and a horizontal evidence filmstrip for the remaining screenshot and recording;
- Agent activity is a collapsible section at the bottom of the left column;
- review controls are fixed to the bottom of the right evidence stage, directly connecting the decision to inspected evidence.

This version maximizes visual verification speed and keeps the selected evidence large enough for meaningful inspection.

## Direction 2B: Stacked Immersive Evidence Desk

Use a wide stacked inspection workspace:

- a compact full-width top band contains Issue title, Assessment verdict, Delivery summary, branch, commit, and essential metadata;
- the central area is a large evidence canvas with one selected screenshot and a vertical thumbnail rail for the other screenshot and recording;
- Agent activity opens as a quiet drawer from the right edge rather than occupying permanent width;
- a full-width review dock anchors the bottom and remains visually separate from evidence controls.

This version gives the evidence canvas the most horizontal width and suits large screenshots, while keeping the decision material available as a persistent summary band.

## ImageGen Execution

Use the built-in ImageGen tool. Generate each concept with a separate call and its own prompt. Do not use `n` to produce the distinct concepts. Save the final outputs as:

- `docs/design/issue-detail-1a-continuous-document.png`;
- `docs/design/issue-detail-1b-evidence-weighted-document.png`;
- `docs/design/issue-detail-2a-split-evidence-desk.png`;
- `docs/design/issue-detail-2b-immersive-evidence-desk.png`.

Never overwrite an existing artifact; use the next free versioned filename if a destination already exists.

## Validation

For every image:

- the canvas contains only the Issue detail page;
- the main state is one truthful Delivery review;
- Assessment, Delivery, evidence, metadata, Agent activity access, and review actions remain present;
- `要求修改` and `接受交付` are distinct secondary and primary actions;
- screenshots and recording remain visually distinguishable;
- the layout materially matches its named direction rather than converging on the same generic dashboard;
- primary Chinese labels are readable enough to identify the intended region or action;
- the palette remains restrained and no prohibited visual effect appears.

Compare all four outputs together after generation. A targeted edit is permitted only when a mandatory region is missing, a concept drifts into the wrong layout family, or a critical action label is materially corrupted.
