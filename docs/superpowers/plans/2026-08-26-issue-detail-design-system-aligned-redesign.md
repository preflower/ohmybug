# Issue Detail Design-System-Aligned Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce three Issue detail concepts that preserve the current Oh My Bug layout skeleton, tokens, component vocabulary, and density while exploring bounded hierarchy improvements.

**Architecture:** The current implementation and CSS are the source of truth. A current UI reference image is captured when locally available; three separate built-in ImageGen calls then use that reference plus exact numeric constraints, and each output is rejected or corrected when it introduces new product architecture or visual language.

**Tech Stack:** Existing React/CSS UI as reference, in-app browser or local screenshot capture, built-in ImageGen, PNG artifacts, Markdown prompt record, Git

---

## File Structure

- Create: `docs/design/issue-detail-system-aligned-imagegen-prompts.md` — exact shared design-system contract and three prompts.
- Create: `docs/design/issue-detail-system-aligned-a.png` — faithful hierarchy polish.
- Create: `docs/design/issue-detail-system-aligned-b.png` — compact Assessment and earlier evidence.
- Create: `docs/design/issue-detail-system-aligned-c.png` — decision-focused dock and quiet activity.
- Read: `DESIGN.md`, `apps/desktop/src/web/styles/tokens.css`, `apps/desktop/src/web/styles/global.css`, and current Issue detail components.
- Temporary only: current UI screenshot captured outside tracked project artifacts for ImageGen reference.

### Task 1: Prepare the current-system reference and prompts

**Files:**
- Create: `docs/design/issue-detail-system-aligned-imagegen-prompts.md`

- [ ] **Step 1: Capture a current UI reference**

Start the existing web application without modifying source files. Open the current Issues route and capture the selected Issue detail at desktop width when a populated local Issue is available. If runtime data is unavailable, use the current source and CSS as the sole reference rather than fabricating a replacement application shell.

- [ ] **Step 2: Record the shared hard constraints**

Write the current dimensions and component rules verbatim:

```text
Document: width min(760px, 100%), centered; padding 24px clamp(20px, 3.5vw, 36px) 88px.
Metadata rail: approximately 280px; sidebar surface; 44px sticky header; one left border.
Title: 20px/590. Body: 12–13px. Metadata: 10–11px. Controls: 30px. Inputs: 32px.
Panel spacing: 12px. Panel padding: 18px. Assessment/Delivery radius: 8px. Small controls: 4–6px.
Evidence: responsive grid, min column 190px, 10px gap, 16:9 figures.
Action area: separate bottom row; one top border; surface-raised; current compact review dock.
Review state: accent blue-violet, never warning yellow.
```

- [ ] **Step 3: Record Prompt A**

Require the current order and expansion exactly: Issue title block, expanded Assessment blocks, Delivery and evidence, right rail, and review dock. Permit only spacing, alignment, and type emphasis refinements.

- [ ] **Step 4: Record Prompt B**

Keep the same skeleton and components, but make Assessment blocks concise previews with standard disclosure affordances so Delivery evidence appears earlier. Do not introduce tabs, columns, or a media viewer.

- [ ] **Step 5: Record Prompt C**

Keep the current document order and evidence grid, collapse historical Agent activity in the existing rail, and clarify the review dock consequence line through alignment and whitespace only.

- [ ] **Step 6: Verify the prompt record**

Run:

```bash
rg -n "^## Shared hard constraints|^## Prompt A|^## Prompt B|^## Prompt C|^## Rejection checklist" docs/design/issue-detail-system-aligned-imagegen-prompts.md
```

Expected: all five sections are present once.

### Task 2: Generate and inspect Variant A

**Files:**
- Create: `docs/design/issue-detail-system-aligned-a.png`

- [ ] **Step 1: Generate A**

Call built-in ImageGen with the shared hard constraints and Prompt A. Include the current UI screenshot as a reference image when capture succeeded. Do not use rejected concept images as references.

- [ ] **Step 2: Inspect A**

Confirm `760px + 280px` proportions, 20px title, compact text, accent review state, current panel shapes, two-column evidence grid, right rail, and separate bottom action area.

- [ ] **Step 3: Correct or save A**

If a hard constraint fails, make one targeted edit that preserves everything else. Save the selected output as `docs/design/issue-detail-system-aligned-a.png` without overwriting an existing asset.

### Task 3: Generate and inspect Variant B

**Files:**
- Create: `docs/design/issue-detail-system-aligned-b.png`

- [ ] **Step 1: Generate B**

Call built-in ImageGen with the shared hard constraints and Prompt B as a new concept.

- [ ] **Step 2: Inspect B**

Confirm the skeleton and component vocabulary remain unchanged while compact Assessment previews bring the current evidence grid earlier in the viewport.

- [ ] **Step 3: Correct or save B**

Apply at most one targeted correction for a hard-constraint failure, then save as `docs/design/issue-detail-system-aligned-b.png` without overwriting.

### Task 4: Generate and inspect Variant C

**Files:**
- Create: `docs/design/issue-detail-system-aligned-c.png`

- [ ] **Step 1: Generate C**

Call built-in ImageGen with the shared hard constraints and Prompt C as a new concept.

- [ ] **Step 2: Inspect C**

Confirm the current document and evidence grid remain intact, Agent activity uses the current collapsed disclosure vocabulary, and the review dock gains clarity without floating or growing.

- [ ] **Step 3: Correct or save C**

Apply at most one targeted correction for a hard-constraint failure, then save as `docs/design/issue-detail-system-aligned-c.png` without overwriting.

### Task 5: Verify and commit the accepted concepts

**Files:**
- Create: `docs/design/issue-detail-system-aligned-imagegen-prompts.md`
- Create: `docs/design/issue-detail-system-aligned-a.png`
- Create: `docs/design/issue-detail-system-aligned-b.png`
- Create: `docs/design/issue-detail-system-aligned-c.png`

- [ ] **Step 1: Compare all three outputs**

Inspect all images at original detail. Reject any output that resembles the earlier media-desk or dashboard concepts, uses warning yellow for review, introduces oversized type, or changes the current component language.

- [ ] **Step 2: Verify files and Git scope**

Run:

```bash
file docs/design/issue-detail-system-aligned-a.png docs/design/issue-detail-system-aligned-b.png docs/design/issue-detail-system-aligned-c.png
git diff --check
git status --short
```

Expected: three PNG files and only the four planned artifacts uncommitted.

- [ ] **Step 3: Run repository tests**

Run `pnpm test` and require exit code 0.

- [ ] **Step 4: Commit the aligned concepts**

```bash
git add docs/design/issue-detail-system-aligned-imagegen-prompts.md docs/design/issue-detail-system-aligned-a.png docs/design/issue-detail-system-aligned-b.png docs/design/issue-detail-system-aligned-c.png
git commit -m "docs: add system-aligned issue detail concepts"
```

- [ ] **Step 5: Present the three concepts**

Render all three saved PNGs, identify their bounded differences, link the prompt record, report corrections and verification, and provide the final commit identifier.
