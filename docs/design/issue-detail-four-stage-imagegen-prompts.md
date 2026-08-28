# Issue Detail Four-stage Variants — ImageGen Prompts

Reference: `docs/design/issue-detail-continuous-balanced.png` for the existing Oh My Bug ?! visual system, continuous-document surface, metadata rail, controls, and Chinese Issue content.

## Shared prompt

- Render only the selected Issue detail workspace, fixed right metadata rail, and fixed bottom action bar at 1440×960. Exclude the global sidebar and Issue list.
- Show four fully expanded stages in this exact order: 01 评估 / Assessment, 02 执行 / Execution, 03 证据 / Evidence, 04 交付 / Delivery.
- Assessment contains verdict, reasoning, Bug root cause, proposed solution, and Assessment review result.
- Execution contains implementation state, concise Agent execution summary, changed files, additions, deletions, and retry state.
- Evidence contains four screenshot or recording thumbnails, evidence count, verification results, and evidence acceptance state.
- Delivery contains delivery summary, target branch, Issue commit summary, final acceptance result, and close-Issue outcome.
- The right rail contains only project, branch and Worktree, source, Issue status, Agent session, Open in Terminal, created time, updated time, and collapsed Agent activity with event count.
- The fixed bottom bar contains Cancel Issue, the relevant Retry action, and one violet context-sensitive primary confirmation action.
- Highlight Stage 03 Evidence as the current stage. Show Assessment and Execution as completed and Delivery as pending. Use the identical current-stage state in all three variants.
- Follow the existing light neutral palette, white continuous document, cool-gray dividers, charcoal text, muted metadata, restrained violet accent, compact typography, and 30–32 px controls.
- Never enclose the four stages in rounded cards, filled panels, tiles, or colored bands. Keep boundaries only for the failed-status notice, evidence thumbnails, code snippets, inputs, and buttons.
- No gradients, glow, glass, decorative shadows, atmospheric backgrounds, oversized headings, fake branding, yellow review state, new navigation, dashboards, or speculative modules.

## Variant A — Vertical process rail

Add one slim neutral vertical line at the left edge of the main document. Align four compact nodes with the four stage headings. Assessment and Execution use green check nodes, Evidence uses a violet filled current node, and Delivery uses a gray hollow pending node. Flow all stage content directly to the right of the rail with no enclosing stage container. The line and nodes must make the four-stage process recognizable within three seconds without dominating the document.

## Variant B — Stage title bands

Begin each stage with a full-width title row containing its number, Chinese name, English name, and compact status. Use typography, whitespace, and a 1 px divider only; the row has no fill, rounded rectangle, or shadow. Completed stages use a small green check, Evidence uses violet text and a violet current marker, and Delivery uses muted gray pending text. Flow content directly beneath each title row.

## Variant C — Section index column

Split the main document internally into a narrow 120 px stage-index column and a readable content column. List all four numbered stages in the index. Assessment and Execution show green checks, Evidence uses violet text plus a short violet vertical indicator, and Delivery is muted gray. Align each index entry with its fully expanded content section. The index must not look like a second application sidebar and must not reduce body readability.
