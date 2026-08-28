# Issue Detail Continuous Document — ImageGen Prompts

Reference image: `docs/design/issue-detail-system-aligned-b.png` for the existing Oh My Bug ?! visual system and content only.

## Shared constraints

- Render only the selected Issue detail workspace, fixed right metadata rail, and fixed bottom action bar. Exclude the global sidebar and Issue list.
- Replace the card stack in the main column with one continuous white document.
- Separate Assessment, Evidence, Changed Files, Verification, and Delivery using typography, 1 px horizontal rules, alignment, and whitespace. Do not enclose these normal sections in cards.
- Preserve all existing content and actions: Issue ID, title, summary, failed-status notice, verdict, reasoning, root cause, solution, evidence, files, verification, delivery, project, branch, source, status, Agent session, Terminal action, timestamps, Agent activity, Cancel Issue, Retry implementation, and the violet context-sensitive confirmation action.
- Match the current light neutral palette, compact typography, violet accent, thin borders, right rail width, and desktop-tool density.
- Keep local boundaries only for the status notice, evidence thumbnails, code snippets, inputs, and buttons.
- No gradients, glow, glass, decorative shadows, atmospheric backgrounds, oversized headings, fake logos, yellow review state, new navigation, or speculative modules.
- Chinese UI copy, 1440×960 desktop framing, implementation-realistic product screenshot.

## Balanced document

Use 20–24 px vertical spacing between document sections. Keep Assessment fully readable, followed by a border-only four-column evidence thumbnail grid, compact changed-file rows, verification rows, and Delivery summary. Use a comfortable text measure and preserve a calm editorial rhythm. The fixed bottom bar has Cancel Issue and Retry implementation on the left and one violet primary confirmation action on the right.

## Dense document

Use 14–18 px vertical spacing, shorter Assessment line lengths, and compact code-review-style rows so evidence, file changes, verification, and Delivery fit earlier above the fold. Preserve the same continuous document architecture, tokens, right metadata rail, and fixed bottom actions. Density may increase, but no normal section may regain an enclosing card.
