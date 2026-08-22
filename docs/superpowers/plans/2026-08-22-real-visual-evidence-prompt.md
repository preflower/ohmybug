# Real Visual Evidence Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require every Codex Repair turn to submit a direct capture of a real acceptance run and forbid generated or illustrative substitutes.

**Architecture:** Keep the change entirely inside the Codex adapter's Repair prompt. Lock the behavioral contract with a focused adapter test that inspects the exact prompt delivered to the Codex thread; do not change evidence schemas, storage, inspection, or workflow behavior.

**Tech Stack:** TypeScript, Vitest, pnpm workspace

---

### Task 1: Add the real-acceptance evidence contract

**Files:**
- Modify: `packages/agent-codex/test/repair.test.ts:80-83`
- Modify: `packages/agent-codex/src/prompts.ts:15-27`

- [ ] **Step 1: Write the failing Prompt contract assertions**

In the test named `resumes the same native thread and returns path-only visual evidence`, add these assertions after the existing Prompt assertions:

```ts
expect(client.prompts[0]).toContain("directly capture a real acceptance run");
expect(client.prompts[0]).toContain(
  "the running application, an actual API request and response, or an executed benchmark",
);
expect(client.prompts[0]).toContain(
  "Never submit generated, reconstructed, mocked, or illustrative visuals.",
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/repair.test.ts
```

Expected: the existing Repair tests run, and the modified test fails because the current Prompt does not contain `directly capture a real acceptance run`.

- [ ] **Step 3: Add the minimal Repair Prompt instruction**

In `repairPrompt`, place this single instruction immediately after the evidence-directory instruction:

```ts
"Visual evidence must directly capture a real acceptance run that proves the change, such as the running application, an actual API request and response, or an executed benchmark. Never submit generated, reconstructed, mocked, or illustrative visuals.",
```

The surrounding Prompt remains unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/repair.test.ts
```

Expected: `packages/agent-codex/test/repair.test.ts` passes with no failures.

- [ ] **Step 5: Run package regression tests and type checking**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex test
pnpm --filter @oh-my-bug/agent-codex typecheck
```

Expected: all `@oh-my-bug/agent-codex` tests pass and TypeScript reports no errors.

- [ ] **Step 6: Review the scoped diff**

Run:

```bash
git diff -- packages/agent-codex/src/prompts.ts packages/agent-codex/test/repair.test.ts
```

Expected: the diff contains only the three Prompt assertions and the single Prompt instruction.

- [ ] **Step 7: Commit the implementation**

```bash
git add packages/agent-codex/src/prompts.ts packages/agent-codex/test/repair.test.ts
git commit -m "fix: require real visual acceptance evidence"
```
