# Issue Detail Design-System-Aligned Redesign

**Date:** 2026-08-26  
**Status:** Approved direction, pending written review

## Objective

Replace the visually divergent Issue detail concepts with three concepts that are unmistakably part of the current Oh My Bug ?! product. The redesign may improve hierarchy and evidence access, but it must preserve the existing Issue detail skeleton, component vocabulary, density, semantic colors, and interaction ownership.

The deliverables are design explorations, not a new visual system.

## Verified Current Contract

The following constraints come directly from `DESIGN.md`, `tokens.css`, `global.css`, and the current Issue detail components.

### Layout

- The Issue detail owns the available detail pane and uses two rows: a scrollable document plus the unified bottom action area.
- The document content is centered at `min(760px, 100%)`.
- Document padding is `24px clamp(20px, 3.5vw, 36px) 88px`.
- The optional metadata and Agent activity rail remains approximately `280px`, separated by one left border and using the quieter sidebar surface.
- The action area remains outside the scrollable document, separated by one top border.
- No concept may introduce a 38/62 inspection desk, full-width data band, immersive evidence canvas, dashboard grid, or alternate application shell.

### Typography and Density

- Page title: `20px`, weight `590`, compact negative letter spacing.
- Panel headings: `12–16px` according to the existing heading role.
- Body and summaries: `12–13px`.
- Captions, status context, and technical metadata: `10–11px`.
- Technical identifiers use the existing monospace stack.
- Standard controls remain `30px`; input/select height remains `32px`.
- Spacing follows the current 4px base with compact 6–10px control gaps, 12px section gaps, and 18px panel padding.

### Surfaces, Color, and Shape

- Use only current semantic tokens: canvas, sidebar, surface, surface-raised, surface-hover, border, border-strong, text tiers, accent, success, warning, danger, and info.
- Dark surface order remains `sidebar < canvas < surface < surface-raised < surface-hover`.
- `#716BFF` is the sole interaction accent and occupies less than 10% of the page.
- `REVIEW_REQUIRED` uses accent, not warning yellow.
- Failure uses danger, completion uses success, and neutral lifecycle states remain neutral.
- Small controls use 4–6px radii; Assessment, Delivery, and review panels use 8px.
- Borders are one pixel and appear only where spacing or surface contrast is insufficient.
- No gradients, glass, glow, vignette, ambient lighting, large shadows, colored edge stripes, or invented logos.

### Existing Component Vocabulary

- `issue-title-block` owns identifier, status, title, input summary, occurrence information, resolution, and failure banner.
- `assessment-review` remains one `review-section` with a compact heading and stacked verdict/reasoning, root-cause, and solution blocks.
- Delivery remains one `review-section` with iteration summary and evidence.
- Evidence remains a responsive grid of bordered figures; thumbnails preserve `16:9`; screenshots expose preview and recordings expose play.
- The metadata rail retains its sticky 44px header, project/source/state/session/timestamps, Terminal action, and collapsible Agent activity.
- `IssueActions` retains unified ownership of reviews, permission requests, pause/resume, retry/rebuild, recovery, and cancel.
- A Delivery review uses the current compact review dock, with Runtime labels and a low-emphasis overflow for cancellation.

## Shared Scenario

All three concepts use one truthful Delivery `REVIEW_REQUIRED` state:

- identifier `CHK-42`;
- title `修复证据预览偶发空白`;
- status `等待交付验收` shown with the existing accent treatment;
- Assessment verdict `是 Bug`, reasoning, Bug cause, and solution;
- Delivery iteration 2, branch, commit, two screenshots, and one recording;
- right rail with project, Worktree branch, source, status, Agent session, Terminal action, timestamps, and Agent activity;
- compact dock with `等待人工决定`, `迭代 2 · 3 项证据`, `接受后发布已验证 commit`, `要求修改`, `接受交付`, and overflow.

## Variant A: Faithful Hierarchy Polish

Preserve the current reading order and component expansion:

1. Issue context;
2. Assessment heading and all stacked blocks;
3. branch/commit context;
4. Delivery summary and two-column evidence grid;
5. compact review dock.

The redesign comes only from more deliberate spacing, alignment tracks, and text emphasis. The metadata rail and Agent activity remain fully visible. This is the safest and most implementation-faithful concept.

## Variant B: Compact Assessment, Earlier Evidence

Preserve every existing component and the `760px + 280px` skeleton, but reduce the vertical cost of already-reviewed context:

- keep the Assessment `review-section` container;
- keep verdict, reasoning, cause, and solution in the correct order;
- reduce each block to a concise two-line preview with a standard disclosure control;
- move Delivery immediately below the compact Assessment;
- use the same responsive evidence grid with slightly larger first-row thumbnails;
- keep the metadata rail unchanged and Agent activity expanded.

This improves repeat-review speed without inventing a media desk or new navigation model.

## Variant C: Decision-Focused Dock and Quiet Activity

Preserve the current document order and fully expanded Assessment. Change emphasis only at the final decision point:

- keep evidence in the current responsive two-column grid;
- keep metadata rows unchanged;
- collapse historical Agent activity by default while showing its current state, event count, and disclosure affordance;
- make the review dock's consequence line easier to scan through alignment and whitespace, not larger type or additional color;
- keep `要求修改` secondary, `接受交付` primary, and cancellation in overflow.

This concept demonstrates how the current design system can give approval more clarity without turning the bottom area into a floating toolbar.

## Generation Method

Use the built-in ImageGen tool for each variant. Prefer an actual screenshot of the current Issue detail as a style and component reference. If a current screenshot can be captured locally, load it and use it as the reference image while requesting layout-preserving edits. Do not use the rejected generated concepts as style references.

Generate three distinct outputs and save them non-destructively:

- `docs/design/issue-detail-system-aligned-a.png`;
- `docs/design/issue-detail-system-aligned-b.png`;
- `docs/design/issue-detail-system-aligned-c.png`.

## Validation

Reject or correct an output when any of the following is true:

- the centered document is visibly wider than the current `760px` proportion;
- the right rail is missing, permanently wider than approximately `280px`, or visually louder than the document;
- title, body, metadata, or controls are visibly oversized;
- `REVIEW_REQUIRED` is yellow instead of accent blue-violet;
- the page uses new navigation, tabs, a media desk, a top data band, or a full-width evidence canvas;
- Assessment or Delivery becomes a dashboard card grid;
- evidence no longer resembles the current responsive figure grid;
- the action area floats, overlaps evidence, owns a large shadow, or uses invented actions;
- gradients, glow, vignette, glass, ambient light, fake logos, or decorative charts appear;
- primary Chinese labels are materially corrupted.

The three accepted outputs must feel like sibling states of the current implementation. Their differences come from information density and disclosure, not from alternate branding or new product architecture.
