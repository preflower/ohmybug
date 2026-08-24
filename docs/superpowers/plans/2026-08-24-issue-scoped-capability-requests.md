# Issue-Scoped Capability Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pause an Assessment or Repair turn when the Agent explicitly requests host or network capability, let the user grant that capability for the current Issue and continue the same session, while preserving Evidence's unrestricted defaults and preventing cleanup errors from replacing completed results.

**Architecture:** Add capability grants and a recoverable `PERMISSION_REQUIRED` state to the Core Issue model. Codex stage schemas expose a shared `CAPABILITY_REQUIRED` output branch; the Adapter turns that branch into typed control flow and calculates Assessment/Repair permissions from persisted Issue grants. Runtime persists the pause and resumes the original operation after an explicit protocol command, while Desktop presents one truthful inline approval surface. Cleanup failures become observational Agent activity rather than primary turn failures.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, SQLite/better-sqlite3, React 19, Electron IPC, `@openai/codex-sdk`, pnpm

---

## File and Responsibility Map

- `packages/core/src/agent/types.ts`: shared capability, requester, and grant vocabulary.
- `packages/core/src/agent/adapter.ts`: typed capability-required control signal and `CAPABILITY_GRANTED` continuation.
- `packages/core/src/issue/types.ts`: persisted pending request and `PERMISSION_REQUIRED` status.
- `packages/core/src/issue/schema.ts`: backward-compatible validation for optional grant/request fields.
- `packages/core/src/issue/workflow.ts`: legal pause, cancellation, terminal grant revocation.
- `packages/core/src/issue/results.ts`: pure reducers that pause and grant a capability request.
- `packages/agent-codex/src/output-schemas.ts`: shared structured-output request branch and parser.
- `packages/agent-codex/src/prompts.ts`: request rules, current grants, and grant-continuation instructions.
- `packages/agent-codex/src/codex-agent-adapter.ts`: request control flow, one corrective continuation, and effective permission selection.
- `packages/agent-codex/src/codex-client.ts`: cleanup-failure event that preserves completed stream output.
- `apps/runtime/src/orchestration/capability-request.ts`: bounded, redacted Runtime event payloads.
- `apps/runtime/src/orchestration/worker.ts`: pause Agent-backed operations and resume with grant continuation.
- `apps/runtime/src/orchestration/commands.ts`: optimistic `grantIssueCapabilities` command.
- `apps/runtime/src/runtime.ts`, `apps/runtime/src/service.ts`, `apps/runtime/src/protocol/*`: renderer-safe grant operation.
- `apps/desktop/src/electron/desktop-api.ts`, `apps/desktop/src/web/api/*`: bridge and transport method.
- `apps/desktop/src/web/issues/capability-request-panel.tsx`: focused inline grant/cancel UI.
- `apps/desktop/src/web/issues/issue-detail.tsx`, `issue-status.tsx`, `apps/desktop/src/web/app.tsx`: state wiring and status surfaces.
- `apps/desktop/src/web/styles/global.css`: permission-card layout only; no unrelated visual restyling.

### Task 1: Define Core Capability State and Pure Reducers

**Files:**
- Modify: `packages/core/src/agent/types.ts`
- Modify: `packages/core/src/agent/adapter.ts`
- Modify: `packages/core/src/issue/types.ts`
- Modify: `packages/core/src/issue/schema.ts`
- Modify: `packages/core/src/issue/workflow.ts`
- Modify: `packages/core/src/issue/results.ts`
- Modify: `packages/core/test/agent/adapter.test.ts`
- Modify: `packages/core/test/issue/schema.test.ts`
- Modify: `packages/core/test/issue/workflow.test.ts`
- Modify: `packages/core/test/issue/results.test.ts`

- [ ] **Step 1: Write failing Core contract and schema tests**

Add tests that define the persisted shape and continuation contract:

```ts
import {
  AgentCapabilityRequiredError,
  isAgentCapabilityRequiredError,
} from "../../src/agent/adapter.js";

it("carries a structured capability request as non-failure control flow", () => {
  const error = new AgentCapabilityRequiredError({
    capabilities: ["HOST_EXECUTION", "NETWORK_ACCESS"],
    reason: "Launch Electron acceptance",
    blockedCommand: "pnpm test:e2e:electron",
    requestedBy: { type: "SKILL", id: "implement-ui-design" },
  });
  expect(isAgentCapabilityRequiredError(error)).toBe(true);
  expect(error.code).toBe("AGENT_CAPABILITY_REQUIRED");
});

it("accepts a permission-blocked Issue and a capability-granted continuation", () => {
  expect(issueSchema.parse({
    ...issue,
    status: "PERMISSION_REQUIRED",
    capabilityGrants: [{
      capability: "NETWORK_ACCESS",
      requestId: "request-old",
      grantedAt: "2026-08-24T08:00:00.000Z",
    }],
    pendingCapabilityRequest: {
      id: "request-1",
      operation: "REPAIR",
      stage: "REPAIR",
      resumeStatus: "REPAIRING",
      capabilities: ["HOST_EXECUTION"],
      reason: "Launch Electron acceptance",
      requestedAt: "2026-08-24T08:01:00.000Z",
    },
  })).toMatchObject({ status: "PERMISSION_REQUIRED" });

  const continuation: AgentContinuation = {
    reason: "CAPABILITY_GRANTED",
    requestId: "request-1",
    capabilities: ["HOST_EXECUTION"],
  };
  expect(continuation.reason).toBe("CAPABILITY_GRANTED");
});
```

- [ ] **Step 2: Write failing reducer and workflow tests**

Cover all three Agent-backed active states, exact resume data, retry-budget preservation, and terminal cleanup:

```ts
it.each([
  ["ASSESSING", "ASSESSMENT", "ASSESS"],
  ["REPAIRING", "REPAIR", "REPAIR"],
  ["EVIDENCE_CAPTURE", "EVIDENCE", "CAPTURE_EVIDENCE"],
] as const)("pauses %s for a capability request", (status, stage, operation) => {
  const current = issueAt(status);
  const paused = recordCapabilityRequest(current, {
    id: "request-1",
    stage,
    operation,
    capabilities: ["HOST_EXECUTION"],
    reason: "Launch the application",
    requestedAt: now,
  }, now);

  expect(paused).toMatchObject({
    status: "PERMISSION_REQUIRED",
    pendingCapabilityRequest: {
      id: "request-1",
      resumeStatus: status,
      stage,
      operation,
    },
  });
  expect(paused.repair?.evidenceRetries).toBe(current.repair?.evidenceRetries);
  expect(paused.lastFailure).toBeUndefined();
});

it("grants only the active request and restores its exact stage", () => {
  const paused = recordCapabilityRequest(issueAt("REPAIRING"), request, now);
  const resumed = grantCapabilityRequest(paused, "request-1", later);
  expect(resumed).toMatchObject({
    status: "REPAIRING",
    capabilityGrants: [{
      capability: "HOST_EXECUTION",
      requestId: "request-1",
      grantedAt: later,
    }],
  });
  expect(resumed.pendingCapabilityRequest).toBeUndefined();
  expect(() => grantCapabilityRequest(paused, "stale", later))
    .toThrow("CAPABILITY_REQUEST_STALE");
});

const capabilityGrants = [{
  capability: "HOST_EXECUTION" as const,
  requestId: "request-1",
  grantedAt: now,
}];

it("revokes grants when the user cancels a permission-blocked Issue", () => {
  const transitioned = transitionIssue({
    ...issueAt("PERMISSION_REQUIRED"),
    capabilityGrants,
  }, "CANCEL", now);
  expect(transitioned.status).toBe("CANCELED");
  expect(transitioned.capabilityGrants).toBeUndefined();
  expect(transitioned.pendingCapabilityRequest).toBeUndefined();
});

it("revokes grants when an approved delivery completes", () => {
  const transitioned = transitionIssue({
    ...issueAt("APPROVED"),
    capabilityGrants,
  }, "COMPLETE_DELIVERY", now);
  expect(transitioned.status).toBe("COMPLETED");
  expect(transitioned.capabilityGrants).toBeUndefined();
});

it("revokes grants when a non-bug assessment closes the Issue", () => {
  const notABugAssessment = {
    ...assessment,
    contentHash: "c".repeat(64),
    verdict: "NOT_A_BUG" as const,
  };
  const transitioned = confirmAssessmentResolution({
    ...issueAt("ASSESSMENT_REVIEW"),
    assessment: notABugAssessment,
    capabilityGrants,
  }, {
    assessmentRevision: notABugAssessment.revision,
    assessmentContentHash: notABugAssessment.contentHash,
    resolution: "NOT_A_BUG",
  }, now);
  expect(transitioned.status).toBe("CLOSED");
  expect(transitioned.capabilityGrants).toBeUndefined();
});
```

- [ ] **Step 3: Run the focused Core tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/core exec vitest run \
  test/agent/adapter.test.ts \
  test/issue/schema.test.ts \
  test/issue/workflow.test.ts \
  test/issue/results.test.ts
```

Expected: FAIL because the capability types, error, status, schemas, and reducers do not exist.

- [ ] **Step 4: Add shared capability and continuation types**

Add to `packages/core/src/agent/types.ts`:

```ts
export type AgentCapability = "HOST_EXECUTION" | "NETWORK_ACCESS";

export interface AgentCapabilityRequester {
  type: "AGENT" | "SKILL";
  id?: string;
}

export interface AgentCapabilityRequest {
  capabilities: AgentCapability[];
  reason: string;
  blockedCommand?: string;
  requestedBy?: AgentCapabilityRequester;
}

export interface CapabilityGrant {
  capability: AgentCapability;
  requestId: string;
  grantedAt: string;
}
```

Replace `AgentContinuation` in `packages/core/src/agent/adapter.ts` with:

```ts
export type AgentContinuation =
  | { reason: "RUNTIME_INTERRUPTED"; previousAttemptId?: string }
  | {
      reason: "CAPABILITY_GRANTED";
      requestId: string;
      capabilities: AgentCapability[];
    };

export class AgentCapabilityRequiredError extends Error {
  readonly code = "AGENT_CAPABILITY_REQUIRED" as const;

  constructor(readonly request: AgentCapabilityRequest) {
    super("AGENT_CAPABILITY_REQUIRED");
    this.name = "AgentCapabilityRequiredError";
  }
}

export function isAgentCapabilityRequiredError(
  value: unknown,
): value is AgentCapabilityRequiredError {
  return value instanceof AgentCapabilityRequiredError;
}
```

- [ ] **Step 5: Add persisted Issue fields and validation**

Add to `packages/core/src/issue/types.ts`:

```ts
export interface PendingCapabilityRequest extends AgentCapabilityRequest {
  id: string;
  operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE";
  stage: "ASSESSMENT" | "REPAIR" | "EVIDENCE";
  resumeStatus: "ASSESSING" | "REPAIRING" | "EVIDENCE_CAPTURE";
  requestedAt: string;
}
```

Add `"PERMISSION_REQUIRED"` to `IssueStatus` and add these optional fields to `Issue`:

```ts
capabilityGrants?: CapabilityGrant[];
pendingCapabilityRequest?: PendingCapabilityRequest;
```

In `packages/core/src/issue/schema.ts`, define strict reusable schemas and add them to `issueSchema`:

```ts
const agentCapabilitySchema = z.enum(["HOST_EXECUTION", "NETWORK_ACCESS"]);
const capabilityRequesterSchema = z.object({
  type: z.enum(["AGENT", "SKILL"]),
  id: z.string().trim().min(1).max(200).optional(),
}).strict();

capabilityGrants: z.array(z.object({
  capability: agentCapabilitySchema,
  requestId: z.string().trim().min(1),
  grantedAt: z.iso.datetime(),
}).strict()).refine(
  (grants) => new Set(grants.map((grant) => grant.capability)).size === grants.length,
  "CAPABILITY_GRANT_DUPLICATE",
).optional(),
pendingCapabilityRequest: z.object({
  id: z.string().trim().min(1),
  operation: z.enum(["ASSESS", "REPAIR", "CAPTURE_EVIDENCE"]),
  stage: z.enum(["ASSESSMENT", "REPAIR", "EVIDENCE"]),
  resumeStatus: z.enum(["ASSESSING", "REPAIRING", "EVIDENCE_CAPTURE"]),
  capabilities: z.array(agentCapabilitySchema).min(1).max(2).refine(
    (items) => new Set(items).size === items.length,
    "AGENT_CAPABILITY_DUPLICATE",
  ),
  reason: z.string().trim().min(1).max(4_000),
  blockedCommand: z.string().trim().min(1).max(2_000).optional(),
  requestedBy: capabilityRequesterSchema.optional(),
  requestedAt: z.iso.datetime(),
}).strict().optional(),
```

- [ ] **Step 6: Implement pause, grant, and terminal revocation reducers**

Add `PERMISSION_REQUIRED: { CANCEL: "CANCELED" }` to the workflow table. Permit `CANCEL` from the new status and clear grant/request fields whenever the next status is terminal:

```ts
const terminalStatuses = new Set<IssueStatus>(["COMPLETED", "CLOSED", "CANCELED"]);

if (terminalStatuses.has(nextIssue.status)) {
  delete nextIssue.capabilityGrants;
  delete nextIssue.pendingCapabilityRequest;
}
```

Add to `packages/core/src/issue/results.ts`:

```ts
const resumeStatusByOperation = {
  ASSESS: "ASSESSING",
  REPAIR: "REPAIRING",
  CAPTURE_EVIDENCE: "EVIDENCE_CAPTURE",
} as const;

export function recordCapabilityRequest(
  issue: Issue,
  request: Omit<PendingCapabilityRequest, "resumeStatus">,
  now: string,
): Issue {
  const expectedStatus = resumeStatusByOperation[request.operation];
  if (issue.status !== expectedStatus) throw new Error("CAPABILITY_REQUEST_STAGE_MISMATCH");
  if (request.stage !== (request.operation === "ASSESS"
    ? "ASSESSMENT"
    : request.operation === "REPAIR" ? "REPAIR" : "EVIDENCE")) {
    throw new Error("CAPABILITY_REQUEST_STAGE_MISMATCH");
  }
  const alreadyGranted = new Set(issue.capabilityGrants?.map((grant) => grant.capability));
  const capabilities = [...new Set(request.capabilities)]
    .filter((capability) => !alreadyGranted.has(capability));
  if (capabilities.length === 0) throw new Error("CAPABILITY_ALREADY_GRANTED");
  return {
    ...issue,
    status: "PERMISSION_REQUIRED",
    pendingCapabilityRequest: {
      ...request,
      capabilities,
      resumeStatus: expectedStatus,
    },
    lastFailure: undefined,
    revision: issue.revision + 1,
    updatedAt: now,
  };
}

export function grantCapabilityRequest(
  issue: Issue,
  requestId: string,
  now: string,
): Issue {
  const request = issue.pendingCapabilityRequest;
  if (issue.status !== "PERMISSION_REQUIRED" || !request) {
    throw new Error("CAPABILITY_REQUEST_NOT_AVAILABLE");
  }
  if (request.id !== requestId) throw new Error("CAPABILITY_REQUEST_STALE");
  const grants = new Map(issue.capabilityGrants?.map((grant) => [grant.capability, grant]));
  for (const capability of request.capabilities) {
    grants.set(capability, { capability, requestId, grantedAt: now });
  }
  return {
    ...issue,
    status: request.resumeStatus,
    capabilityGrants: [...grants.values()],
    pendingCapabilityRequest: undefined,
    revision: issue.revision + 1,
    updatedAt: now,
  };
}
```

- [ ] **Step 7: Run Core tests and verify GREEN**

Run the command from Step 3.

Expected: all focused Core tests PASS.

- [ ] **Step 8: Commit the Core model**

```bash
git add packages/core/src/agent packages/core/src/issue packages/core/test/agent packages/core/test/issue
git commit -m "feat(core): model issue-scoped capability grants"
```

### Task 2: Add the Structured Capability Request Output

**Files:**
- Modify: `packages/agent-codex/src/output-schemas.ts`
- Modify: `packages/agent-codex/src/prompts.ts`
- Modify: `packages/agent-codex/test/assessment.test.ts`
- Modify: `packages/agent-codex/test/repair.test.ts`
- Modify: `packages/agent-codex/test/evidence.test.ts`

- [ ] **Step 1: Write failing schema and prompt tests**

Add one parser test per stage plus shared prompt assertions:

```ts
const request = {
  outcome: "CAPABILITY_REQUIRED",
  capabilities: ["HOST_EXECUTION", "NETWORK_ACCESS"],
  reason: "Launch Electron acceptance",
  blockedCommand: "pnpm test:e2e:electron",
  requestedBy: { type: "SKILL", id: "implement-ui-design" },
};

it.each([
  assessmentOutputSchema,
  repairOutputSchema,
  evidenceOutputSchema,
])("accepts the shared capability request branch", (schema) => {
  expect(schema.anyOf).toHaveLength(2);
  expect(parseCapabilityRequiredOutput(request)).toEqual({
    capabilities: ["HOST_EXECUTION", "NETWORK_ACCESS"],
    reason: "Launch Electron acceptance",
    blockedCommand: "pnpm test:e2e:electron",
    requestedBy: { type: "SKILL", id: "implement-ui-design" },
  });
  expect(() => parseCapabilityRequiredOutput({ ...request, capabilities: ["ROOT"] }))
    .toThrow("AGENT_CAPABILITY_INVALID");
  expect(() => parseCapabilityRequiredOutput({ ...request, capabilities: [] }))
    .toThrow("AGENT_CAPABILITY_REQUIRED");
  expect(() => parseCapabilityRequiredOutput({ ...request, reason: "   " }))
    .toThrow("AGENT_CAPABILITY_REASON_REQUIRED");
});

it("tells Repair how to request capabilities and includes current grants", () => {
  const inputWithNetworkGrant = {
    ...repairInput,
    issue: issue({
      capabilityGrants: [{
        capability: "NETWORK_ACCESS",
        requestId: "request-network",
        grantedAt: "2026-08-24T08:00:00.000Z",
      }],
    }),
  };
  const prompt = repairPrompt(inputWithNetworkGrant);
  expect(prompt).toContain("CAPABILITY_REQUIRED");
  expect(prompt).toContain("try a lower-privilege alternative");
  expect(prompt).toContain('"NETWORK_ACCESS"');
  expect(prompt).toContain("Do not request a capability that is already granted");
});
```

- [ ] **Step 2: Run Agent output tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run \
  test/assessment.test.ts test/repair.test.ts test/evidence.test.ts
```

Expected: FAIL because `anyOf`, `parseCapabilityRequiredOutput`, and capability instructions are absent.

- [ ] **Step 3: Define the shared JSON Schema branch**

Keep normal result shapes backward-compatible by exporting each existing object as a result schema, then wrap it with `anyOf`:

```ts
const capabilityRequiredOutputSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["CAPABILITY_REQUIRED"] },
    capabilities: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
      items: { type: "string", enum: ["HOST_EXECUTION", "NETWORK_ACCESS"] },
    },
    reason: { type: "string", minLength: 1, maxLength: 4_000 },
    blockedCommand: { type: ["string", "null"], maxLength: 2_000 },
    requestedBy: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["AGENT", "SKILL"] },
            id: { type: ["string", "null"], maxLength: 200 },
          },
          required: ["type", "id"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ["outcome", "capabilities", "reason", "blockedCommand", "requestedBy"],
  additionalProperties: false,
} as const;

export const assessmentOutputSchema = {
  anyOf: [assessmentResultOutputSchema, capabilityRequiredOutputSchema],
} as const;
export const repairOutputSchema = {
  anyOf: [repairResultOutputSchema, capabilityRequiredOutputSchema],
} as const;
export const evidenceOutputSchema = {
  anyOf: [evidenceResultOutputSchema, capabilityRequiredOutputSchema],
} as const;
```

- [ ] **Step 4: Implement strict capability-request parsing**

Add:

```ts
export function parseCapabilityRequiredOutput(
  value: unknown,
): AgentCapabilityRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.outcome !== "CAPABILITY_REQUIRED") return undefined;
  const object = strictObject(value, [
    "outcome", "capabilities", "reason", "blockedCommand", "requestedBy",
  ]);
  if (!Array.isArray(object.capabilities) || object.capabilities.length === 0) {
    throw new Error("AGENT_CAPABILITY_REQUIRED");
  }
  const capabilities = [...new Set(object.capabilities.map((entry) => {
    if (entry !== "HOST_EXECUTION" && entry !== "NETWORK_ACCESS") {
      throw new Error("AGENT_CAPABILITY_INVALID");
    }
    return entry;
  }))];
  return {
    capabilities,
    reason: boundedString(object.reason, 4_000, "AGENT_CAPABILITY_REASON_REQUIRED"),
    ...optionalBoundedString(object.blockedCommand, "blockedCommand", 2_000),
    ...parseRequester(object.requestedBy),
  };
}
```

The normal `parseAssessmentOutput`, `parseRepairOutput`, and `parseEvidenceOutput` continue to parse only normal results; the Adapter checks the shared request parser before calling them.

- [ ] **Step 5: Add common request and grant Prompt text**

Add a helper used by all three prompts:

```ts
function capabilityPrompt(
  issue: Issue,
  stage: "ASSESSMENT" | "REPAIR" | "EVIDENCE",
): string[] {
  const available = new Set(issue.capabilityGrants?.map((grant) => grant.capability));
  if (stage === "EVIDENCE") {
    available.add("HOST_EXECUTION");
    available.add("NETWORK_ACCESS");
  }
  return [
    `Capabilities already available in this stage: ${JSON.stringify([...available])}`,
    "Use a practical lower-privilege alternative first.",
    "If a project Skill explicitly requires host or network access, or a sandbox/permission/network denial leaves no practical alternative, stop retrying and return the CAPABILITY_REQUIRED structured outcome.",
    "Request HOST_EXECUTION for unrestricted host execution and NETWORK_ACCESS for network access. Do not request a capability that is already granted.",
  ];
}
```

Call it as `capabilityPrompt(input.issue, "ASSESSMENT")`, `capabilityPrompt(input.issue, "REPAIR")`, or `capabilityPrompt(input.issue, "EVIDENCE")` from the matching prompt. This makes Evidence's built-in `danger-full-access` and network access visible to the Agent even though they are not persisted as Issue grants.

Extend `continuationPrompt`:

```ts
if (continuation?.reason === "CAPABILITY_GRANTED") {
  return [
    `Capability request ${continuation.requestId} was granted: ${JSON.stringify(continuation.capabilities)}.`,
    "Continue the previously blocked stage in the existing workspace. Inspect current files and do not redo completed work.",
  ];
}
```

- [ ] **Step 6: Run Agent output tests and verify GREEN**

Run the command from Step 2.

Expected: all focused tests PASS and normal outputs remain accepted.

- [ ] **Step 7: Commit the structured protocol**

```bash
git add packages/agent-codex/src/output-schemas.ts packages/agent-codex/src/prompts.ts \
  packages/agent-codex/test/assessment.test.ts packages/agent-codex/test/repair.test.ts \
  packages/agent-codex/test/evidence.test.ts
git commit -m "feat(agent): request issue capabilities structurally"
```

### Task 3: Apply Grants in the Codex Adapter

**Files:**
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`
- Modify: `packages/agent-codex/test/helpers.ts`
- Modify: `packages/agent-codex/test/assessment.test.ts`
- Modify: `packages/agent-codex/test/repair.test.ts`
- Modify: `packages/agent-codex/test/evidence.test.ts`

- [ ] **Step 1: Write failing control-flow and permission-matrix tests**

Add tests for each grant combination and Evidence's fixed defaults:

```ts
it.each([
  [[], "read-only", false],
  [["NETWORK_ACCESS"], "read-only", true],
  [["HOST_EXECUTION"], "danger-full-access", false],
  [["HOST_EXECUTION", "NETWORK_ACCESS"], "danger-full-access", true],
] as const)("runs Assessment with grants %j", async (capabilities, sandboxMode, network) => {
  const current = issue({
    capabilityGrants: capabilities.map((capability) => ({
      capability,
      requestId: `grant-${capability}`,
      grantedAt: "2026-08-24T08:00:00.000Z",
    })),
  });
  await adapter.assess(session, { issue: current, project });
  expect(client.starts[0]).toMatchObject({
    sandboxMode,
    networkAccessEnabled: network,
  });
});

it("turns the structured branch into typed control flow without AGENT_ERROR", async () => {
  const adapter = new CodexAgentAdapter({ client, sessions, reportActivity });
  await expect(adapter.repair(session, repairInput)).rejects.toMatchObject({
    code: "AGENT_CAPABILITY_REQUIRED",
    request: {
      capabilities: ["HOST_EXECUTION"],
      reason: "Launch Electron acceptance",
    },
  });
  expect(reportActivity).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "AGENT_ERROR" }),
  );
});

it("keeps Evidence unrestricted and network-enabled", async () => {
  await adapter.captureEvidence(session, evidenceInputWithNoGrants);
  expect(client.resumes[0]?.options).toMatchObject({
    sandboxMode: "danger-full-access",
    networkAccessEnabled: true,
  });
});

it("corrects a request for capability already available to Evidence exactly once", async () => {
  client.outputs.push(capabilityRequest(["HOST_EXECUTION"]), validEvidenceOutput);
  await expect(adapter.captureEvidence(session, evidenceInputWithNoGrants)).resolves.toEqual({
    evidence: [],
  });
  expect(client.prompts).toHaveLength(2);
  expect(client.prompts[1]).toContain("already available in this stage");
});

it("rejects a repeated already-available request after one correction", async () => {
  client.outputs.push(
    capabilityRequest(["NETWORK_ACCESS"]),
    capabilityRequest(["NETWORK_ACCESS"]),
  );
  await expect(adapter.captureEvidence(session, evidenceInputWithNoGrants))
    .rejects.toThrow("AGENT_CAPABILITY_REQUEST_INVALID");
  expect(client.prompts).toHaveLength(2);
});
```

Add a corrective-continuation test using two fixture turns: the first emits a `turn.failed` permission error, and the second returns `CAPABILITY_REQUIRED`. Assert exactly two prompts and no third turn.

- [ ] **Step 2: Run the focused Adapter tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run \
  test/assessment.test.ts test/repair.test.ts test/evidence.test.ts
```

Expected: FAIL because grants are ignored and structured requests are parsed as ordinary invalid output.

- [ ] **Step 3: Calculate effective turn options**

Add a focused helper in `codex-agent-adapter.ts`:

```ts
function effectiveTurnOptions(
  issue: Issue,
  defaults: Pick<CodexThreadOptions, "sandboxMode" | "networkAccessEnabled">,
): Pick<CodexThreadOptions, "sandboxMode" | "networkAccessEnabled"> {
  const grants = new Set(issue.capabilityGrants?.map((grant) => grant.capability));
  return {
    sandboxMode: grants.has("HOST_EXECUTION")
      ? "danger-full-access"
      : defaults.sandboxMode,
    networkAccessEnabled: grants.has("NETWORK_ACCESS")
      ? true
      : defaults.networkAccessEnabled,
  };
}

function effectiveCapabilities(
  issue: Issue,
  stage: CodexActivity["stage"],
): Set<AgentCapability> {
  const result = new Set(issue.capabilityGrants?.map((grant) => grant.capability));
  if (stage === "EVIDENCE") {
    result.add("HOST_EXECUTION");
    result.add("NETWORK_ACCESS");
  }
  return result;
}
```

Use it only for Assessment and Repair:

```ts
// Assessment
{
  workingDirectory: requireProjectPath(input.issue),
  ...effectiveTurnOptions(input.issue, {
    sandboxMode: "read-only",
    networkAccessEnabled: false,
  }),
  approvalPolicy: "never",
}

// Repair
{
  workingDirectory: requireProjectPath(input.issue),
  ...effectiveTurnOptions(input.issue, {
    sandboxMode: "workspace-write",
    networkAccessEnabled: false,
  }),
  approvalPolicy: "never",
}
```

Keep Evidence's literal options unchanged:

```ts
{
  workingDirectory: requireProjectPath(input.issue),
  sandboxMode: "danger-full-access",
  networkAccessEnabled: true,
  approvalPolicy: "never",
}
```

- [ ] **Step 4: Normalize requests against effective stage capabilities**

For all three methods, inspect the structured branch before normal parsing. Subtract capabilities already effective for the stage, including Evidence's built-in host and network defaults:

```ts
type CapabilityRequestCheck =
  | { kind: "NONE" }
  | { kind: "NEW"; request: AgentCapabilityRequest }
  | { kind: "REDUNDANT" };

function checkCapabilityRequest(
  output: unknown,
  issue: Issue,
  stage: CodexActivity["stage"],
): CapabilityRequestCheck {
  const request = parseCapabilityRequiredOutput(output);
  if (!request) return { kind: "NONE" };
  const available = effectiveCapabilities(issue, stage);
  const capabilities = request.capabilities.filter((item) => !available.has(item));
  return capabilities.length === 0
    ? { kind: "REDUNDANT" }
    : { kind: "NEW", request: { ...request, capabilities } };
}
```

When the result is `NEW`, throw `AgentCapabilityRequiredError` before the normal parse `try/catch`, so it is neither reported as a parse failure nor mapped to `AGENT_ERROR`. A mixed request such as `[HOST_EXECUTION, NETWORK_ACCESS]` persists only the unavailable subset. A `REDUNDANT` request enters the single correction path in Step 5.

- [ ] **Step 5: Add one bounded corrective continuation**

Wrap the stage turn call, not the normal result parser:

```ts
private async stageTurn(
  session: AgentSessionRef,
  input: AssessInput | RepairInput | EvidenceCaptureInput,
  stage: CodexActivity["stage"],
  options: CodexThreadOptions,
  prompt: string,
  outputSchema: unknown,
): Promise<unknown> {
  const run = (nextPrompt: string) => this.turn(
    session, input, stage, options, nextPrompt, outputSchema,
  );
  let correctionUsed = false;
  let output: unknown;
  try {
    output = await run(prompt);
  } catch (error) {
    if (!looksPermissionBlocked(error)) throw error;
    correctionUsed = true;
    output = await run(
      `${prompt}\n\nThe previous attempt was permission-blocked. Make exactly one choice: use a lower-privilege alternative, or return CAPABILITY_REQUIRED. Do not retry the blocked command.`,
    );
  }

  const checked = checkCapabilityRequest(output, input.issue, stage);
  if (checked.kind === "NEW") throw new AgentCapabilityRequiredError(checked.request);
  if (checked.kind === "NONE") return output;
  if (correctionUsed) throw new Error("AGENT_CAPABILITY_REQUEST_INVALID");

  const corrected = await run(
    `${prompt}\n\nEvery capability in the previous request is already available in this stage. Continue the task and return the normal stage result. Do not request it again.`,
  );
  const rechecked = checkCapabilityRequest(corrected, input.issue, stage);
  if (rechecked.kind === "NEW") throw new AgentCapabilityRequiredError(rechecked.request);
  if (rechecked.kind === "REDUNDANT") {
    throw new Error("AGENT_CAPABILITY_REQUEST_INVALID");
  }
  return corrected;
}

function looksPermissionBlocked(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /\b(?:EPERM|EACCES)\b|operation not permitted|permission denied|sandbox|network.*(?:disabled|denied|unavailable)/i
    .test(error.message);
}
```

Replace the direct `this.turn(...)` call in Assessment, Repair, and Evidence with `this.stageTurn(...)`. Do not recurse, do not run a third turn, and do not infer which capability to grant. The wrapper permits at most one correction total for the result it receives; a raw permission error consumes that correction, so a redundant request returned by that correction fails with `AGENT_CAPABILITY_REQUEST_INVALID` rather than triggering a third turn.

- [ ] **Step 6: Run Adapter tests and verify GREEN**

Run the command from Step 2.

Expected: all focused tests PASS; Evidence remains `danger-full-access` plus network.

- [ ] **Step 7: Commit Adapter grant enforcement**

```bash
git add packages/agent-codex/src/codex-agent-adapter.ts packages/agent-codex/test
git commit -m "feat(agent): apply issue capability grants"
```

### Task 4: Pause and Resume Runtime Operations

**Files:**
- Create: `apps/runtime/src/orchestration/capability-request.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/src/orchestration/commands.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `apps/runtime/test/helpers/fakes.ts`
- Modify: `apps/runtime/test/helpers/runtime.ts`
- Modify: `apps/runtime/test/assessment-worker.test.ts`
- Modify: `apps/runtime/test/repair-worker.test.ts`
- Modify: `apps/runtime/test/evidence-worker.test.ts`
- Modify: `apps/runtime/test/commands.test.ts`
- Modify: `apps/runtime/test/recovery.test.ts`

- [ ] **Step 1: Extend the fake Agent and write failing pause tests**

Allow `FakeAgent.assessError`, `repairError`, and `evidenceError` to hold `AgentCapabilityRequiredError`. Add a tiny assertion helper to `test/helpers/runtime.ts` so each test remains explicit:

```ts
export function expectCapabilityPaused(
  paused: Issue | undefined,
  operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE",
  stage: "ASSESSMENT" | "REPAIR" | "EVIDENCE",
): void {
  expect(paused).toMatchObject({
    status: "PERMISSION_REQUIRED",
    lastFailure: undefined,
    pendingCapabilityRequest: { operation, stage, capabilities: ["HOST_EXECUTION"] },
  });
}
```

Then add the following setup in the existing operation-specific tests; do not introduce a generic fixture that hides stage setup:

- `assessment-worker.test.ts`: submit a manual Issue, run `drainOne()` once to complete `PREPARE`, set `agent.assessError`, then run `drainOne()` again.
- `repair-worker.test.ts`: use the existing `repairingIssue("repair-permission")`, insert it with `"REPAIR"`, set `agent.repairError`, then run one worker turn.
- `evidence-worker.test.ts`: use the existing `setup("agent")`, set `harness.agent.evidenceError`, then run one worker turn.

In each case construct the same error and assertions:

```ts
const permissionError = new AgentCapabilityRequiredError({
  capabilities: ["HOST_EXECUTION"],
  reason: "Launch Electron with token=secret-value",
  blockedCommand: "TOKEN=secret-value pnpm test:e2e:electron",
});

expectCapabilityPaused(store.getIssue(issue.id), operation, stage);
expect(store.listPendingOperations()).toEqual([]);
expect(JSON.stringify(store.readEvents(issue.id))).not.toContain("secret-value");
```

For host-configured Evidence, retain the existing test proving no Agent capability request is involved.

- [ ] **Step 2: Write failing grant, restart, and cancellation tests**

Add to `commands.test.ts`:

```ts
function permissionRequiredIssue(overrides: Partial<Issue> = {}): Issue {
  return reviewedIssue({
    status: "PERMISSION_REQUIRED",
    revision: 7,
    pendingCapabilityRequest: {
      id: "request-1",
      operation: "REPAIR",
      stage: "REPAIR",
      resumeStatus: "REPAIRING",
      capabilities: ["HOST_EXECUTION"],
      reason: "Launch Electron acceptance",
      requestedAt: now,
    },
    ...overrides,
  });
}

function insertPaused(store: RuntimeStore, paused: Issue): void {
  store.transaction((transaction) => {
    transaction.insertIssue(paused, "REPAIR");
    transaction.updateIssue(paused, paused.revision, null);
  });
}

it("grants the active request and requeues its exact operation", () => {
  const { commands, store, wakes } = createHarness();
  const paused = permissionRequiredIssue();
  insertPaused(store, paused);
  const resumed = commands.grantIssueCapabilities(paused.id, paused.revision, "request-1");
  expect(resumed).toMatchObject({
    status: "REPAIRING",
    capabilityGrants: [{ capability: "HOST_EXECUTION", requestId: "request-1" }],
  });
  expect(store.listPendingOperations()).toEqual([{ issue: resumed, operation: "REPAIR" }]);
  expect(wakes()).toBe(1);

  const duplicate = commands.grantIssueCapabilities(
    paused.id,
    paused.revision,
    "request-1",
  );
  expect(duplicate).toEqual(resumed);
  expect(wakes()).toBe(1);
});

it("rejects stale grant input without changing the Issue", () => {
  const { commands, store } = createHarness();
  const paused = permissionRequiredIssue();
  insertPaused(store, paused);
  expect(() => commands.grantIssueCapabilities(paused.id, paused.revision - 1, "request-1"))
    .toThrow("CONCURRENT_UPDATE");
  expect(() => commands.grantIssueCapabilities(paused.id, paused.revision, "request-old"))
    .toThrow("CAPABILITY_REQUEST_STALE");
  expect(store.getIssue(paused.id)).toEqual(paused);
});

it("cancels a permission-blocked Issue and revokes its grants", async () => {
  const { commands, store } = createHarness();
  const paused = permissionRequiredIssue({
    capabilityGrants: [{
      capability: "NETWORK_ACCESS",
      requestId: "request-old",
      grantedAt: now,
    }],
  });
  insertPaused(store, paused);
  const canceled = await commands.cancelIssue(paused.id);
  expect(canceled).toMatchObject({ status: "CANCELED", resolution: "CANCELED" });
  expect(canceled.capabilityGrants).toBeUndefined();
  expect(canceled.pendingCapabilityRequest).toBeUndefined();
});
```

Add recovery coverage asserting a persisted `PERMISSION_REQUIRED` Issue has no pending operation after restart and remains paused.

- [ ] **Step 3: Run Runtime tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run \
  test/assessment-worker.test.ts test/repair-worker.test.ts \
  test/evidence-worker.test.ts test/commands.test.ts test/recovery.test.ts
```

Expected: FAIL because capability control flow is still mapped to ordinary stage failure and no grant command exists.

- [ ] **Step 4: Implement bounded, redacted request payloads**

Create `apps/runtime/src/orchestration/capability-request.ts`:

```ts
import type { AgentCapabilityRequest } from "@oh-my-bug/core";

const secretAssignment = /((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)\s*[=:]\s*)([^\s"']+)/gi;
const bearerToken = /(bearer\s+)([^\s"']+)/gi;

function safeText(value: string, maxLength: number): string {
  return value.trim()
    .replace(secretAssignment, "$1[REDACTED]")
    .replace(bearerToken, "$1[REDACTED]")
    .slice(0, maxLength);
}

export function publicCapabilityRequest(request: AgentCapabilityRequest): AgentCapabilityRequest {
  return {
    capabilities: [...new Set(request.capabilities)],
    reason: safeText(request.reason, 4_000),
    ...(request.blockedCommand
      ? { blockedCommand: safeText(request.blockedCommand, 2_000) }
      : {}),
    ...(request.requestedBy
      ? {
          requestedBy: {
            type: request.requestedBy.type,
            ...(request.requestedBy.id
              ? { id: safeText(request.requestedBy.id, 200) }
              : {}),
          },
        }
      : {}),
  };
}
```

- [ ] **Step 5: Pause capability-required operations in the Worker**

Import `isAgentCapabilityRequiredError` and call this before ordinary error mapping in Assessment, Repair, and Agent Evidence catches:

```ts
if (this.pauseForCapability(claimed, error, "REPAIR", "REPAIR", attemptId)) return;
```

Implement:

```ts
private pauseForCapability(
  claimed: Issue,
  error: unknown,
  operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE",
  stage: "ASSESSMENT" | "REPAIR" | "EVIDENCE",
  attemptId: string,
): boolean {
  if (!isAgentCapabilityRequiredError(error)) return false;
  const request = publicCapabilityRequest(error.request);
  const requestId = this.dependencies.id();
  return this.dependencies.store.transaction((tx) => {
    const current = this.dependencies.store.getIssue(claimed.id);
    if (!current || current.revision !== claimed.revision) return true;
    const paused = recordCapabilityRequest(current, {
      ...request,
      id: requestId,
      operation,
      stage,
      requestedAt: this.dependencies.now(),
    }, this.dependencies.now());
    tx.updateIssue(paused, current.revision, null);
    tx.appendEvent(this.event(paused.id, "CAPABILITY_REQUESTED", "AGENT", {
      requestId,
      operation,
      stage,
      capabilities: paused.pendingCapabilityRequest!.capabilities,
      reason: paused.pendingCapabilityRequest!.reason,
      ...(paused.pendingCapabilityRequest!.blockedCommand
        ? { blockedCommand: paused.pendingCapabilityRequest!.blockedCommand }
        : {}),
      attemptId,
    }));
    return true;
  });
}
```

- [ ] **Step 6: Implement the optimistic grant command and continuation**

Add to `RuntimeCommands`:

```ts
grantIssueCapabilities(
  issueId: string,
  expectedRevision: number,
  requestId: string,
): Issue {
  this.assertAccepting();
  const now = this.dependencies.now();
  const result = this.dependencies.store.transaction((tx) => {
    const current = this.getIssue(issueId);
    if (current.capabilityGrants?.some((grant) => grant.requestId === requestId)) {
      return { issue: current, changed: false };
    }
    if (current.revision !== expectedRevision) throw new Error("CONCURRENT_UPDATE");
    const request = current.pendingCapabilityRequest;
    if (!request) throw new Error("CAPABILITY_REQUEST_NOT_AVAILABLE");
    const next = grantCapabilityRequest(current, requestId, now);
    tx.updateIssue(next, current.revision, request.operation);
    tx.appendEvent(this.event(issueId, "CAPABILITY_GRANTED", {
      requestId,
      operation: request.operation,
      stage: request.stage,
      capabilities: request.capabilities,
      revision: next.revision,
    }));
    return { issue: next, changed: true };
  });
  if (result.changed) this.dependencies.wake();
  return result.issue;
}
```

Expose it through `OhMyBugRuntime`. Extend Worker `continuation()` to return:

```ts
{
  reason: "CAPABILITY_GRANTED",
  requestId: granted.data.requestId,
  capabilities: granted.data.capabilities,
}
```

when the latest matching `CAPABILITY_GRANTED` event has the current operation and Issue revision.

- [ ] **Step 7: Run Runtime tests and verify GREEN**

Run the command from Step 3.

Expected: all focused tests PASS; a permission pause does not consume any failure or evidence retry budget.

- [ ] **Step 8: Commit Runtime orchestration**

```bash
git add apps/runtime/src/orchestration apps/runtime/src/runtime.ts apps/runtime/test
git commit -m "feat(runtime): pause and resume capability requests"
```

### Task 5: Expose the Grant Command Through Protocol and Transports

**Files:**
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/operations.ts`
- Modify: `apps/runtime/src/service.ts`
- Modify: `apps/runtime/test/protocol/operations.test.ts`
- Modify: `apps/runtime/test/protocol/service.test.ts`
- Modify: `apps/desktop/src/electron/desktop-api.ts`
- Modify: `apps/desktop/test/electron/desktop-api.test.ts`
- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/api/desktop-transport.ts`
- Modify: `apps/desktop/src/web/api/browser-development-transport.ts`
- Modify: `apps/desktop/src/web/api/client.ts`
- Modify: `apps/desktop/test/web/transport.test.ts`

- [ ] **Step 1: Write failing protocol and bridge tests**

Add operation tests that reject missing revision/request ID and accept the exact payload:

```ts
expect(runtimeOperations.grantIssueCapabilities.input.parse({
  id: "issue-1",
  expectedRevision: 7,
  requestId: "request-1",
})).toEqual({ id: "issue-1", expectedRevision: 7, requestId: "request-1" });

expect(() => runtimeOperations.grantIssueCapabilities.input.parse({
  id: "issue-1",
  requestId: "request-1",
})).toThrow();
```

Add Desktop API and transport assertions:

```ts
await api.grantIssueCapabilities("issue-1", 7, "request-1");
expect(ipc.invoke).toHaveBeenCalledWith(DESKTOP_REQUEST_CHANNEL, {
  operation: "grantIssueCapabilities",
  payload: { id: "issue-1", expectedRevision: 7, requestId: "request-1" },
});
```

- [ ] **Step 2: Run protocol and transport tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run \
  test/protocol/operations.test.ts test/protocol/service.test.ts
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts \
  test/electron/desktop-api.test.ts test/web/transport.test.ts
```

Expected: FAIL because `grantIssueCapabilities` is absent from the Runtime API and Desktop bridge.

- [ ] **Step 3: Add the Runtime protocol operation**

Add to `RuntimeApi`:

```ts
grantIssueCapabilities(input: {
  id: string;
  expectedRevision: number;
  requestId: string;
}): Promise<Issue>;
```

Add to `runtimeOperations`:

```ts
grantIssueCapabilities: operation({
  input: z.object({
    id: identifierSchema,
    expectedRevision: z.number().int().positive(),
    requestId: identifierSchema,
  }).strict(),
  output: outputSchemas.issue,
  renderer: true,
  invoke: (service, input) => service.grantIssueCapabilities(input),
}),
```

Add the corresponding `RuntimeFacade` and `RuntimeService` method that delegates all three arguments to `OhMyBugRuntime`.

- [ ] **Step 4: Wire Electron and web transports**

Add this signature to `DesktopApi` and its implementation:

```ts
grantIssueCapabilities(
  id: string,
  expectedRevision: number,
  requestId: string,
): Promise<RuntimeOperationOutput<"grantIssueCapabilities">>;

grantIssueCapabilities: (id, expectedRevision, requestId) =>
  request("grantIssueCapabilities", { id, expectedRevision, requestId }),
```

Add the same method to `ProductTransport`, `desktop-transport.ts`, and `api/client.ts`. The read-only browser development transport uses its existing `readOnly` rejection function.

- [ ] **Step 5: Run protocol and transport tests and verify GREEN**

Run the commands from Step 2.

Expected: all focused protocol and transport tests PASS.

- [ ] **Step 6: Commit protocol wiring**

```bash
git add apps/runtime/src/protocol apps/runtime/src/service.ts apps/runtime/test/protocol \
  apps/desktop/src/electron/desktop-api.ts apps/desktop/src/web/api \
  apps/desktop/test/electron/desktop-api.test.ts apps/desktop/test/web/transport.test.ts
git commit -m "feat(protocol): grant issue capabilities"
```

### Task 6: Build the Inline Permission UI

**Files:**
- Create: `apps/desktop/src/web/issues/capability-request-panel.tsx`
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`
- Modify: `apps/desktop/src/web/issues/issue-status.tsx`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/test/web/issues.test.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Write failing component tests**

Add a `PERMISSION_REQUIRED` Issue fixture and assert truthful labels and exactly the intended Issue actions:

```tsx
const permissionRequiredIssue: IssueDto = {
  ...issue,
  status: "PERMISSION_REQUIRED",
  resolution: undefined,
  revision: 10,
  pendingCapabilityRequest: {
    id: "request-1",
    operation: "REPAIR",
    stage: "REPAIR",
    resumeStatus: "REPAIRING",
    capabilities: ["HOST_EXECUTION"],
    reason: "Launch Electron acceptance",
    blockedCommand: "pnpm test:e2e:electron",
    requestedAt: "2026-08-24T08:00:00.000Z",
  },
};

it("shows an inline host permission request with grant and cancel actions", async () => {
  const onGrantCapabilities = vi.fn(async () => undefined);
  const onCancel = vi.fn(async () => undefined);
  render(<IssueDetail
    issue={permissionRequiredIssue}
    onRefresh={async () => undefined}
    onGrantCapabilities={onGrantCapabilities}
    onCancel={onCancel}
  />);

  expect(screen.getByText("权限不足")).toBeVisible();
  expect(screen.getByText(/不受工作区沙箱限制的宿主命令执行权限/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "暂不授权" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "授权并继续" })).toBeVisible();
  expect(screen.getByRole("button", { name: "取消 Issue" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "授权并继续" }));
  expect(await screen.findByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "确认授权并继续" }));
  await waitFor(() => expect(onGrantCapabilities).toHaveBeenCalledWith(
    permissionRequiredIssue.revision,
    "request-1",
  ));
});

it("keeps the request actionable when a stale grant is rejected", async () => {
  render(<IssueDetail
    issue={permissionRequiredIssue}
    onRefresh={async () => undefined}
    onGrantCapabilities={async () => { throw new Error("CONCURRENT_UPDATE"); }}
    onCancel={async () => undefined}
  />);
  fireEvent.click(screen.getByRole("button", { name: "授权并继续" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认授权并继续" }));
  expect(await screen.findByText("CONCURRENT_UPDATE")).toBeVisible();
  expect(screen.getByRole("button", { name: "授权并继续" })).toBeEnabled();
});
```

Add app-level wiring coverage asserting the transport method receives selected Issue ID, revision, and request ID.

- [ ] **Step 2: Run Desktop UI tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts \
  test/web/issues.test.tsx test/web/app-workbench.test.tsx
```

Expected: FAIL because the status and capability panel do not exist.

- [ ] **Step 3: Create the focused permission panel**

Create `capability-request-panel.tsx` with props:

```ts
interface CapabilityRequestPanelProps {
  request: NonNullable<IssueDto["pendingCapabilityRequest"]>;
  onGrant(): Promise<void>;
  onCancel(): Promise<void>;
}
```

Render capability descriptions from a total map:

```ts
const capabilityLabels = {
  HOST_EXECUTION: {
    title: "宿主执行权限",
    description: "不受工作区沙箱限制的宿主命令执行权限，可启动 GUI、Electron 和其他进程，并访问工作区外文件。",
  },
  NETWORK_ACCESS: {
    title: "网络访问",
    description: "允许当前 Issue 的 Agent 回合访问网络。",
  },
} satisfies Record<AgentCapability, { title: string; description: string }>;
```

The panel owns `busy`, `error`, and host-confirmation-open state so a rejected optimistic grant leaves the card actionable and displays the error inline. The card contains only “授权并继续” and “取消 Issue”. When `HOST_EXECUTION` is present, “授权并继续” opens a confirmation `Dialog` whose destructive scope is stated plainly and whose affirmative button is “确认授权并继续”.

- [ ] **Step 4: Wire Issue detail and status**

Add `PERMISSION_REQUIRED: "review"` and `PERMISSION_REQUIRED: "权限不足"` in `issue-status.tsx`.

Add to `IssueDetailProps`:

```ts
onGrantCapabilities?: (expectedRevision: number, requestId: string) => Promise<void>;
```

Render `CapabilityRequestPanel` only when status and request agree. Pass `refreshAfter(() => onGrantCapabilities(issue.revision, request.id))` as its grant callback so a successful response refreshes Issue state. Include `PERMISSION_REQUIRED` in `canCancel`, but suppress the generic “Agent 正在运行” cancel section while the permission panel is visible so there is only one cancellation surface.

In `app.tsx`, wire:

```tsx
onGrantCapabilities={(expectedRevision, requestId) => action(
  api.grantIssueCapabilities(selected.id, expectedRevision, requestId),
)}
```

- [ ] **Step 5: Add scoped styling**

Add only `.capability-request-panel`, its capability list, metadata, and responsive action-row rules to `global.css`. Reuse existing tokens, `Alert`, `Button`, and `Dialog`; do not introduce a new color system.

- [ ] **Step 6: Run Desktop UI tests and verify GREEN**

Run the command from Step 2.

Expected: focused UI tests PASS, with no global modal on initial render.

- [ ] **Step 7: Commit the permission UI**

```bash
git add apps/desktop/src/web/issues apps/desktop/src/web/app.tsx \
  apps/desktop/src/web/styles/global.css apps/desktop/test/web/issues.test.tsx \
  apps/desktop/test/web/app-workbench.test.tsx
git commit -m "feat(desktop): approve issue capabilities inline"
```

### Task 7: Isolate Private-Temp Cleanup Failures

**Files:**
- Modify: `packages/agent-codex/src/codex-client.ts`
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`
- Modify: `packages/agent-codex/test/codex-client.test.ts`
- Modify: `packages/agent-codex/test/activity.test.ts`
- Modify: `packages/agent-codex/test/repair.test.ts`
- Modify: `apps/desktop/src/web/issues/agent-activity.tsx`
- Modify: `apps/desktop/test/web/agent-activity.test.tsx`

- [ ] **Step 1: Write the OHMYBUG-14 regression tests**

Add a client stream test whose normal event stream completes and whose cleanup rejects with `ENOTEMPTY`:

```ts
async function* completedSdkTurn(): AsyncGenerator<ThreadEvent> {
  yield { type: "turn.completed", usage: { input_tokens: 0, output_tokens: 0 } } as ThreadEvent;
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

it("emits cleanup failure after a completed turn instead of rejecting the stream", async () => {
  const events = normalizeEvents(completedSdkTurn(), undefined, async () => {
    throw Object.assign(new Error("directory not empty"), { code: "ENOTEMPTY" });
  });
  await expect(collect(events)).resolves.toEqual([
    { type: "turn.completed" },
    { type: "cleanup.failed", message: "ENOTEMPTY: directory not empty" },
  ]);
});
```

Add an Adapter regression using a fixture thread whose Agent message is a valid Repair result and whose `dispose()` throws `ENOTEMPTY`:

```ts
await expect(adapter.repair(session, repairInput)).resolves.toEqual({
  summary: "Implemented",
  evidence: [],
});
expect(reportActivity).toHaveBeenCalledWith(expect.objectContaining({
  type: "AGENT_TEMP_CLEANUP_FAILED",
  stage: "REPAIR",
  level: "error",
}));
```

Add a primary-error test asserting a turn failure remains the thrown error even when cleanup also fails.

- [ ] **Step 2: Run cleanup-focused tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run \
  test/codex-client.test.ts test/activity.test.ts test/repair.test.ts
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts \
  test/web/agent-activity.test.tsx
```

Expected: FAIL because cleanup errors still reject the completed turn and no cleanup activity type exists.

- [ ] **Step 3: Add a non-fatal cleanup client event**

Extend `CodexClientEvent`:

```ts
| { type: "cleanup.failed"; message: string };
```

Export `normalizeEvents` from `codex-client.ts` as a test seam (do not re-export it from the package index), then refactor it so it holds primary and cleanup failures separately:

```ts
let streamFailure: { error: unknown } | undefined;
let cleanupFailure: unknown;
try {
  for await (const event of events) {
    yield normalizeEvent(event);
  }
} catch (error) {
  streamFailure = { error: normalizeNativeThreadError(error, resumedThreadId) };
} finally {
  try {
    await cleanup?.();
  } catch (error) {
    cleanupFailure = error;
  }
}
if (streamFailure) {
  if (cleanupFailure) attachCleanupError(streamFailure.error, cleanupFailure);
  throw streamFailure.error;
}
if (cleanupFailure) {
  yield { type: "cleanup.failed", message: cleanupMessage(cleanupFailure) };
}
```

Define the formatter next to the generator so codes such as `ENOTEMPTY` survive without leaking stacks:

```ts
function cleanupMessage(error: unknown): string {
  if (!(error instanceof Error)) return "AGENT_TEMP_CLEANUP_FAILED";
  const code = "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
  return `${code}${error.message}`.slice(0, 2_000);
}
```

Use bounded retries for the owned private temp removal:

```ts
rm(privateTemp, {
  recursive: true,
  force: true,
  maxRetries: 3,
  retryDelay: 100,
}, callback);
```

- [ ] **Step 4: Prevent `dispose()` from overriding a parsed result**

In the Adapter `finally`, report but swallow disposal-only cleanup errors:

```ts
try {
  await thread?.dispose();
} catch (error) {
  await this.reportActivity(session.sessionId, stage, {
    type: "cleanup.failed",
    message: error instanceof Error ? error.message : "AGENT_TEMP_CLEANUP_FAILED",
  });
} finally {
  if (this.active.get(session.sessionId) === active) this.active.delete(session.sessionId);
  finish();
}
```

Map `cleanup.failed` in `publicActivity` to `AGENT_TEMP_CLEANUP_FAILED`, message “Agent 临时目录清理失败”, sanitized detail, and `level: "error"`. Do not set `failureReported` for this event.

- [ ] **Step 5: Add the activity label**

In Desktop `agent-activity.tsx`, label `AGENT_TEMP_CLEANUP_FAILED` as “临时目录清理失败”. Keep it in the activity log without changing Issue status or rendering the generic failure banner.

- [ ] **Step 6: Run cleanup tests and verify GREEN**

Run the commands from Step 2.

Expected: the valid Repair result resolves, cleanup diagnostics remain visible, and primary failures remain primary.

- [ ] **Step 7: Commit cleanup isolation**

```bash
git add packages/agent-codex/src packages/agent-codex/test \
  apps/desktop/src/web/issues/agent-activity.tsx apps/desktop/test/web/agent-activity.test.tsx
git commit -m "fix(agent): isolate temp cleanup failures"
```

### Task 8: Add Persistence and End-to-End Regression Coverage

**Files:**
- Modify: `packages/storage/test/sqlite/issue-store.test.ts`
- Modify: `packages/storage/test/sqlite/recovery-store.test.ts`
- Modify: `apps/runtime/test/recovery.test.ts`
- Modify: `apps/runtime/test/acceptance/restart-flow.test.ts`
- Modify: `apps/runtime/test/acceptance/manual-full-flow.test.ts`

- [ ] **Step 1: Write failing SQLite round-trip tests**

Persist and reopen an Issue containing both a prior network grant and a pending host request:

```ts
expect(reopenedStore.getIssue(issue.id)).toMatchObject({
  status: "PERMISSION_REQUIRED",
  capabilityGrants: [{ capability: "NETWORK_ACCESS", requestId: "request-old" }],
  pendingCapabilityRequest: {
    id: "request-1",
    operation: "REPAIR",
    resumeStatus: "REPAIRING",
    capabilities: ["HOST_EXECUTION"],
  },
});
expect(reopenedStore.listPendingOperations()).toEqual([]);
```

- [ ] **Step 2: Write a failing Runtime acceptance flow**

Add one complete flow:

```text
manual Issue
  -> Assessment Agent requests NETWORK_ACCESS
  -> PERMISSION_REQUIRED
  -> restart Runtime: still paused
  -> grantIssueCapabilities
  -> same logical Agent session resumes Assessment with CAPABILITY_GRANTED
  -> Assessment Review
  -> approve Assessment
  -> Repair Agent requests HOST_EXECUTION
  -> grant and resume same Repair session/workspace
  -> implementation draft
  -> Evidence runs with danger-full-access + network without requesting either capability
```

Assert a second Issue in the same project receives no grants.

- [ ] **Step 3: Run persistence and acceptance tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/storage exec vitest run \
  test/sqlite/issue-store.test.ts test/sqlite/recovery-store.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run \
  test/acceptance/restart-flow.test.ts test/acceptance/manual-full-flow.test.ts
```

Expected: FAIL until all capability fields and recovery behavior work across SQLite and Runtime recreation.

- [ ] **Step 4: Lock the intentionally-paused recovery behavior**

No SQLite table migration is needed because Issue capability state lives in `data_json`. Add this exact regression to `apps/runtime/test/recovery.test.ts`; `interruptedOperation()` should already return `undefined`, so production recovery code should remain unchanged unless this test proves otherwise:

```ts
it("keeps a capability request paused across interrupted-issue recovery", () => {
  const { store } = createHarness();
  const paused = reviewedIssue({
    status: "PERMISSION_REQUIRED",
    revision: 8,
    pendingCapabilityRequest: {
      id: "request-1",
      operation: "REPAIR",
      stage: "REPAIR",
      resumeStatus: "REPAIRING",
      capabilities: ["HOST_EXECUTION"],
      reason: "Launch Electron acceptance",
      requestedAt: now,
    },
  });
  store.transaction((transaction) => {
    transaction.insertIssue(paused, "REPAIR");
    transaction.updateIssue(paused, paused.revision, null);
  });

  reconcileInterruptedIssues({ store, id: eventIds("permission"), now: () => now });

  expect(store.getIssue(paused.id)).toEqual(paused);
  expect(store.listPendingOperations()).toEqual([]);
  expect(store.readEvents(paused.id)).toEqual([]);
});
```

- [ ] **Step 5: Run persistence and acceptance tests and verify GREEN**

Run the commands from Step 3.

Expected: all focused persistence and acceptance tests PASS.

- [ ] **Step 6: Run package-level verification**

Run:

```bash
pnpm --filter @oh-my-bug/core test
pnpm --filter @oh-my-bug/agent-codex test
pnpm --filter @oh-my-bug/storage test
pnpm --filter @oh-my-bug/runtime test
pnpm --filter @oh-my-bug/desktop test
pnpm typecheck
pnpm lint
```

Expected: every command exits 0. Existing unrelated worktree changes must remain outside all commits.

- [ ] **Step 7: Commit persistence and acceptance coverage**

```bash
git add packages/storage/test/sqlite apps/runtime/test/acceptance
git commit -m "test: cover capability grant recovery flow"
```

### Task 9: Final Cross-Layer Verification

**Files:**
- Verify only; do not modify files unless a failing check identifies a capability-request regression.

- [ ] **Step 1: Run repository verification**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build:desktop
git diff --check
```

Expected: all commands exit 0 and `git diff --check` prints nothing.

- [ ] **Step 2: Verify the security and lifecycle invariants from tests**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run \
  test/assessment.test.ts test/repair.test.ts test/evidence.test.ts test/codex-client.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run \
  test/assessment-worker.test.ts test/repair-worker.test.ts test/evidence-worker.test.ts \
  test/commands.test.ts test/acceptance/restart-flow.test.ts
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts \
  test/web/issues.test.tsx test/web/app-workbench.test.tsx test/web/agent-activity.test.tsx
```

Expected assertions include:

- Assessment/Repair stay low privilege without grants.
- Evidence always remains `danger-full-access` with network enabled.
- A grant affects only its Issue and lasts through resumed turns until a terminal state.
- `PERMISSION_REQUIRED` survives restart without running.
- The UI has no “暂不授权” action.
- `ENOTEMPTY` cleanup cannot turn a completed Repair into `REPAIR_FAILED`.

- [ ] **Step 3: Review the final commit range**

```bash
git log --oneline --decorate -10
git status --short
git diff --stat HEAD~8..HEAD
```

Expected: capability work is split into focused commits; unrelated pre-existing changes remain uncommitted and are not included in the commit range.
