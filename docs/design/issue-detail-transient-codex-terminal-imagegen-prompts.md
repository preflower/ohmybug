# Issue Detail Transient Codex Terminal — ImageGen Prompts

References: `issue-detail-system-aligned-a.png` for the current Assessment style and `issue-detail-lean-stage-cards.png` for the accepted minimal content hierarchy.

## Shared constraints

- Render only the selected Issue detail workspace, right metadata rail, and fixed bottom action bar at 1440×960. Exclude the global sidebar and Issue list.
- Preserve the current Assessment card exactly: “评估结果 · Assessment”, verdict icon and reasoning, Bug 原因 with search icon, 解决方案 with wrench icon, current dividers and spacing.
- Do not add workflow state, progress, stage numbers, completion labels, pending labels, status chips, counts, or a status field in the rail.
- The rail contains project, branch and Worktree, source, Agent session, created time, and updated time. It contains no Agent activity section.
- Follow the current light neutral design system, compact typography, subtle borders, 8 px card radius, and violet interactive controls.
- No gradients, glow, glass, decorative shadows, atmospheric background, fake terminal chrome, yellow review styling, dark page theme, new navigation, or dashboard widgets.

## Active execution state

- Show Issue header, current Assessment card, then one Codex Terminal panel. Do not show Evidence or Delivery.
- Codex Terminal header contains only “Codex Terminal” and “在 Terminal 中打开”.
- Use one bounded dark terminal surface with subtle border and current card radius. No nested cards and no command input.
- Show realistic read-only Codex messages, commands, and outputs for inspecting issue-detail.tsx, editing layout CSS, and running tests. Use monospace for commands and output.
- The panel visibly has internal scrolling and a lightweight “回到最新” control near the lower edge, without any running-status label.
- The rail omits the external Terminal action while the same action is in the panel header.
- Bottom bar shows only Cancel Issue and Pause execution actions appropriate to active execution, with no helper copy.

## Result state

- Show Issue header, current Assessment card, one Evidence card, and one Delivery card. Do not show any Terminal, Execution card, terminal residue, execution summary, or execution-history entry.
- Evidence contains one direct conclusion followed immediately by four media thumbnails. No evidence count, “验证结果”, success label, or nested gallery card.
- Delivery contains only concise description, target branch, and Issue commit summary. No state or statistics.
- The rail shows “在 Terminal 中打开” beside Agent session because the transient panel is absent.
- Bottom bar shows only Cancel Issue, Retry evidence, and one violet primary confirmation action, without helper copy.
