# Project Permission Mode Implementation Plan

> **For Codex:** Execute this plan with test-driven development. Run every named test once before and once after its production change.

**Goal:** Let each project choose 请求批准, 帮我批准, or 完全访问权限 in graphical project settings, persist that choice in local project data, and apply the equivalent permission settings whenever Codex runs or resumes in Terminal.

**Architecture:** Add one shared `ProjectPermissionMode` value to Core project context and Runtime protocol DTOs. Runtime keeps backward compatibility by treating missing values as `request-approval`. The Codex adapter translates the mode into thread approval/reviewer/sandbox options, while the private terminal launch target carries only the enum and Electron maps it to a fixed, trusted CLI argument list. The repository's own `.codex/config.toml` is never modified.

**Tech Stack:** TypeScript, Zod, React, Base UI, Electron, Vitest.

---

### Task 1: Define and persist the project permission mode

**Files:**
- Modify: `packages/core/src/agent/adapter.ts`
- Modify: `packages/core/src/runtime/types.ts`
- Test: `packages/core/test/runtime/project.test.ts`
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Modify: `apps/runtime/src/service.ts`
- Test: `apps/runtime/test/protocol/operations.test.ts`
- Test: `apps/runtime/test/protocol/service.test.ts`

1. Add failing schema tests for all three values and rejection of unknown values.
2. Add `ProjectPermissionMode` and its Zod schema, keeping the runtime field optional for old stored rows.
3. Add the field to create/update/product protocol schemas and DTOs.
4. Default missing stored values to `request-approval` when returning `ProductProject`.
5. Verify Core and Runtime tests pass.

### Task 2: Map project modes to Codex execution settings

**Files:**
- Modify: `packages/agent-codex/src/codex-client.ts`
- Modify: `packages/agent-codex/src/app-server/protocol.ts`
- Modify: `packages/agent-codex/src/app-server/codex-client.ts`
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`
- Test: `packages/agent-codex/test/app-server/codex-client.test.ts`
- Test: `packages/agent-codex/test/assessment.test.ts`
- Test: `packages/agent-codex/test/repair.test.ts`

1. Add failing tests proving auto review sends `approvalPolicy: on-request` and `approvalsReviewer: auto_review`.
2. Add failing tests proving full access uses `danger-full-access`, network access, and no approval prompt.
3. Expand App Server protocol types to the supported approval values and send `approvalsReviewer` on thread and turn start.
4. Translate the project's mode at the adapter boundary. Keep request-approval integrated with the app's existing explicit capability request workflow, since background App Server requests have no interactive terminal attached.
5. Verify Agent Codex tests pass.

### Task 3: Pass the mode when opening Codex in Terminal

**Files:**
- Modify: `packages/agent-codex/src/app-server/runtime-host.ts`
- Test: `packages/agent-codex/test/app-server/runtime-host.test.ts`
- Modify: `apps/runtime/src/service.ts`
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Test: `apps/runtime/test/protocol/service.test.ts`
- Test: `apps/runtime/test/protocol/operations.test.ts`
- Modify: `apps/desktop/src/electron/agent-terminal-launcher.ts`
- Test: `apps/desktop/test/electron/agent-terminal-launcher.test.ts`

1. Add failing tests that the launch target contains the project enum and no arbitrary CLI arguments.
2. Add failing launcher tests for the fixed CLI arguments of each mode and argv safety.
3. Carry the enum through the private Runtime operation.
4. Map only trusted enum values to fixed Codex flags before `resume` in the AppleScript command.
5. Verify Runtime, Agent Codex, and Desktop Electron tests pass.

### Task 4: Add the graphical project permission setting

**Files:**
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/styles/global.css`
- Test: `apps/desktop/test/web/projects.test.tsx`
- Test: `apps/desktop/test/web/transport.test.ts`
- Test: `apps/desktop/test/web/project-settings-layout.test.ts`

1. Add failing tests for the default selection, saved selection, payload, and full-access confirmation.
2. Add an independent 权限 tab with three semantic radio rows and concise descriptions.
3. Require an intentional confirmation before changing to 完全访问; cancel restores the previous mode.
4. Remove the misleading static 工作目录权限 note from the Project tab.
5. Add restrained responsive styles using existing semantic tokens and visible focus/selected states.
6. Verify Desktop web tests pass.

### Task 5: Full verification and review

1. Run targeted package tests for Core, Agent Codex, Runtime, and Desktop.
2. Run workspace typecheck and repository typecheck.
3. Run lint.
4. Inspect the settings screen in both dark and light themes if the local app can be launched without external setup.
5. Review the diff for secret leakage, unsafe shell construction, backward compatibility, and unrelated changes.
