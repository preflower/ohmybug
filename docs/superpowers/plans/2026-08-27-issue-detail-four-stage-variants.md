# Issue Detail Four-stage Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate three system-aligned Issue detail concepts that make Assessment, Execution, Evidence, and Delivery visibly distinct through a process rail, stage title bands, or a section index column.

**Architecture:** Use one shared four-stage information model and identical Issue content in all three images. Start every generation independently from the approved continuous-document concept, change only the stage-navigation treatment, reject any output that reintroduces stage cards or misplaces content, and archive accepted PNGs with their prompts.

**Tech Stack:** Built-in ImageGen, local PNG inspection, Markdown prompt documentation, Git, pnpm/Vitest verification.

---

## File map

- Create `docs/design/issue-detail-four-stage-imagegen-prompts.md`: common stage model and exact variant prompts.
- Create `docs/design/issue-detail-four-stage-rail.png`: vertical process-rail concept.
- Create `docs/design/issue-detail-four-stage-bands.png`: stage-title-band concept.
- Create `docs/design/issue-detail-four-stage-index.png`: section-index-column concept.
- Reference `docs/design/issue-detail-continuous-balanced.png`: current-system continuous-document visual reference.
- Reference `docs/superpowers/specs/2026-08-27-issue-detail-four-stage-variants-design.md`: approved architecture and acceptance criteria.

### Task 1: Record common and variant prompts

**Files:**
- Create: `docs/design/issue-detail-four-stage-imagegen-prompts.md`
- Reference: `docs/superpowers/specs/2026-08-27-issue-detail-four-stage-variants-design.md`

- [ ] **Step 1: Create the shared prompt**

Use `apply_patch` to create a prompt record containing these exact common constraints:

```markdown
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
```

- [ ] **Step 2: Add the process-rail prompt**

```markdown
## Variant A — Vertical process rail

Add one slim neutral vertical line at the left edge of the main document. Align four compact nodes with the four stage headings. Assessment and Execution use green check nodes, Evidence uses a violet filled current node, and Delivery uses a gray hollow pending node. Flow all stage content directly to the right of the rail with no enclosing stage container. The line and nodes must make the four-stage process recognizable within three seconds without dominating the document.
```

- [ ] **Step 3: Add the title-band prompt**

```markdown
## Variant B — Stage title bands

Begin each stage with a full-width title row containing its number, Chinese name, English name, and compact status. Use typography, whitespace, and a 1 px divider only; the row has no fill, rounded rectangle, or shadow. Completed stages use a small green check, Evidence uses violet text and a violet current marker, and Delivery uses muted gray pending text. Flow content directly beneath each title row.
```

- [ ] **Step 4: Add the index-column prompt**

```markdown
## Variant C — Section index column

Split the main document internally into a narrow 120 px stage-index column and a readable content column. List all four numbered stages in the index. Assessment and Execution show green checks, Evidence uses violet text plus a short violet vertical indicator, and Delivery is muted gray. Align each index entry with its fully expanded content section. The index must not look like a second application sidebar and must not reduce body readability.
```

- [ ] **Step 5: Verify prompt completeness**

Run:

```bash
rg -n "01 评估|02 执行|03 证据|04 交付|Vertical process rail|Stage title bands|Section index column|Cancel Issue|Retry" docs/design/issue-detail-four-stage-imagegen-prompts.md
```

Expected: all four stages, three variant headings, and bottom actions are present.

### Task 2: Generate the process-rail concept

**Files:**
- Create: `docs/design/issue-detail-four-stage-rail.png`
- Reference: `docs/design/issue-detail-continuous-balanced.png`
- Reference: `docs/design/issue-detail-four-stage-imagegen-prompts.md`

- [ ] **Step 1: Generate Variant A independently**

Call built-in ImageGen with `docs/design/issue-detail-continuous-balanced.png` as a style and content reference. Combine the shared prompt with Variant A. Explicitly state that the reference stage hierarchy must be replaced by the four-stage rail.

- [ ] **Step 2: Inspect at original resolution**

Use `view_image` and reject the output if any condition is true:

- The four stages cannot be identified within three seconds.
- Nodes or line are missing, disconnected from stage headings, or use the wrong completion states.
- Changed files are outside Execution, screenshots or verification are outside Evidence, or final summary is outside Delivery.
- A stage has an enclosing rounded card or filled panel.
- The right metadata rail, fixed bottom actions, or any existing action is missing.
- The global sidebar, Issue list, dark background, gradient, glow, or yellow review styling appears.

- [ ] **Step 3: Correct only a failed invariant**

If rejected, edit the generated image with the failed checklist items and repeat inspection once. If it still fails, regenerate from the original reference with stronger negative constraints.

- [ ] **Step 4: Save the accepted rail image**

Read the exact absolute PNG path from the accepted ImageGen result. Copy that file to `docs/design/issue-detail-four-stage-rail.png` without deleting the generated original or using a glob.

### Task 3: Generate the stage-title-band concept

**Files:**
- Create: `docs/design/issue-detail-four-stage-bands.png`
- Reference: `docs/design/issue-detail-continuous-balanced.png`
- Reference: `docs/design/issue-detail-four-stage-imagegen-prompts.md`

- [ ] **Step 1: Generate Variant B independently**

Call built-in ImageGen from the original continuous-document reference. Combine the shared prompt with Variant B. Keep the same Issue content and Stage 03 current state used in Variant A.

- [ ] **Step 2: Inspect at original resolution**

Apply the Task 2 content-placement and system-style rejection checks. Also reject the image if title rows use filled backgrounds, rounded bands, oversized typography, or ambiguous stage status.

- [ ] **Step 3: Correct only a failed invariant**

If rejected, edit once with the exact failed conditions. Regenerate from the original reference if the edit remains noncompliant.

- [ ] **Step 4: Save the accepted bands image**

Copy the exact accepted ImageGen PNG to `docs/design/issue-detail-four-stage-bands.png` without deleting its original.

### Task 4: Generate the section-index concept

**Files:**
- Create: `docs/design/issue-detail-four-stage-index.png`
- Reference: `docs/design/issue-detail-continuous-balanced.png`
- Reference: `docs/design/issue-detail-four-stage-imagegen-prompts.md`

- [ ] **Step 1: Generate Variant C independently**

Call built-in ImageGen from the original continuous-document reference. Combine the shared prompt with Variant C. Keep the same Issue content and Stage 03 current state used in Variants A and B.

- [ ] **Step 2: Inspect at original resolution**

Apply the Task 2 content-placement and system-style rejection checks. Also reject the image if the index resembles global navigation, exceeds approximately 120 px, hides a stage, or makes the main text unreadable.

- [ ] **Step 3: Correct only a failed invariant**

If rejected, edit once with the exact failed conditions. Regenerate from the original reference if the edit remains noncompliant.

- [ ] **Step 4: Save the accepted index image**

Copy the exact accepted ImageGen PNG to `docs/design/issue-detail-four-stage-index.png` without deleting its original.

### Task 5: Verify and archive all three concepts

**Files:**
- Verify: `docs/design/issue-detail-four-stage-rail.png`
- Verify: `docs/design/issue-detail-four-stage-bands.png`
- Verify: `docs/design/issue-detail-four-stage-index.png`
- Verify: `docs/design/issue-detail-four-stage-imagegen-prompts.md`

- [ ] **Step 1: Verify formats and uniqueness**

Run:

```bash
file docs/design/issue-detail-four-stage-{rail,bands,index}.png
shasum -a 256 docs/design/issue-detail-four-stage-{rail,bands,index}.png
```

Expected: three 1536×1024 RGB PNGs with three different SHA-256 hashes.

- [ ] **Step 2: Verify repository scope**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the prompt record and three new PNGs are uncommitted for this execution.

- [ ] **Step 3: Run the complete test suite**

Run:

```bash
pnpm test
```

Expected: exit code 0 with no failing tests.

- [ ] **Step 4: Commit the concepts**

```bash
git add docs/design/issue-detail-four-stage-imagegen-prompts.md docs/design/issue-detail-four-stage-rail.png docs/design/issue-detail-four-stage-bands.png docs/design/issue-detail-four-stage-index.png
git commit -m "docs: add four-stage issue detail concepts"
```

- [ ] **Step 5: Present the comparison**

Show the three PNGs using absolute local paths. Describe only the process-visualization difference, identify any generation limitations, include the prompt record, fresh test result, and commit ID.
