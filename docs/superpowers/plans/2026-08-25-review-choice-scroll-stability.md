# Review Choice Scroll Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Issue detail viewport stable when an Assessment processing choice changes.

**Architecture:** Separate stable review context from choice-dependent response fields. Keep the context above the radio group and place response fields immediately after it so conditional layout changes cannot move the selected control.

**Tech Stack:** React 19, TypeScript, Base UI RadioGroup, Vitest, Testing Library, Playwright

---

### Task 1: Lock the layout contract with a failing test

**Files:**
- Modify: `apps/desktop/test/web/review-panel.test.tsx`

- [ ] Add an Assessment review fixture containing implement, duplicate, and reassess choices.
- [ ] Assert the title input follows the “选择处理方式” radio group in document order.
- [ ] Switch to duplicate and reassess, asserting the selected response field changes without moving ahead of the group.
- [ ] Run `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/review-panel.test.tsx --config vitest.config.ts` and confirm the document-order assertion fails against the current implementation.

### Task 2: Move only choice-dependent fields below the choices

**Files:**
- Modify: `apps/desktop/src/web/issues/review-renderers.tsx`
- Modify: `apps/desktop/src/web/issues/review-panel.tsx`

- [ ] Keep verdict and permission copy in `ReviewRenderer`.
- [ ] Add `ReviewResponseFields` for the Assessment title and duplicate-Issue inputs.
- [ ] Render `ReviewResponseFields` after the radio group and before general feedback.
- [ ] Run the focused test and confirm it passes.

### Task 3: Verify the production surface

**Files:**
- Evidence only: `.oh-my-bug-tmp-evidence-X74Op9/review-choice-scroll-stability.png`

- [ ] Run the Desktop review tests, typecheck, lint, build, and full test suite.
- [ ] Launch the browser-development application at a deterministic viewport.
- [ ] Scroll the Assessment review into position, switch processing choices, and verify the radio group bounding position is unchanged.
- [ ] Capture the actual rendered acceptance state under the required evidence directory.
- [ ] Review the final diff and commit only the intended source, tests, and design/plan files.
