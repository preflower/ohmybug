# Unrestricted Codex Evidence Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the dedicated Codex evidence-capture turn bind localhost ports and launch browser or Electron acceptance processes with unrestricted host execution.

**Architecture:** Extend the local Codex thread-options wrapper to admit the SDK's existing `danger-full-access` sandbox mode, then use that mode with network enabled only in `CodexAgentAdapter.captureEvidence`. Assessment and Repair keep their current restricted options, while the existing intake-path validation and evidence import pipeline remain unchanged.

**Tech Stack:** TypeScript, `@openai/codex-sdk`, Vitest, pnpm, oxlint

---

### Task 1: Open the Evidence Turn Permission Boundary

**Files:**
- Modify: `packages/agent-codex/test/evidence.test.ts`
- Modify: `packages/agent-codex/src/codex-client.ts`
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`

- [ ] **Step 1: Write the failing Evidence-turn options assertion**

In `packages/agent-codex/test/evidence.test.ts`, add this assertion after the existing `threadId` assertion in the test named `captures evidence on the same native thread without reimplementing`:

```ts
    expect(client.resumes[0]).toMatchObject({
      threadId: "thread-1",
      options: {
        workingDirectory: repairing.projectPath,
        sandboxMode: "danger-full-access",
        networkAccessEnabled: true,
        approvalPolicy: "never",
      },
    });
```

- [ ] **Step 2: Run the focused test and verify the new assertion fails**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/evidence.test.ts
```

Expected: FAIL because the actual Evidence options still contain `sandboxMode: "workspace-write"` and `networkAccessEnabled: false`.

- [ ] **Step 3: Admit the SDK's unrestricted sandbox mode in the local wrapper**

In `packages/agent-codex/src/codex-client.ts`, change `CodexThreadOptions.sandboxMode` to:

```ts
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
```

Do not change `toSdkThreadOptions`; it already forwards `sandboxMode`, `networkAccessEnabled`, and `approvalPolicy` without transformation.

- [ ] **Step 4: Grant unrestricted execution only to `captureEvidence`**

In `packages/agent-codex/src/codex-agent-adapter.ts`, change only the options object passed by `captureEvidence` to:

```ts
      {
        workingDirectory: requireProjectPath(input.issue),
        sandboxMode: "danger-full-access",
        networkAccessEnabled: true,
        approvalPolicy: "never",
      },
```

Leave the Assessment options as `read-only` plus network disabled. Leave the Repair options as `workspace-write` plus network disabled.

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/evidence.test.ts
```

Expected: PASS with one test file passing. The assertion proves the resumed native thread receives unrestricted Evidence options.

- [ ] **Step 6: Commit the permission-boundary change**

```bash
git add packages/agent-codex/src/codex-client.ts packages/agent-codex/src/codex-agent-adapter.ts packages/agent-codex/test/evidence.test.ts
git commit -m "feat(agent): allow unrestricted evidence capture"
```

### Task 2: Verify Restricted Turns and Evidence Validation Remain Intact

**Files:**
- Verify: `packages/agent-codex/test/assessment.test.ts`
- Verify: `packages/agent-codex/test/repair.test.ts`
- Verify: `packages/agent-codex/test/evidence.test.ts`

- [ ] **Step 1: Run Assessment coverage**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/assessment.test.ts
```

Expected: PASS. The existing `starts a native Codex thread with a sanitized assessment prompt` assertion continues to require `sandboxMode: "read-only"`, `networkAccessEnabled: false`, and `approvalPolicy: "never"`.

- [ ] **Step 2: Run Repair and evidence-path coverage**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/repair.test.ts
```

Expected: PASS. The existing continuation assertion continues to require `sandboxMode: "workspace-write"` and `networkAccessEnabled: false`; the unsafe relative-path table continues to reject absolute paths, parent traversal, and empty paths.

- [ ] **Step 3: Run the complete Agent-Codex test suite**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex test
```

Expected: PASS with all `packages/agent-codex` test files and tests passing.

- [ ] **Step 4: Run type checking**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex typecheck
```

Expected: PASS with `tsc --noEmit` exiting successfully. This confirms the local sandbox-mode union matches the installed Codex SDK type.

- [ ] **Step 5: Run targeted lint and diff validation**

Run:

```bash
pnpm exec oxlint packages/agent-codex
git diff --check
```

Expected: both commands exit successfully with no lint or whitespace errors.

- [ ] **Step 6: Confirm the worktree contains only the intended implementation**

Run:

```bash
git status --short
git log -2 --oneline
```

Expected: no uncommitted files from the implementation, and the newest commit is `feat(agent): allow unrestricted evidence capture` followed by the implementation-plan commit.
