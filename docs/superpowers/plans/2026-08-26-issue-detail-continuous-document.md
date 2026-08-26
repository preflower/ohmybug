# Issue Detail Continuous Document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and archive two system-aligned Issue detail concepts that replace the card-first main column with a continuous document flow while preserving the fixed metadata rail and bottom actions.

**Architecture:** Use the approved design specification and the existing system-aligned Issue detail image as the visual reference. Generate balanced and dense variants independently, inspect each against a hard rejection checklist, then copy only accepted PNGs into `docs/design` with a reproducible prompt record.

**Tech Stack:** ImageGen, local PNG inspection, Markdown prompt documentation, Git, pnpm/Vitest verification.

---

## File map

- Create `docs/design/issue-detail-continuous-imagegen-prompts.md`: shared constraints and exact variant prompts.
- Create `docs/design/issue-detail-continuous-balanced.png`: recommended balanced document concept.
- Create `docs/design/issue-detail-continuous-dense.png`: higher-density document concept.
- Reference `docs/design/issue-detail-system-aligned-b.png`: current-system visual language and content reference only.
- Reference `docs/superpowers/specs/2026-08-26-issue-detail-continuous-document-design.md`: approved requirements and acceptance criteria.

### Task 1: Record the generation prompts

**Files:**
- Create: `docs/design/issue-detail-continuous-imagegen-prompts.md`
- Reference: `docs/superpowers/specs/2026-08-26-issue-detail-continuous-document-design.md`

- [ ] **Step 1: Create the shared prompt constraints**

Use `apply_patch` to create the prompt record with these non-negotiable requirements:

```markdown
# Issue Detail Continuous Document — ImageGen Prompts

Reference image: `docs/design/issue-detail-system-aligned-b.png` for the existing Oh My Bug visual system and content only.

## Shared constraints

- Render only the selected Issue detail workspace, fixed right metadata rail, and fixed bottom action bar. Exclude the global sidebar and Issue list.
- Replace the card stack in the main column with one continuous white document.
- Separate Assessment, Evidence, Changed Files, Verification, and Delivery using typography, 1 px horizontal rules, alignment, and whitespace. Do not enclose these normal sections in cards.
- Preserve all existing content and actions: Issue ID, title, summary, failed-status notice, verdict, reasoning, root cause, solution, evidence, files, verification, delivery, project, branch, source, status, Agent session, Terminal action, timestamps, Agent activity, Cancel Issue, Retry implementation, and the violet context-sensitive confirmation action.
- Match the current light neutral palette, compact typography, violet accent, thin borders, right rail width, and desktop-tool density.
- Keep local boundaries only for the status notice, evidence thumbnails, code snippets, inputs, and buttons.
- No gradients, glow, glass, decorative shadows, atmospheric backgrounds, oversized headings, fake logos, yellow review state, new navigation, or speculative modules.
- Chinese UI copy, 1440×960 desktop framing, implementation-realistic product screenshot.
```

- [ ] **Step 2: Add the balanced variant prompt**

Append this exact variant direction:

```markdown
## Balanced document

Use 20–24 px vertical spacing between document sections. Keep Assessment fully readable, followed by a border-only four-column evidence thumbnail grid, compact changed-file rows, verification rows, and Delivery summary. Use a comfortable text measure and preserve a calm editorial rhythm. The fixed bottom bar has Cancel Issue and Retry implementation on the left and one violet primary confirmation action on the right.
```

- [ ] **Step 3: Add the dense variant prompt**

Append this exact variant direction:

```markdown
## Dense document

Use 14–18 px vertical spacing, shorter Assessment line lengths, and compact code-review-style rows so evidence, file changes, verification, and Delivery fit earlier above the fold. Preserve the same continuous document architecture, tokens, right metadata rail, and fixed bottom actions. Density may increase, but no normal section may regain an enclosing card.
```

- [ ] **Step 4: Verify prompt completeness**

Run:

```bash
rg -n "continuous white document|Do not enclose|Balanced document|Dense document|Cancel Issue|Retry implementation" docs/design/issue-detail-continuous-imagegen-prompts.md
```

Expected: all shared constraints and both variant headings are present.

### Task 2: Generate and accept the balanced document concept

**Files:**
- Create: `docs/design/issue-detail-continuous-balanced.png`
- Reference: `docs/design/issue-detail-system-aligned-b.png`
- Reference: `docs/design/issue-detail-continuous-imagegen-prompts.md`

- [ ] **Step 1: Generate the balanced variant**

Call ImageGen with `docs/design/issue-detail-system-aligned-b.png` as the reference image. Combine the shared constraints and the Balanced document prompt verbatim. Describe the reference as a style/content source, not a layout to copy.

- [ ] **Step 2: Inspect at original resolution**

Use `view_image` on the generated PNG and reject it if any of these conditions are present:

- Assessment, Evidence, Changed Files, Verification, or Delivery has an enclosing rounded card.
- The page uses a dark, tinted, gradient, glowing, or atmospheric background.
- The right metadata rail or fixed bottom action bar is absent.
- Cancel Issue, Retry implementation, the primary confirmation action, or any metadata group is missing.
- Yellow is used for review or confirmation state.
- The global application sidebar or Issue list appears.

- [ ] **Step 3: Correct only if rejection criteria are triggered**

If rejected, call ImageGen edit with the generated PNG and an explicit list of the failed criteria. Repeat inspection once. If it still fails, generate a fresh image from the original reference and stronger negative constraints.

- [ ] **Step 4: Save the accepted image**

Read the absolute PNG path from the successful ImageGen result. Use `exec_command` to copy that exact source path to `docs/design/issue-detail-continuous-balanced.png` without deleting the generated original. Do not use a glob or choose the newest file implicitly.

Expected: one new 1536×1024 RGB PNG at the target path.

### Task 3: Generate and accept the dense document concept

**Files:**
- Create: `docs/design/issue-detail-continuous-dense.png`
- Reference: `docs/design/issue-detail-system-aligned-b.png`
- Reference: `docs/design/issue-detail-continuous-imagegen-prompts.md`

- [ ] **Step 1: Generate the dense variant independently**

Call ImageGen from the original system-aligned reference, not from the balanced output. Combine the shared constraints and Dense document prompt verbatim so both variants share the product language without inheriting each other's generation artifacts.

- [ ] **Step 2: Inspect at original resolution**

Use the same rejection checklist from Task 2. Also reject the image if dense spacing makes the body text illegible, collapses the evidence captions, or hides actions.

- [ ] **Step 3: Correct only if rejection criteria are triggered**

If rejected, call ImageGen edit with the failed criteria. Repeat inspection once; if necessary, regenerate from the original reference.

- [ ] **Step 4: Save the accepted image**

Read the absolute PNG path from the successful ImageGen result. Use `exec_command` to copy that exact source path to `docs/design/issue-detail-continuous-dense.png` without deleting the generated original. Do not use a glob or choose the newest file implicitly.

Expected: one new 1536×1024 RGB PNG at the target path.

### Task 4: Verify and archive the deliverables

**Files:**
- Verify: `docs/design/issue-detail-continuous-balanced.png`
- Verify: `docs/design/issue-detail-continuous-dense.png`
- Verify: `docs/design/issue-detail-continuous-imagegen-prompts.md`

- [ ] **Step 1: Verify file formats and uniqueness**

Run:

```bash
file docs/design/issue-detail-continuous-{balanced,dense}.png
shasum -a 256 docs/design/issue-detail-continuous-{balanced,dense}.png
```

Expected: both files are 1536×1024 RGB PNG images with different SHA-256 hashes.

- [ ] **Step 2: Verify repository formatting and scope**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the prompt record and two new PNGs are uncommitted for this execution.

- [ ] **Step 3: Run the complete project test suite**

Run:

```bash
pnpm test
```

Expected: exit code 0 with no failing tests.

- [ ] **Step 4: Commit the accepted concepts**

```bash
git add docs/design/issue-detail-continuous-imagegen-prompts.md docs/design/issue-detail-continuous-balanced.png docs/design/issue-detail-continuous-dense.png
git commit -m "docs: add continuous issue detail concepts"
```

- [ ] **Step 5: Present both variants**

Show both PNGs using absolute local paths. Explain that Balanced prioritizes reading rhythm and Dense prioritizes above-the-fold evidence. Include the prompt record path, fresh test result, and commit ID.
