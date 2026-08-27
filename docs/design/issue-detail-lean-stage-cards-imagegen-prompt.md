# Issue Detail Lean Stage Cards — ImageGen Prompt

Reference: `docs/design/issue-detail-system-aligned-a.png` for the current Oh My Bug light design system, card treatment, metadata rail, controls, and Chinese Issue content.

- Render only the selected Issue detail workspace, right metadata rail, and fixed bottom action bar at 1440×960. Exclude the global sidebar and Issue list.
- The main column contains the Issue ID, title, description, then exactly four top-level cards titled only 评估, 执行, 证据, 交付.
- Do not show workflow state anywhere in the detail page. No status field in the rail, status banner, progress bar, numbered steps, completed or pending labels, current-stage marker, status chip, stage count, evidence count, or success label.
- 评估 contains only verdict 是 Bug, Bug 原因, and 解决方案.
- 执行 contains only a one- or two-sentence implementation summary and changed-file rows with additions and deletions.
- 证据 contains only one direct conclusion sentence followed immediately by four evidence thumbnails with short captions. Do not show “4 项证据”, “验证结果”, “验证通过”, or evidence-state copy.
- 交付 contains only a concise delivery description, target branch, and Issue commit summary.
- Keep project, branch and Worktree, source, Agent session, Open in Terminal, created time, updated time, and collapsed Agent activity in the rail. Remove the Issue status field.
- Keep Cancel Issue, Retry evidence, and one violet primary confirmation action in the fixed bottom bar without helper text.
- Each stage has one subtle white surface, gray border, approximately 8 px radius, and no decorative shadow. Use about 12 px between cards and 8–12 px internal spacing.
- Card interiors are flat: no nested cards, inner rounded panels, filled content blocks, stage icons, English subtitles, or decorative accents.
- Evidence thumbnails may keep individual thin borders and captions.
- Follow the existing compact light palette and typography. Violet is reserved for actual interactive controls.
- No gradients, glow, glass, atmospheric backgrounds, oversized headings, fake branding, yellow review styling, dark theme, new navigation, or dashboard widgets.
