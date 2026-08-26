# Issue Detail — System-aligned ImageGen prompts

Reference: the current Oh My Bug desktop interface captured on 2026-08-26. The redesign must look like the same product, not a concept from a different design system.

## Shared constraints

- Output one desktop Issue detail page only. Do not include the global navigation sidebar or the Issue list.
- Preserve the current page skeleton: centered main document, fixed right metadata rail, and a separate bottom action area.
- Use the current light neutral palette: near-white canvas, white surfaces, cool gray dividers, charcoal text, muted gray metadata, violet accent only for selection and primary actions.
- Flat UI only: no gradients, glow, glass, shadows as decoration, illustrations, fake logos, or oversized cards.
- Compact desktop-tool density. Main title about 20 px, body 12–13 px, metadata 10–11 px, controls 30–32 px, 8 px panel radius.
- Keep every current functional area and action visible: Issue ID and title, summary, status/error notice, Assessment verdict/reasoning/root cause/solution, evidence gallery, changed files, verification results, Delivery, project, branch, source, status, Agent session, created/updated times, Agent activity, open in Terminal, cancel Issue, retry implementation, and the context-sensitive primary review/confirm action.
- Chinese UI copy. Use credible compact data and readable hierarchy, without inventing new product modules.
- 1440×960 desktop product screenshot, polished but implementation-realistic.

## Variant A — Faithful hierarchy polish

Use the current expanded content order. Improve hierarchy through spacing, typography, section dividers, and alignment only. Assessment remains fully expanded. Evidence and Delivery follow below. Right metadata rail remains approximately 280 px. Bottom action area is clearly separated by one top border and contains secondary Cancel Issue / Retry implementation plus one violet primary confirmation action.

## Variant B — Compact assessment

Use the identical shell, tokens, components, and available actions. Keep Assessment verdict prominent, but make reasoning, root cause, and solution compact preview rows so evidence appears earlier above the fold. No tabs, dashboards, or new navigation patterns. Preserve the right metadata rail and bottom action area.

## Variant C — Evidence-forward with quieter activity

Use the identical shell, tokens, components, and content order. Keep the evidence gallery in the current responsive grid, with changed files and verification results directly beneath it. Make Agent activity a collapsed, quiet row in the metadata rail. Clarify the bottom action hierarchy using alignment and whitespace only, with no new floating controls.
