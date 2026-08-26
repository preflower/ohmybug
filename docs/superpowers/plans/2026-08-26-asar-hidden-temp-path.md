# ASAR Hidden Temporary Path Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop ASAR packaging unpack required runtime assets when its source tree is below a hidden Agent temporary directory.

**Architecture:** Export a single basename-only unpack pattern from the packaged-runtime module. Electron Forge and the real ASAR fixture both consume that pattern, and a hidden-path regression verifies metadata plus physical unpacked files.

**Tech Stack:** TypeScript, Electron Forge, `@electron/asar` 3.4.1, Vitest.

---

### Task 1: Reproduce hidden-path packaging failure

**Files:**
- Modify: `apps/desktop/test/electron/packaged-runtime.test.ts`

- [x] **Step 1: Add a hidden-path regression**

Temporarily point the process temporary-directory environment variables below a `.hidden` directory, then assert that Codex and MediaInfo are unpacked when the fixture source path crosses that directory.

- [x] **Step 2: Run the focused test before changing production code**

Run the packaged-runtime test with a regular OS temp root.

Expected: FAIL with `PACKAGED_RUNTIME_ARCHIVE_UNPACKED_REQUIRED` for Codex and MediaInfo.

### Task 2: Make ASAR unpacking path-independent

**Files:**
- Modify: `apps/desktop/scripts/packaged-runtime.ts`
- Modify: `apps/desktop/forge.config.ts`
- Modify: `apps/desktop/test/electron/packaged-runtime.test.ts`

- [x] **Step 1: Export a shared basename-only unpack pattern**

Add:

```ts
export const desktopAsarUnpackPattern =
  "{*.node,*.wasm,*.dylib,*.so,*.dll,*.exe,codex}";
```

- [x] **Step 2: Use the shared pattern in Forge and the archive fixture**

Replace both path-bearing glob literals with `desktopAsarUnpackPattern`.

- [x] **Step 3: Run the focused test**

Expected: all packaged-runtime tests pass, including the hidden-path regression.

### Task 3: Verify the complete desktop boundary

**Files:**
- Test: `apps/desktop/test/electron/packaged-runtime.test.ts`
- Test: `apps/desktop/test/electron/packaging.test.ts`

- [x] **Step 1: Run the full Desktop Vitest suite under a hidden TMPDIR**

Expected: all Desktop test files and tests pass.

- [x] **Step 2: Run Desktop type checking and lint**

Expected: both commands exit successfully.

- [x] **Step 3: Review the diff and commit**

Expected: only the shared unpack rule, its regression coverage, and these design/plan documents change.
