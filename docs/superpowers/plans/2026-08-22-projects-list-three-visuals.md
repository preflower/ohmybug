# Projects List Three Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and visually verify three distinct 1536×1024 dark desktop Projects-list mockups that follow the approved Oh My Bug ?! design specification.

**Architecture:** Treat each direction as an independent `ui-mockup` generation with its own prompt file and PNG deliverable. Preserve one shared application-shell contract across all prompts, then validate every result for layout identity, exact labels, representative project data, prohibited visual patterns, and visible differences between A, B, and C.

**Tech Stack:** Built-in ImageGen, Codex local image viewer, Markdown prompt files, PNG assets

---

### Task 1: Persist the three production prompts

**Files:**
- Create: `output/ui-concepts/projects-list-v2-a-engineering-table.prompt.md`
- Create: `output/ui-concepts/projects-list-v2-b-inspector.prompt.md`
- Create: `output/ui-concepts/projects-list-v2-c-ledger.prompt.md`

- [ ] **Step 1: Write Direction A prompt**

Use the `ui-mockup` taxonomy, exact 1536×1024 desktop framing, shared shell invariants, representative project records, engineering-table layout, exact visible labels, and the approved avoid list.

- [ ] **Step 2: Write Direction B prompt**

Repeat the shell and data invariants in full, then specify a 340–380px project list beside a flat read-only project inspector with a contextual `配置项目` action.

- [ ] **Step 3: Write Direction C prompt**

Repeat the shell and data invariants in full, then specify an unboxed two-line repository ledger with separators, a right-side metadata track, and no table frame.

- [ ] **Step 4: Review prompt consistency**

Run:

```bash
rg -n "Use case: ui-mockup|1536×1024|打开项目目录|no watermark" output/ui-concepts/projects-list-v2-*.prompt.md
```

Expected: every prompt contains the taxonomy, canvas, primary action, and watermark prohibition.

### Task 2: Generate independent mockups

**Files:**
- Create: `output/ui-concepts/projects-list-v2-a-engineering-table.png`
- Create: `output/ui-concepts/projects-list-v2-b-inspector.png`
- Create: `output/ui-concepts/projects-list-v2-c-ledger.png`

- [ ] **Step 1: Generate Direction A**

Call built-in ImageGen once with the complete Direction A prompt. Copy the selected built-in output to `output/ui-concepts/projects-list-v2-a-engineering-table.png` without overwriting existing assets.

- [ ] **Step 2: Generate Direction B**

Call built-in ImageGen once with the complete Direction B prompt. Copy the selected built-in output to `output/ui-concepts/projects-list-v2-b-inspector.png` without overwriting existing assets.

- [ ] **Step 3: Generate Direction C**

Call built-in ImageGen once with the complete Direction C prompt. Copy the selected built-in output to `output/ui-concepts/projects-list-v2-c-ledger.png` without overwriting existing assets.

### Task 3: Visual acceptance review

**Files:**
- Inspect: `output/ui-concepts/projects-list-v2-a-engineering-table.png`
- Inspect: `output/ui-concepts/projects-list-v2-b-inspector.png`
- Inspect: `output/ui-concepts/projects-list-v2-c-ledger.png`

- [ ] **Step 1: Verify shared shell**

Open all three images. Confirm the left sidebar, Projects selection, location header, view header, connection state, and two project actions are visibly consistent.

- [ ] **Step 2: Verify direction identity**

Confirm A is a dense aligned table, B is a list plus inspector, and C is an unboxed two-line ledger. Reject any set in which two versions collapse into the same structure.

- [ ] **Step 3: Verify truthfulness and copy**

Confirm the mockups do not invent health scores, charts, issue counts, or build results. Check that the primary labels and project names are legible and correctly spelled.

- [ ] **Step 4: Verify visual constraints**

Confirm the images avoid gradients, glow, glass, oversized cards, ambient decoration, chatbot UI, and watermarks. Confirm the blue-violet accent is limited to actions and selection.

- [ ] **Step 5: Apply one targeted correction when required**

If a result fails one acceptance dimension, issue a single-change ImageGen follow-up that repeats all invariants and corrects only that dimension. Re-open the replacement image and repeat Steps 1–4.

### Task 4: Delivery verification

**Files:**
- Verify: `output/ui-concepts/projects-list-v2-*.png`
- Verify: `output/ui-concepts/projects-list-v2-*.prompt.md`

- [ ] **Step 1: Confirm all six deliverables exist**

Run:

```bash
for f in output/ui-concepts/projects-list-v2-{a-engineering-table,b-inspector,c-ledger}.{png,prompt.md}; do test -s "$f" || exit 1; done
```

Expected: exit code 0.

- [ ] **Step 2: Report final artifacts**

Return clickable paths for the three PNGs, identify A as the recommended implementation direction, state that built-in ImageGen was used, and include the three final prompt-file paths.
