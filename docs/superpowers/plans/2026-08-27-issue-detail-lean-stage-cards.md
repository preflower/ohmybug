# Issue Detail Lean Stage Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and archive one high-fidelity Issue detail concept with exactly four lightweight stage cards and no duplicated workflow-state information.

**Architecture:** Use the current system-aligned card concept as the visual reference, but rebuild its information hierarchy around four top-level content cards. Keep card interiors flat, remove every redundant state/count/progress label, inspect against a strict minimal-content checklist, and archive the accepted PNG with its prompt.

**Tech Stack:** Built-in ImageGen, local PNG inspection, Markdown prompt documentation, Git, pnpm/Vitest verification.

---

## File map

- Create `docs/design/issue-detail-lean-stage-cards-imagegen-prompt.md`: exact generation constraints.
- Create `docs/design/issue-detail-lean-stage-cards.png`: accepted concept image.
- Reference `docs/design/issue-detail-system-aligned-a.png`: current Oh My Bug ?! card visual language.
- Reference `docs/superpowers/specs/2026-08-27-issue-detail-lean-stage-cards-design.md`: approved content and acceptance rules.

### Task 1: Record the exact prompt

**Files:**
- Create: `docs/design/issue-detail-lean-stage-cards-imagegen-prompt.md`

- [ ] **Step 1: Create the prompt record**

Use `apply_patch` to record these exact requirements:

```markdown
# Issue Detail Lean Stage Cards — ImageGen Prompt

Reference: `docs/design/issue-detail-system-aligned-a.png` for the current Oh My Bug ?! light design system, card treatment, metadata rail, controls, and Chinese Issue content.

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
```

- [ ] **Step 2: Verify prompt completeness**

Run:

```bash
rg -n "exactly four|workflow state|评估|执行|证据|交付|Do not show|Remove the Issue status|no nested cards" docs/design/issue-detail-lean-stage-cards-imagegen-prompt.md
```

Expected: all four cards, state-removal rules, and nesting prohibition are present.

### Task 2: Generate and accept the concept

**Files:**
- Create: `docs/design/issue-detail-lean-stage-cards.png`
- Reference: `docs/design/issue-detail-system-aligned-a.png`
- Reference: `docs/design/issue-detail-lean-stage-cards-imagegen-prompt.md`

- [ ] **Step 1: Generate from the current system reference**

Call built-in ImageGen with `docs/design/issue-detail-system-aligned-a.png` as a style and component reference. Use the recorded prompt verbatim and emphasize that the reference content density must be reduced.

- [ ] **Step 2: Inspect at original resolution**

Use `view_image` and reject if any condition is true:

- There are not exactly four top-level stage cards.
- Any stage card contains another rounded card or filled panel.
- Any workflow state, status field, progress node, stage number, evidence count, “验证结果”, “验证通过”, completed label, or pending label appears.
- The card headings contain anything other than 评估, 执行, 证据, and 交付.
- Evidence does not place one conclusion sentence directly above the thumbnails.
- Changed files are outside 执行, or branch and commit are outside 交付.
- The right rail or fixed bottom action bar is missing.
- The global sidebar, Issue list, dark background, gradient, glow, or yellow review styling appears.

- [ ] **Step 3: Correct a failed invariant once**

If rejected, edit the generated PNG with only the failed checklist items and inspect again. If it still fails, regenerate from the original reference with stronger negative constraints.

- [ ] **Step 4: Save the accepted PNG**

Read the exact absolute PNG path from the accepted ImageGen result. Copy it to `docs/design/issue-detail-lean-stage-cards.png` without deleting the generated original or using a glob.

### Task 3: Verify and archive

**Files:**
- Verify: `docs/design/issue-detail-lean-stage-cards.png`
- Verify: `docs/design/issue-detail-lean-stage-cards-imagegen-prompt.md`

- [ ] **Step 1: Verify format**

Run:

```bash
file docs/design/issue-detail-lean-stage-cards.png
shasum -a 256 docs/design/issue-detail-lean-stage-cards.png
```

Expected: one 1536×1024 RGB PNG and one SHA-256 hash.

- [ ] **Step 2: Verify repository scope**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the prompt record and PNG are uncommitted for this execution.

- [ ] **Step 3: Run the complete test suite**

Run `pnpm test` and require exit code 0 with no failing tests.

- [ ] **Step 4: Commit**

```bash
git add docs/design/issue-detail-lean-stage-cards-imagegen-prompt.md docs/design/issue-detail-lean-stage-cards.png
git commit -m "docs: add lean issue stage card concept"
```

- [ ] **Step 5: Present the concept**

Show the PNG using its absolute local path. Explain the removed information, identify ImageGen limitations, and include the prompt record, fresh test result, and commit ID.
