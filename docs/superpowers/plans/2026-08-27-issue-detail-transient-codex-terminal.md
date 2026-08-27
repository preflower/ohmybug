# Issue Detail Transient Codex Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate two system-aligned Issue detail concepts that demonstrate a transient read-only Codex Terminal during Agent execution and its complete removal after execution.

**Architecture:** Use the current system-aligned Assessment concept and the accepted lean-card concept as complementary references. Generate active and result states independently with identical Issue identity, preserve the existing Assessment styling, verify the state transition and information removal, then archive both PNGs with exact prompts.

**Tech Stack:** Built-in ImageGen, local PNG inspection, Markdown prompt documentation, Git, pnpm/Vitest verification.

---

## File map

- Create `docs/design/issue-detail-transient-codex-terminal-imagegen-prompts.md`: shared, active, and result prompts.
- Create `docs/design/issue-detail-transient-terminal-active.png`: Agent executing with read-only Terminal visible.
- Create `docs/design/issue-detail-transient-terminal-result.png`: execution finished with Terminal absent.
- Reference `docs/design/issue-detail-system-aligned-a.png`: current Assessment structure and project visual system.
- Reference `docs/design/issue-detail-lean-stage-cards.png`: accepted minimal Evidence, Delivery, metadata rail, and bottom actions.
- Reference `docs/superpowers/specs/2026-08-27-issue-detail-transient-codex-terminal-design.md`: approved behavior and acceptance rules.

### Task 1: Record exact prompts

**Files:**
- Create: `docs/design/issue-detail-transient-codex-terminal-imagegen-prompts.md`

- [ ] **Step 1: Record the shared constraints**

Use `apply_patch` to record:

```markdown
# Issue Detail Transient Codex Terminal — ImageGen Prompts

References: `issue-detail-system-aligned-a.png` for the current Assessment style and `issue-detail-lean-stage-cards.png` for the accepted minimal content hierarchy.

## Shared constraints

- Render only the selected Issue detail workspace, right metadata rail, and fixed bottom action bar at 1440×960. Exclude the global sidebar and Issue list.
- Preserve the current Assessment card exactly: “评估结果 · Assessment”, verdict icon and reasoning, Bug 原因 with search icon, 解决方案 with wrench icon, current dividers and spacing.
- Do not add workflow state, progress, stage numbers, completion labels, pending labels, status chips, counts, or a status field in the rail.
- The rail contains project, branch and Worktree, source, Agent session, created time, and updated time. It contains no Agent activity section.
- Follow the current light neutral design system, compact typography, subtle borders, 8 px card radius, and violet interactive controls.
- No gradients, glow, glass, decorative shadows, atmospheric background, fake terminal chrome, yellow review styling, dark page theme, new navigation, or dashboard widgets.
```

- [ ] **Step 2: Record the active-state prompt**

```markdown
## Active execution state

- Show Issue header, current Assessment card, then one Codex Terminal panel. Do not show Evidence or Delivery.
- Codex Terminal header contains only “Codex Terminal” and “在 Terminal 中打开”.
- Use one bounded dark terminal surface with subtle border and current card radius. No nested cards and no command input.
- Show realistic read-only Codex messages, commands, and outputs for inspecting issue-detail.tsx, editing layout CSS, and running tests. Use monospace for commands and output.
- The panel visibly has internal scrolling and a lightweight “回到最新” control near the lower edge, without any running-status label.
- The rail omits the external Terminal action while the same action is in the panel header.
- Bottom bar shows only Cancel Issue and Pause execution actions appropriate to active execution, with no helper copy.
```

- [ ] **Step 3: Record the result-state prompt**

```markdown
## Result state

- Show Issue header, current Assessment card, one Evidence card, and one Delivery card. Do not show any Terminal, Execution card, terminal residue, execution summary, or execution-history entry.
- Evidence contains one direct conclusion followed immediately by four media thumbnails. No evidence count, “验证结果”, success label, or nested gallery card.
- Delivery contains only concise description, target branch, and Issue commit summary. No state or statistics.
- The rail shows “在 Terminal 中打开” beside Agent session because the transient panel is absent.
- Bottom bar shows only Cancel Issue, Retry evidence, and one violet primary confirmation action, without helper copy.
```

- [ ] **Step 4: Verify prompt coverage**

Run:

```bash
rg -n "current Assessment|Codex Terminal|no command input|回到最新|Do not show any Terminal|Evidence contains|Delivery contains|no Agent activity" docs/design/issue-detail-transient-codex-terminal-imagegen-prompts.md
```

Expected: Assessment preservation, active Terminal behavior, result removal, and rail constraints are present.

### Task 2: Generate and accept the active state

**Files:**
- Create: `docs/design/issue-detail-transient-terminal-active.png`
- Reference: `docs/design/issue-detail-system-aligned-a.png`
- Reference: `docs/design/issue-detail-lean-stage-cards.png`

- [ ] **Step 1: Generate active state independently**

Call built-in ImageGen with both reference images. Label the first as Assessment/style reference and the second as minimal-layout reference. Combine shared and active-state prompts.

- [ ] **Step 2: Inspect at original resolution**

Use `view_image` and reject if:

- Assessment no longer matches the current icon-and-block style.
- Evidence or Delivery appears.
- Codex Terminal is absent, interactive, unbounded, or styled with fake chrome, glow, or gradient.
- Terminal header contains status text or lacks the external action.
- A command input field appears.
- The rail repeats Agent activity or the external Terminal action.
- Workflow state appears anywhere in the detail.

- [ ] **Step 3: Correct one failed invariant**

If rejected, edit once with the failed checklist items. Regenerate from both original references if the edit remains noncompliant.

- [ ] **Step 4: Save accepted active PNG**

Copy the exact absolute accepted ImageGen PNG to `docs/design/issue-detail-transient-terminal-active.png` without deleting its generated original or using a glob.

### Task 3: Generate and accept the result state

**Files:**
- Create: `docs/design/issue-detail-transient-terminal-result.png`
- Reference: `docs/design/issue-detail-system-aligned-a.png`
- Reference: `docs/design/issue-detail-lean-stage-cards.png`

- [ ] **Step 1: Generate result state independently**

Call built-in ImageGen from both original references, not the active output. Combine shared and result-state prompts with the same Issue identity.

- [ ] **Step 2: Inspect at original resolution**

Use `view_image` and reject if:

- Assessment no longer matches the current style.
- Terminal, Execution card, execution residue, Agent activity, or workflow state appears.
- Evidence contains a count, extra result heading, success state, or nested gallery card.
- Delivery contains state, evidence statistics, or execution summary.
- The rail or fixed bottom actions are missing.

- [ ] **Step 3: Correct one failed invariant**

If rejected, edit once with the failed checklist items. Regenerate from both original references if needed.

- [ ] **Step 4: Save accepted result PNG**

Copy the exact absolute accepted ImageGen PNG to `docs/design/issue-detail-transient-terminal-result.png` without deleting its generated original.

### Task 4: Verify and archive

**Files:**
- Verify: `docs/design/issue-detail-transient-terminal-active.png`
- Verify: `docs/design/issue-detail-transient-terminal-result.png`
- Verify: `docs/design/issue-detail-transient-codex-terminal-imagegen-prompts.md`

- [ ] **Step 1: Verify formats and uniqueness**

Run:

```bash
file docs/design/issue-detail-transient-terminal-{active,result}.png
shasum -a 256 docs/design/issue-detail-transient-terminal-{active,result}.png
```

Expected: two 1536×1024 RGB PNGs with different SHA-256 hashes.

- [ ] **Step 2: Verify repository scope**

Run `git diff --check` and `git status --short`. Require no whitespace errors and only the prompt record plus two PNGs for this execution.

- [ ] **Step 3: Run complete tests**

Run `pnpm test` and require exit code 0 with no failing tests.

- [ ] **Step 4: Commit**

```bash
git add docs/design/issue-detail-transient-codex-terminal-imagegen-prompts.md docs/design/issue-detail-transient-terminal-active.png docs/design/issue-detail-transient-terminal-result.png
git commit -m "docs: add transient codex terminal concepts"
```

- [ ] **Step 5: Present both states**

Show both PNGs with absolute local paths, explain the state transition and ImageGen limitations, and include the prompt record, fresh test result, and commit ID.
