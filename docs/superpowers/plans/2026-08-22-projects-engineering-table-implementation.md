# Projects Engineering Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Projects card list with the approved A-direction engineering table, including truthful search, sorting, integration labels, relative update times, responsive layout, and deterministic screenshot verification.

**Architecture:** Move the populated Projects list into a focused React component under `projects/`, leaving `App` responsible for routing, loading, onboarding, and project editing. Keep the full row as the existing activation affordance, derive every visible value from `ProjectDto` and plugin manifests, and implement the visual table as a responsive CSS grid using current semantic tokens and shadcn/Base UI controls.

**Tech Stack:** React 19, TypeScript, Base UI/shadcn primitives, Lucide React, CSS semantic tokens, Vitest + Testing Library, Playwright, Swift visual-diff tooling

---

### Task 1: Lock list behavior with failing component tests

**Files:**
- Create: `apps/desktop/test/web/project-list.test.tsx`
- Create: `apps/desktop/src/web/projects/project-list.tsx`

- [ ] **Step 1: Write the failing render-and-data test**

Define three `ProjectDto` fixtures matching the approved reference and two manifests. Render the wished-for component API:

```tsx
<ProjectList
  manifests={manifests}
  now={Date.parse("2026-08-22T06:00:00.000Z")}
  projects={projects}
  onEdit={onEdit}
/>
```

Assert the accessible region heading and count, column labels, project names, full paths, `Codex`, `Sentry · DingTalk`, `未启用`, `刚刚`, `18 分钟前`, and `昨天`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/project-list.test.tsx
```

Expected: FAIL because `projects/project-list.tsx` does not exist.

- [ ] **Step 3: Write the failing interaction test**

Assert that entering `store` leaves only `storefront`; clearing the query and choosing `项目名称` orders projects alphabetically; activating the `ohmybug` row calls `onEdit` with that exact DTO.

- [ ] **Step 4: Add the minimal component implementation**

Implement and export:

```ts
type ProjectSort = "updated" | "name";

export function filterAndSortProjects(
  projects: ProjectDto[],
  query: string,
  sort: ProjectSort,
): ProjectDto[];

export function formatProjectUpdatedAt(updatedAt: string, now: number): string;

export function ProjectList(props: {
  manifests: IntegrationPluginManifest[];
  now?: number;
  projects: ProjectDto[];
  onEdit(project: ProjectDto): void;
}): JSX.Element;
```

Use `Input`, `Select`, and `Button`; use Search, FolderKanban, and ChevronRight from Lucide; derive integration display names from enabled configuration keys and manifests.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: PASS with no warnings.

### Task 2: Integrate the table into Projects routing

**Files:**
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`
- Modify: `test/e2e/projects.spec.ts`

- [ ] **Step 1: Update existing tests first**

Change populated-list expectations from `.project-card` to `.project-table-row`, and assert the Projects route exposes `搜索项目`, `项目排序`, and the `本机项目` region before opening a project.

- [ ] **Step 2: Run existing tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/app-workbench.test.tsx
```

Expected: FAIL because the current Projects workspace has no search or sort controls.

- [ ] **Step 3: Integrate `ProjectList`**

Import `ProjectList` in `app.tsx`. Replace only the populated `.project-list`/`.project-card` branch with:

```tsx
<ProjectList manifests={manifests} projects={projects} onEdit={onEdit} />
```

Keep the existing empty onboarding branch and project-editor branch unchanged. Remove now-unused `ChevronRight` from `app.tsx` imports.

- [ ] **Step 4: Run focused web tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/project-list.test.tsx test/web/app-workbench.test.tsx test/web/app-shell.test.tsx
```

Expected: all tests PASS.

### Task 3: Implement reference-matched responsive styling

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/test/web/project-list.test.tsx`

- [ ] **Step 1: Add style-structure assertions first**

Assert the populated page uses `data-testid="projects-list-screen"`, rows expose `.project-table-row`, technical values use `code`, and enabled integrations include text as well as semantic dots.

- [ ] **Step 2: Run the focused test and verify RED**

Run the Task 1 test command. Expected: FAIL on the missing final structure or class names.

- [ ] **Step 3: Replace card CSS with table CSS**

Remove `.project-list`, `.project-card`, and obsolete card-descendant rules. Add focused rules for:

```text
.projects-layout             max-width 1192px
.projects-heading            title + count
.projects-list-toolbar       search + sort
.project-table               framed list surface
.project-table-header        six-column grid
.project-table-row           matching six-column grid, 66px minimum
.project-table-identity      mark + name/key
.project-table-path          mono truncation
.project-integrations        textual names + dots
.projects-local-note         quiet permission note
```

Use semantic tokens only. Desktop columns are Project, Local path, Agent, Integrations, Updated, Action. Below 1100px hide the Agent header/cell; below 860px hide the header and switch rows to a two-column identity/updated layout with path and integrations on subsequent grid lines; coarse-pointer row height grows to at least 72px.

- [ ] **Step 4: Run component and existing layout tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/project-list.test.tsx test/web/app-workbench.test.tsx test/web/app-shell.test.tsx
pnpm exec playwright test test/e2e/projects.spec.ts test/e2e/workspace-layout.spec.ts test/e2e/accessibility.spec.ts
```

Expected: all tests PASS.

### Task 4: Make the reference state reproducible

**Files:**
- Modify: `apps/desktop/test/electron/vite-hot-reload.test.ts`
- Modify: `apps/desktop/scripts/dev-browser-snapshot.ts`
- Create: `.artifacts/visual-diff/projects-list-a/capture.mjs`

- [ ] **Step 1: Update the fallback snapshot test first**

Expect the empty-data browser preview to expose `ohmybug`, `logistics-core`, and `storefront` with the reference keys, paths, agents, integrations, and staggered `updatedAt` values.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/electron/vite-hot-reload.test.ts
```

Expected: FAIL because the fallback currently returns only `STYLE`.

- [ ] **Step 3: Implement the deterministic three-project fallback**

Keep the two representative Issues attached to `ohmybug`; add the other two projects only for Projects-list fidelity. Derive timestamps from the injected `now` value so `刚刚`, `18 分钟前`, and `昨天` remain deterministic.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Add an uncommitted capture script**

The `.artifacts` script launches Chromium at 1536×1024, fixes `Date.now`, opens `/projects` in dark mode against a fresh empty `OH_MY_BUG_HOME`, waits for `projects-list-screen`, hovers the first row, disables animation, and writes `.artifacts/visual-diff/projects-list-a/actual.png`.

### Task 5: Build, capture, compare, and iterate

**Files:**
- Create: `.artifacts/visual-diff/projects-list-a/actual.png`
- Create: `.artifacts/visual-diff/projects-list-a/report.json`
- Create: `.artifacts/visual-diff/projects-list-a/diff.png`
- Create: `.artifacts/visual-diff/projects-list-a/overlay.png`

- [ ] **Step 1: Run code checks**

Run:

```bash
pnpm --filter @oh-my-bug/desktop typecheck
pnpm --filter @oh-my-bug/desktop test
pnpm build:web
```

Expected: all commands exit 0.

- [ ] **Step 2: Capture the real target screen**

Start the project-owned Vite renderer with a fresh temporary `OH_MY_BUG_HOME`, run the capture script, and stop the server. Confirm `actual.png` is 1536×1024.

- [ ] **Step 3: Normalize only the approved shell-width mismatch**

The approved product contract keeps the real 220px sidebar, while the ImageGen reference rendered it at 285px. Create a comparison-only normalized actual by shifting the app-owned main area 65px right, and create a mask that includes the Projects main content from reference x=285, y=84 onward. Do not alter the shipped UI or mask the implemented list.

- [ ] **Step 4: Run visual diff**

Run:

```bash
/Users/starrblink/.agents/skills/implement-ui-design/scripts/visual-diff.swift \
  --reference .artifacts/image-reference/projects-list-a/reference.png \
  --actual .artifacts/visual-diff/projects-list-a/normalized-actual.png \
  --mask .artifacts/visual-diff/projects-list-a/main-content-mask.png \
  --output-dir .artifacts/visual-diff/projects-list-a
```

Use the default threshold first. Inspect both `diff.png` and `overlay.png`. If the generated reference's non-deterministic typography prevents the default gate, report the measured residual rather than weakening the gate silently.

- [ ] **Step 5: Iterate on code-owned differences**

Adjust only layout, token-based color, typography, and control sizing that the diff and runtime screenshot prove are wrong. Repeat focused tests, capture, and diff after every correction.

- [ ] **Step 6: Run final verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build:web
pnpm exec playwright test test/e2e/projects.spec.ts test/e2e/workspace-layout.spec.ts test/e2e/accessibility.spec.ts
```

Expected: all commands exit 0. If an unrelated pre-existing failure appears, report the exact command and failure without claiming a clean gate.
