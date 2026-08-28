# Automated Desktop Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically version, validate, sign, notarize, package, and attach the macOS arm64 desktop application whenever the Release Please release PR is merged.

**Architecture:** Release Please owns the root application version and changelog because the root `package.json` is the Electron Forge application manifest. A GitHub Actions release workflow runs Release Please and, when that action creates a release, checks out the exact release tag and runs the existing desktop validation and Electron Forge packaging commands on a macOS arm64 runner. Forge enables signing and notarization only when the release workflow explicitly sets `OMB_MACOS_SIGN=1`, so local packaging remains unsigned and credential-free.

**Tech Stack:** GitHub Actions, Release Please, pnpm 11, Node.js 24, Electron Forge 7, Vitest, Apple Developer ID signing, Apple notarytool authentication.

---

## File structure

- `release-please-config.json`: root Node release configuration and release-note sections.
- `.release-please-manifest.json`: current released root application version.
- `CHANGELOG.md`: user-facing release history maintained by Release Please.
- `.github/workflows/ci.yml`: pull-request and main-branch verification.
- `.github/workflows/release.yml`: Release Please orchestration plus signed macOS arm64 packaging and GitHub Release upload.
- `apps/desktop/forge.config.ts`: opt-in macOS signing and notarization configuration.
- `apps/desktop/test/electron/packaging.test.ts`: signing configuration behavior.
- `test/architecture/release-automation.test.ts`: repository-level release automation contract.

### Task 1: Lock the release automation contract

**Files:**
- Create: `test/architecture/release-automation.test.ts`
- Modify: `apps/desktop/test/electron/packaging.test.ts`

- [ ] **Step 1: Write the failing repository automation test**

Create a Vitest suite that reads the proposed JSON, workflow, changelog, and README files. Assert that Release Please targets `.` with `release-type: node`, the manifest version equals the root `package.json` version, CI runs typecheck/lint/test/build, the release workflow gates packaging on `release_created`, runs on `macos-15`, performs the packaged runtime and Electron E2E checks, and uploads DMG/ZIP artifacts plus checksums. Assert that operational release details and secrets do not leak into the product README.

- [ ] **Step 2: Extend the packaging test before changing Forge**

Import `resolveMacSigningConfig` from `forge.config.ts`. Assert that an empty environment returns `{}`, a complete release environment returns `osxSign` and `osxNotarize`, and an incomplete release environment throws `OMB_MACOS_SIGN_REQUIRES:APPLE_API_KEY,APPLE_API_KEY_ID,APPLE_API_ISSUER`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm exec vitest run test/architecture/release-automation.test.ts
pnpm --dir apps/desktop exec vitest run test/electron/packaging.test.ts
```

Expected: the repository test fails because the release files do not exist, and the desktop test fails because `resolveMacSigningConfig` is not exported.

### Task 2: Add versioning, CI, and release workflows

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Create: `CHANGELOG.md`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Modify: `package.json`

- [ ] **Step 1: Configure root application releases**

Configure a single `.` package using the Node release type, `oh-my-bug-v<version>` component tags, pre-1.0 breaking changes as minor releases, and explicit Features, Bug Fixes, Performance, Documentation, and Dependencies changelog sections. Component tags avoid the open Release Please root Node package mismatch affecting bare `v<version>` tags. Bootstrap history at commit `98c3fc35e421106750bca2b87bc5f2ab504f7078`, initialize the manifest to `0.1.0`, and create an initial `CHANGELOG.md` entry.

- [ ] **Step 2: Add pull-request CI**

Create a macOS arm64 workflow triggered by pull requests and pushes to `main`. Install pnpm 11.22.0 and Node.js 24, install dependencies with the frozen lockfile, install Playwright Chromium, then run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build:desktop`.

- [ ] **Step 3: Add the release workflow**

On pushes to `main` and manual dispatch, mint a least-privilege GitHub App installation token and run Release Please with it so release PRs trigger CI. When `release_created` is true, check out the exact `tag_name` on `macos-15`, validate `oh-my-bug-v${package.json.version}` against the tag, import the base64 Developer ID `.p12`, decode the App Store Connect `.p8` into `RUNNER_TEMP`, run the full unit and static quality gates, execute `pnpm make`, run `doctor:package` and the stable packaged Electron release smoke suite, generate basename-only SHA-256 checksums in a staging directory, and upload one or more DMG and ZIP artifacts to the existing GitHub Release.

- [ ] **Step 4: Run the repository contract test and verify GREEN**

Run:

```bash
pnpm exec vitest run test/architecture/release-automation.test.ts
```

Expected: PASS.

### Task 3: Enable opt-in signing and document operations

**Files:**
- Modify: `apps/desktop/forge.config.ts`
- Modify: `README.md`

- [ ] **Step 1: Implement minimal signing configuration**

Add `resolveMacSigningConfig(environment)` to return no signing options unless `OMB_MACOS_SIGN` equals `1`. In release mode, require `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`; return `osxSign: {}` and the corresponding `osxNotarize` API-key configuration. Spread the result into `packagerConfig`.

- [ ] **Step 2: Run the desktop packaging test and verify GREEN**

Run:

```bash
pnpm --dir apps/desktop exec vitest run test/electron/packaging.test.ts
```

Expected: PASS.

- [ ] **Step 3: Keep release operations self-contained**

Keep the release procedure and required secret names in the workflow/configuration itself. Do not add operational release instructions or credential names to the product README.

- [ ] **Step 4: Run proportional verification**

Run:

```bash
pnpm exec vitest run test/architecture/release-automation.test.ts
pnpm --dir apps/desktop exec vitest run test/electron/packaging.test.ts
pnpm typecheck
pnpm lint
pnpm test
pnpm build:desktop
pnpm package
pnpm doctor:package -- "--app=out/Oh My Bug-darwin-arm64/Oh My Bug.app"
pnpm test:e2e:electron
```

Expected: all commands pass. Release signing and GitHub upload are structurally verified locally and execute only in GitHub Actions where Apple and GitHub credentials are available.

No commits are created automatically; the completed changes remain available for user review in the current managed worktree.
