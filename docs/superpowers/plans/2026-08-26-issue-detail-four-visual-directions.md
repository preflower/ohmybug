# Issue Detail Four Visual Directions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, inspect, save, and commit four materially distinct high-fidelity Issue detail page concepts for the two approved layout directions.

**Architecture:** A shared content and visual-system contract keeps the four images comparable. Four separate `ui-mockup` prompts then impose distinct geometry for 1A, 1B, 2A, and 2B; each built-in ImageGen call produces one concept, and each result is inspected before it is copied into the repository.

**Tech Stack:** Built-in ImageGen tool, Codex image viewer, PNG artifacts, Markdown prompt record, Git

---

## File Structure

- Create: `docs/design/issue-detail-four-variants-imagegen-prompts.md` — exact shared contract, four prompts, and validation matrix.
- Create: `docs/design/issue-detail-1a-continuous-document.png` — classic continuous document concept.
- Create: `docs/design/issue-detail-1b-evidence-weighted-document.png` — evidence-weighted continuous document concept.
- Create: `docs/design/issue-detail-2a-split-evidence-desk.png` — side-by-side inspection concept.
- Create: `docs/design/issue-detail-2b-immersive-evidence-desk.png` — stacked immersive inspection concept.
- Read: `docs/superpowers/specs/2026-08-26-issue-detail-four-visual-directions.md` — approved source of truth.

### Task 1: Record the four production prompts

**Files:**
- Create: `docs/design/issue-detail-four-variants-imagegen-prompts.md`

- [ ] **Step 1: Write the shared contract**

Record the shared `ui-mockup` scenario, exact core labels, palette, typography, density, mandatory content, and prohibited effects from the approved specification. Require only the Issue detail page, with no application sidebar, Issue list, external state atlas, marketing frame, or device mockup.

- [ ] **Step 2: Write prompt 1A**

Specify a classic vertical document with compact header, expanded Assessment, branch and Delivery, two-column evidence gallery, permanent 280px metadata/activity rail, and sticky 64px review dock.

- [ ] **Step 3: Write prompt 1B**

Specify a continuous document with a single-line technical header, compact Assessment verdict strip and summaries, evidence before long reasoning, quieter 280px metadata/activity rail, and the same sticky review dock.

- [ ] **Step 4: Write prompt 2A**

Specify a 38/62 split: decision column on the left, large selected evidence plus filmstrip on the right, activity collapsed at the bottom-left, and review controls anchored to the evidence stage.

- [ ] **Step 5: Write prompt 2B**

Specify a compact full-width decision band, large central evidence canvas, vertical evidence thumbnails, right-edge Agent activity drawer trigger, and full-width review dock.

- [ ] **Step 6: Verify prompt separation**

Run:

```bash
rg -n "^## Shared contract|^## Prompt 1A|^## Prompt 1B|^## Prompt 2A|^## Prompt 2B|^## Validation matrix" docs/design/issue-detail-four-variants-imagegen-prompts.md
```

Expected: all six markers are present once.

### Task 2: Generate and save direction 1 variants

**Files:**
- Create: `docs/design/issue-detail-1a-continuous-document.png`
- Create: `docs/design/issue-detail-1b-evidence-weighted-document.png`

- [ ] **Step 1: Generate 1A**

Call the built-in ImageGen tool with the shared contract plus Prompt 1A. Do not pass an output path and do not use the CLI fallback.

- [ ] **Step 2: Inspect 1A**

Open the result at original detail. Confirm classic continuous reading order, expanded Assessment, evidence gallery, permanent metadata rail, and sticky review dock.

- [ ] **Step 3: Save 1A**

Copy the selected generated PNG to `docs/design/issue-detail-1a-continuous-document.png`. If it exists, use the next free versioned filename.

- [ ] **Step 4: Generate 1B**

Call the built-in ImageGen tool with the shared contract plus Prompt 1B as a new image, not an edit of 1A.

- [ ] **Step 5: Inspect 1B**

Confirm a materially denser header, compact Assessment treatment, earlier and larger evidence, quieter metadata rail, and the same decision dock.

- [ ] **Step 6: Save 1B**

Copy the selected generated PNG to `docs/design/issue-detail-1b-evidence-weighted-document.png`, using a versioned sibling if necessary.

### Task 3: Generate and save direction 2 variants

**Files:**
- Create: `docs/design/issue-detail-2a-split-evidence-desk.png`
- Create: `docs/design/issue-detail-2b-immersive-evidence-desk.png`

- [ ] **Step 1: Generate 2A**

Call the built-in ImageGen tool with the shared contract plus Prompt 2A as a new image.

- [ ] **Step 2: Inspect 2A**

Confirm a 38/62 decision/evidence split, one large selected screenshot, evidence filmstrip, compact left activity section, and evidence-linked review controls.

- [ ] **Step 3: Save 2A**

Copy the selected generated PNG to `docs/design/issue-detail-2a-split-evidence-desk.png`, using a versioned sibling if necessary.

- [ ] **Step 4: Generate 2B**

Call the built-in ImageGen tool with the shared contract plus Prompt 2B as a new image.

- [ ] **Step 5: Inspect 2B**

Confirm a full-width top decision band, large central evidence canvas, vertical thumbnail rail, activity drawer trigger, and full-width review dock.

- [ ] **Step 6: Save 2B**

Copy the selected generated PNG to `docs/design/issue-detail-2b-immersive-evidence-desk.png`, using a versioned sibling if necessary.

### Task 4: Compare, verify, and commit

**Files:**
- Create: `docs/design/issue-detail-four-variants-imagegen-prompts.md`
- Create: `docs/design/issue-detail-1a-continuous-document.png`
- Create: `docs/design/issue-detail-1b-evidence-weighted-document.png`
- Create: `docs/design/issue-detail-2a-split-evidence-desk.png`
- Create: `docs/design/issue-detail-2b-immersive-evidence-desk.png`

- [ ] **Step 1: Compare all four images**

Inspect all four at original detail. Verify each is only an Issue detail page, uses the same Delivery review scenario, and is materially distinguishable by geometry rather than color or decoration.

- [ ] **Step 2: Verify files and repository hygiene**

Run:

```bash
file docs/design/issue-detail-1a-continuous-document.png docs/design/issue-detail-1b-evidence-weighted-document.png docs/design/issue-detail-2a-split-evidence-desk.png docs/design/issue-detail-2b-immersive-evidence-desk.png
git diff --check
git status --short
```

Expected: four PNG files; no whitespace errors; only the five planned artifacts are uncommitted.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: exit code 0. The task changes only documentation and raster assets, but the full repository suite remains the completion gate.

- [ ] **Step 4: Commit the four concepts**

Run:

```bash
git add docs/design/issue-detail-four-variants-imagegen-prompts.md docs/design/issue-detail-1a-continuous-document.png docs/design/issue-detail-1b-evidence-weighted-document.png docs/design/issue-detail-2a-split-evidence-desk.png docs/design/issue-detail-2b-immersive-evidence-desk.png
git commit -m "docs: add issue detail visual variants"
```

- [ ] **Step 5: Present all four outputs**

Render the four saved images with their direction labels. Report the absolute paths, prompt-record path, built-in ImageGen mode, any targeted corrections, verification command, and final commit identifier.
