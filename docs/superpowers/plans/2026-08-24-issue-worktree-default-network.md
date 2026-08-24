# Issue Worktree Default Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Issue Repair worktree network access by default without changing user-level Codex configuration or broadening Assessment and host-execution permissions.

**Architecture:** Add one stage-capability helper in `agent-codex` and use it for both SDK thread options and prompt capability disclosure. Repair's baseline includes `NETWORK_ACCESS`, Assessment remains read-only/offline, and Evidence retains its current unrestricted baseline. Adapter tests exercise the public Repair behavior so implementation and Agent instructions cannot drift apart.

**Tech Stack:** TypeScript 6, Vitest 4, `@openai/codex-sdk`, pnpm workspaces

---

## File and Responsibility Map

- Create `packages/agent-codex/src/stage-capabilities.ts`: calculate capabilities available from a stage baseline plus persisted Issue grants.
- Modify `packages/agent-codex/src/codex-agent-adapter.ts`: use the shared calculation for Repair SDK options and capability-request validation.
- Modify `packages/agent-codex/src/prompts.ts`: report the same effective stage capabilities to Codex.
- Create `packages/agent-codex/test/repair-network.test.ts`: regression coverage for default Repair network access and redundant network requests.
- Modify `packages/agent-codex/test/repair.test.ts`: update the pre-existing Repair option assertion from the old offline default to the new online default while preserving unrelated local edits.

### Task 1: Define the Repair Network Contract with Failing Tests

**Files:**
- Create: `packages/agent-codex/test/repair-network.test.ts`

- [ ] **Step 1: Write the failing behavior tests**

```ts
import { describe, expect, it } from "vitest";

import type { Assessment, RepairInput } from "@oh-my-bug/core";

import { CodexAgentAdapter } from "../src/codex-agent-adapter.js";
import { bindSession, FixtureClient, issue, MemorySessions, project } from "./helpers.js";

const assessment: Assessment = {
  revision: 1,
  contentHash: "a".repeat(64),
  verdict: "BUG",
  suggestedTitle: "Checkout fails",
  reasoning: "Reproduced",
  rootCause: "Null cart",
  solution: "Handle expiry",
};

function input(): RepairInput {
  return {
    issue: issue({ status: "REPAIRING", assessment, repair: { iteration: 1 } }),
    project,
    assessment,
    evidenceDirectory: "/private/intake/issue-1/1",
  };
}

describe("Codex Repair network baseline", () => {
  it("enables network inside the default workspace-write Repair sandbox", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-network", "thread-network");
    const client = new FixtureClient([
      JSON.stringify({ summary: "Implemented", evidence: [] }),
    ]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await adapter.repair(
      { agent: "codex", sessionId: "logical-network" },
      input(),
    );

    expect(client.resumes[0]?.options).toMatchObject({
      sandboxMode: "workspace-write",
      networkAccessEnabled: true,
    });
    expect(client.prompts[0]).toContain(
      'Capabilities already available in this stage: ["NETWORK_ACCESS"]',
    );
  });

  it("continues instead of pausing for a redundant Repair network request", async () => {
    const sessions = new MemorySessions();
    await bindSession(sessions, "logical-redundant", "thread-redundant");
    const client = new FixtureClient([
      JSON.stringify({
        outcome: "CAPABILITY_REQUIRED",
        capabilities: ["NETWORK_ACCESS"],
        reason: "Install dependencies",
        blockedCommand: "pnpm install",
        requestedBy: null,
      }),
      JSON.stringify({ summary: "Implemented", evidence: [] }),
    ]);
    const adapter = new CodexAgentAdapter({ client, sessions });

    await expect(adapter.repair(
      { agent: "codex", sessionId: "logical-redundant" },
      input(),
    )).resolves.toEqual({ summary: "Implemented", evidence: [] });
    expect(client.prompts).toHaveLength(2);
    expect(client.prompts[1]).toContain("already available in this stage");
  });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/repair-network.test.ts
```

Expected: both tests fail for the intended reasons—the default option is `false`, the prompt omits Repair's network baseline, and the redundant request raises `AGENT_CAPABILITY_REQUIRED`.

### Task 2: Centralize Stage Capabilities and Enable Repair Networking

**Files:**
- Create: `packages/agent-codex/src/stage-capabilities.ts`
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`
- Modify: `packages/agent-codex/src/prompts.ts`
- Modify: `packages/agent-codex/test/repair.test.ts`
- Test: `packages/agent-codex/test/repair-network.test.ts`

- [ ] **Step 1: Add the shared stage-capability calculation**

Create `packages/agent-codex/src/stage-capabilities.ts`:

```ts
import type { AgentCapability, Issue } from "@oh-my-bug/core";

export type CodexAgentStage = "ASSESSMENT" | "REPAIR" | "EVIDENCE";

export function effectiveStageCapabilities(
  issue: Issue,
  stage: CodexAgentStage,
): Set<AgentCapability> {
  const available = new Set(
    issue.capabilityGrants?.map((grant) => grant.capability),
  );
  if (stage === "REPAIR") available.add("NETWORK_ACCESS");
  if (stage === "EVIDENCE") {
    available.add("HOST_EXECUTION");
    available.add("NETWORK_ACCESS");
  }
  return available;
}
```

- [ ] **Step 2: Make Adapter permissions stage-aware**

In `packages/agent-codex/src/codex-agent-adapter.ts`, import the shared helper and type:

```ts
import {
  effectiveStageCapabilities,
  type CodexAgentStage,
} from "./stage-capabilities.js";
```

Use `CodexAgentStage` for `CodexActivity.stage`. Pass the stage into both calls to `effectiveTurnOptions`, and change Repair's default network option:

```ts
...effectiveTurnOptions(input.issue, "ASSESSMENT", {
  sandboxMode: "read-only",
  networkAccessEnabled: false,
}),
```

```ts
...effectiveTurnOptions(input.issue, "REPAIR", {
  sandboxMode: "workspace-write",
  networkAccessEnabled: true,
}),
```

Replace the private capability calculation with the shared helper in request validation:

```ts
const available = effectiveStageCapabilities(issue, stage);
```

Update the effective option helper so it receives the real stage:

```ts
function effectiveTurnOptions(
  issue: Issue,
  stage: CodexAgentStage,
  defaults: Pick<CodexThreadOptions, "sandboxMode" | "networkAccessEnabled">,
): Pick<CodexThreadOptions, "sandboxMode" | "networkAccessEnabled"> {
  const available = effectiveStageCapabilities(issue, stage);
  return {
    sandboxMode: available.has("HOST_EXECUTION")
      ? "danger-full-access"
      : defaults.sandboxMode,
    networkAccessEnabled: available.has("NETWORK_ACCESS")
      ? true
      : defaults.networkAccessEnabled,
  };
}
```

Delete the old local `effectiveCapabilities` function.

- [ ] **Step 3: Make prompts use the same stage baseline**

In `packages/agent-codex/src/prompts.ts`, import:

```ts
import {
  effectiveStageCapabilities,
  type CodexAgentStage,
} from "./stage-capabilities.js";
```

Change `capabilityPrompt` to use the shared type and calculation while preserving its existing instructions:

```ts
function capabilityPrompt(issue: Issue, stage: CodexAgentStage): string[] {
  const available = effectiveStageCapabilities(issue, stage);
  return [
    `Capabilities already available in this stage: ${JSON.stringify([...available])}`,
    "Use a practical lower-privilege alternative first.",
    "If a project Skill explicitly requires host or network access, or a sandbox, permission, or network denial leaves no practical lower-privilege alternative, stop retrying and return the CAPABILITY_REQUIRED structured outcome.",
    "Request HOST_EXECUTION for unrestricted host execution and NETWORK_ACCESS for network access. Do not request a capability that is already available.",
  ];
}
```

- [ ] **Step 4: Update the old Repair default assertion**

In the existing `resumes the same native thread and returns path-only visual evidence` test in `packages/agent-codex/test/repair.test.ts`, change only:

```ts
networkAccessEnabled: false,
```

to:

```ts
networkAccessEnabled: true,
```

Preserve every other uncommitted assertion in that file.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/repair-network.test.ts
```

Expected: 1 test file passes, 2 tests pass, 0 failures.

- [ ] **Step 6: Run the complete package tests and typecheck**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex test
pnpm --filter @oh-my-bug/agent-codex typecheck
```

Expected: every `agent-codex` test passes and TypeScript exits with code 0.

### Task 3: Repository Verification and Task-Owned Commit

**Files:**
- Verify all files from Tasks 1–2.

- [ ] **Step 1: Run repository checks**

Run:

```bash
pnpm typecheck
pnpm test
pnpm lint
```

Expected: all commands exit with code 0. If an unrelated pre-existing failure occurs, record the exact command and failure instead of masking it.

- [ ] **Step 2: Inspect the final diff and whitespace**

Run:

```bash
git diff --check
git status --short
git diff -- packages/agent-codex/src/stage-capabilities.ts packages/agent-codex/src/codex-agent-adapter.ts packages/agent-codex/src/prompts.ts packages/agent-codex/test/repair-network.test.ts packages/agent-codex/test/repair.test.ts
```

Expected: no whitespace errors; the diff contains only the new Repair network baseline plus the user's pre-existing capability-envelope changes.

- [ ] **Step 3: Commit only task-owned changes**

The implementation runs in an isolated worktree, so stage the task-owned files and inspect the cached diff before committing:

```bash
git add packages/agent-codex/src/stage-capabilities.ts packages/agent-codex/src/codex-agent-adapter.ts packages/agent-codex/test/repair-network.test.ts
git add packages/agent-codex/src/prompts.ts packages/agent-codex/test/repair.test.ts
git diff --cached --check
git diff --cached
git commit -m "feat(agent): enable network in repair worktrees"
```

Expected: the cached diff contains only task-owned hunks; the commit succeeds without staging any unrelated working-tree changes.
