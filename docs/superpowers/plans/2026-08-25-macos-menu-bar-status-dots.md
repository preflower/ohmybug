# macOS Menu Bar Task Status Dots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace trailing task-status descriptions in the native macOS menu with red, yellow, and blue leading status dots while preserving full-row navigation and the existing grouped, four-item layout.

**Architecture:** `tray-task-model.ts` owns the exhaustive Issue-status-to-indicator mapping and produces plain task labels. `tray-menu-controller.ts` stays Electron-independent through an injected generic icon resolver, while `main.ts` loads packaged non-template PNGs into `NativeImage` values. Asset and packaged-layout tests ensure all standard and Retina dot files ship.

**Tech Stack:** TypeScript, Electron native `Menu` and `NativeImage`, Vitest, Sharp, pnpm

---

### Task 1: Add semantic task indicators and plain labels

**Files:**
- Modify: `apps/desktop/src/electron/tray-task-model.ts`
- Test: `apps/desktop/test/electron/tray-task-model.test.ts`

- [ ] **Step 1: Write the failing model tests**

Import `classifyTrayIndicator`, split the attention statuses into `review` and `failure`, and add:

```ts
const review = ["ASSESSMENT_REVIEW", "PERMISSION_REQUIRED", "ACCEPTANCE_REVIEW"] as const;
const failure = [
  "ASSESSMENT_FAILED",
  "EVIDENCE_FAILED",
  "REPAIR_FAILED",
  "FINALIZATION_FAILED",
] as const;

it("maps every pending Issue status to a semantic indicator", () => {
  for (const status of review) expect(classifyTrayIndicator(status)).toBe("review");
  for (const status of failure) expect(classifyTrayIndicator(status)).toBe("failure");
  for (const status of processing) expect(classifyTrayIndicator(status)).toBe("processing");
  for (const status of terminal) expect(classifyTrayIndicator(status)).toBeNull();
});

it("builds a plain label and carries the semantic indicator", () => {
  const model = buildTrayTaskModel([
    issue("CHK-1", "ASSESSMENT_REVIEW", "2026-08-25T10:00:00.000Z", "Review checkout"),
  ]);
  expect(model.attention.items[0]).toMatchObject({
    label: "CHK-1 · Review checkout",
    indicator: "review",
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm --filter @oh-my-bug/desktop test -- tray-task-model.test.ts
```

Expected: FAIL because `classifyTrayIndicator` and `indicator` do not exist and the label still contains a trailing status.

- [ ] **Step 3: Implement the minimal model change**

Remove `issueStatusLabels` and add:

```ts
export type TrayTaskIndicator = "failure" | "review" | "processing";

export interface TrayTaskItem extends TrayIssue {
  label: string;
  indicator: TrayTaskIndicator;
}

const reviewStatuses = new Set<DesktopIssueStatus>([
  "ASSESSMENT_REVIEW",
  "PERMISSION_REQUIRED",
  "ACCEPTANCE_REVIEW",
]);
const failureStatuses = new Set<DesktopIssueStatus>([
  "ASSESSMENT_FAILED",
  "EVIDENCE_FAILED",
  "REPAIR_FAILED",
  "FINALIZATION_FAILED",
]);

export function classifyTrayIndicator(status: DesktopIssueStatus): TrayTaskIndicator | null {
  if (reviewStatuses.has(status)) return "review";
  if (failureStatuses.has(status)) return "failure";
  if (processingStatuses.has(status)) return "processing";
  return null;
}
```

Change visible item construction to:

```ts
items: ordered.slice(0, limit).map((issue) => ({
  ...issue,
  label: `${issue.identifier} · ${truncateTrayTitle(issue.title)}`,
  indicator: classifyTrayIndicator(issue.status)!,
})),
```

Keep sorting, grouping, truncation, the four-item limit, and overflow unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
pnpm --filter @oh-my-bug/desktop test -- tray-task-model.test.ts
```

Expected: all model tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/electron/tray-task-model.ts apps/desktop/test/electron/tray-task-model.test.ts
git commit -m "feat(desktop): classify tray task indicators"
```

### Task 2: Attach resolved icons to native task rows

**Files:**
- Modify: `apps/desktop/src/electron/tray-menu-controller.ts`
- Test: `apps/desktop/test/electron/tray-menu-controller.test.ts`

- [ ] **Step 1: Write failing icon and fallback tests**

Add stable icon tokens and inject the resolver from `setup`:

```ts
const icons = {
  failure: { name: "red" },
  review: { name: "yellow" },
  processing: { name: "blue" },
} as const;

resolveTaskIcon: vi.fn((indicator: keyof typeof icons) => icons[indicator]),
```

Update expected labels to `CHK-1 · Review checkout` and `CHK-2 · Repair checkout`, then assert:

```ts
expect(fixture.template[1]?.icon).toBe(icons.review);
expect(fixture.template[4]?.icon).toBe(icons.processing);
expect(fixture.options.resolveTaskIcon.mock.calls.map(([indicator]) => indicator)).toEqual([
  "review",
  "processing",
]);
```

Add the failure and fallback cases:

```ts
it("uses the failure icon without changing the row action", async () => {
  const fixture = setup(vi.fn(async () => [{ ...review, status: "REPAIR_FAILED" as const }]));
  await fixture.controller.open();
  expect(fixture.template[1]?.icon).toBe(icons.failure);
  fixture.template[1]?.click?.();
  expect(fixture.options.openIssue).toHaveBeenCalledWith("issue-1");
});

it("keeps a text-only task usable when no icon resolves", async () => {
  const fixture = setup();
  fixture.options.resolveTaskIcon.mockReturnValue(undefined);
  await fixture.controller.open();
  expect(fixture.template[1]?.icon).toBeUndefined();
  fixture.template[1]?.click?.();
  expect(fixture.options.openIssue).toHaveBeenCalledWith("issue-1");
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm --filter @oh-my-bug/desktop test -- tray-menu-controller.test.ts
```

Expected: FAIL because the controller has neither a generic `icon` field nor `resolveTaskIcon`.

- [ ] **Step 3: Implement the generic icon boundary**

Use the model's `TrayTaskIndicator` and update the interfaces:

```ts
export interface TrayMenuEntry<Icon = unknown> {
  label?: string;
  type?: "separator";
  enabled?: boolean;
  icon?: Icon;
  click?: () => void;
}

interface TrayMenuControllerOptions<Menu, Icon> {
  loadIssues(): Promise<TrayIssue[]>;
  resolveTaskIcon(indicator: TrayTaskIndicator): Icon | undefined;
  buildMenu(template: TrayMenuEntry<Icon>[]): Menu;
  popUp(menu: Menu): void;
  openIssue(issueId: string): void;
  openAll(): void;
  quit(): void;
}

export class TrayMenuController<Menu, Icon = unknown> {
  constructor(private readonly options: TrayMenuControllerOptions<Menu, Icon>) {}
}
```

Thread the resolver through `buildTaskArea` and `sectionEntries`. For each task row:

```ts
const icon = resolveTaskIcon(item.indicator);
return {
  label: item.label,
  ...(icon === undefined ? {} : { icon }),
  click: () => openIssue(item.id),
};
```

Preserve the existing load-error fallback and in-flight click suppression.

- [ ] **Step 4: Run the focused tests and verify GREEN**

```bash
pnpm --filter @oh-my-bug/desktop test -- tray-menu-controller.test.ts tray-task-model.test.ts
```

Expected: both files pass, including full-row actions, overflow, empty/error states, and rapid-click suppression.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/electron/tray-menu-controller.ts apps/desktop/test/electron/tray-menu-controller.test.ts
git commit -m "feat(desktop): add tray task status icons"
```

### Task 3: Create and package colored dot assets

**Files:**
- Create: `apps/desktop/assets/icons/tray-status-{failure,review,processing}.png`
- Create: `apps/desktop/assets/icons/tray-status-{failure,review,processing}@2x.png`
- Modify: `apps/desktop/scripts/copy-runtime-assets.ts`
- Modify: `apps/desktop/scripts/packaged-runtime.ts`
- Test: `apps/desktop/test/web/app-icon.test.ts`
- Test: `apps/desktop/test/electron/packaging.test.ts`
- Test: `apps/desktop/test/electron/packaged-runtime.test.ts`

- [ ] **Step 1: Write failing asset and packaging tests**

In `app-icon.test.ts`, verify all six files, their dimensions, transparency, and center colors:

```ts
it("ships standard and Retina non-template tray status dots", async () => {
  const colors = {
    failure: [0xd6, 0x5f, 0x6b],
    review: [0xd1, 0x9a, 0x3a],
    processing: [0x5d, 0x8f, 0xde],
  } as const;
  for (const [kind, rgb] of Object.entries(colors)) {
    for (const [suffix, size] of [["", 8], ["@2x", 16]] as const) {
      const path = resolve(desktopRoot, "assets/icons", `tray-status-${kind}${suffix}.png`);
      expect(existsSync(path)).toBe(true);
      const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height, info.channels]).toEqual([size, size, 4]);
      expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
      const center = ((Math.floor(size / 2) * size) + Math.floor(size / 2)) * 4;
      expect([...data.subarray(center, center + 3)]).toEqual([...rgb]);
      expect(data[center + 3]).toBe(255);
    }
  }
});
```

Add six expected paths to the exact `desktopBuildLayout` expectations in both Electron packaging tests.

- [ ] **Step 2: Run the tests and verify RED**

```bash
pnpm --filter @oh-my-bug/desktop test -- app-icon.test.ts packaging.test.ts packaged-runtime.test.ts
```

Expected: FAIL because the PNGs and layout entries do not exist.

- [ ] **Step 3: Generate the deterministic PNG assets**

```bash
node --input-type=module -e '
import sharp from "sharp";
const colors = { failure: "#D65F6B", review: "#D19A3A", processing: "#5D8FDE" };
for (const [kind, color] of Object.entries(colors)) {
  for (const [suffix, size] of [["", 8], ["@2x", 16]]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.375}" fill="${color}"/></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(`apps/desktop/assets/icons/tray-status-${kind}${suffix}.png`);
  }
}'
```

The filenames intentionally omit `Template`, so macOS preserves semantic colors.

- [ ] **Step 4: Copy and declare the six resources**

Add all six filenames to `copyDesktopAssets`. Add these entries to `desktopBuildLayout`:

```ts
trayStatusFailure: ".vite/build/apps/desktop/assets/icons/tray-status-failure.png",
trayStatusFailure2x: ".vite/build/apps/desktop/assets/icons/tray-status-failure@2x.png",
trayStatusReview: ".vite/build/apps/desktop/assets/icons/tray-status-review.png",
trayStatusReview2x: ".vite/build/apps/desktop/assets/icons/tray-status-review@2x.png",
trayStatusProcessing: ".vite/build/apps/desktop/assets/icons/tray-status-processing.png",
trayStatusProcessing2x: ".vite/build/apps/desktop/assets/icons/tray-status-processing@2x.png",
```

Use the same keys and paths in `packaging.test.ts` and the exact-object assertion in `packaged-runtime.test.ts`.

- [ ] **Step 5: Run the tests and verify GREEN**

```bash
pnpm --filter @oh-my-bug/desktop test -- app-icon.test.ts packaging.test.ts packaged-runtime.test.ts
```

Expected: selected tests pass, including size, alpha, semantic color, copy layout, and archive contract.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/assets/icons/tray-status-*.png apps/desktop/scripts/copy-runtime-assets.ts apps/desktop/scripts/packaged-runtime.ts apps/desktop/test/web/app-icon.test.ts apps/desktop/test/electron/packaging.test.ts apps/desktop/test/electron/packaged-runtime.test.ts
git commit -m "feat(desktop): package tray status dots"
```

### Task 4: Load the dots in Electron

**Files:**
- Modify: `apps/desktop/src/electron/main.ts`

- [ ] **Step 1: Run typecheck to capture the missing integration**

```bash
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: FAIL because `TrayMenuController` now requires `resolveTaskIcon`.

- [ ] **Step 2: Load non-template images once and inject the resolver**

Import `NativeImage` and `TrayTaskIndicator`, then add:

```ts
const trayStatusIconNames: Record<TrayTaskIndicator, string> = {
  failure: "tray-status-failure.png",
  review: "tray-status-review.png",
  processing: "tray-status-processing.png",
};

function loadTrayStatusIcons(): Partial<Record<TrayTaskIndicator, NativeImage>> {
  const icons: Partial<Record<TrayTaskIndicator, NativeImage>> = {};
  for (const indicator of Object.keys(trayStatusIconNames) as TrayTaskIndicator[]) {
    const image = nativeImage.createFromPath(fileURLToPath(
      new URL(`../../assets/icons/${trayStatusIconNames[indicator]}`, import.meta.url),
    ));
    if (!image.isEmpty()) icons[indicator] = image;
  }
  return icons;
}
```

Inside `createTray`, load once and add the resolver:

```ts
const taskIcons = loadTrayStatusIcons();
const menu = new TrayMenuController({
  loadIssues: () => supervisor!.client().request("listIssues", {}),
  resolveTaskIcon: (indicator) => taskIcons[indicator],
  buildMenu: (template) => Menu.buildFromTemplate(template),
  popUp: (nativeMenu) => currentTray.popUpContextMenu(nativeMenu),
  openIssue: (issueId) => openIssues({ issueId }),
  openAll: () => openIssues({}),
  quit: () => { void quitApplication(); },
});
```

Do not call `setTemplateImage(true)` on status dots. Keep it only on the branded top-level tray icon. Empty dot images resolve to `undefined`, leaving a usable text row.

- [ ] **Step 3: Run focused verification**

```bash
pnpm --filter @oh-my-bug/desktop test -- tray-task-model.test.ts tray-menu-controller.test.ts app-icon.test.ts packaging.test.ts packaged-runtime.test.ts
pnpm typecheck
pnpm build:electron
```

Expected: all focused tests pass, typecheck exits 0, and the Electron build contains all eight tray-related PNG files.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/electron/main.ts
git commit -m "feat(desktop): render colored tray task states"
```

### Task 5: Full regression and macOS acceptance

**Files:**
- Verify only; modify code only if an in-scope failure is discovered

- [ ] **Step 1: Run complete automated verification**

```bash
pnpm --filter @oh-my-bug/desktop test
pnpm typecheck
pnpm exec oxlint apps/desktop/src apps/desktop/test apps/desktop/scripts apps/desktop/forge.config.ts
pnpm build:desktop
pnpm doctor:package
git diff --check
git status --short
```

Expected: zero test failures; typecheck, targeted lint, build, and package doctor exit 0; diff check prints nothing; worktree is clean.

- [ ] **Step 2: Verify the native menu on macOS**

Launch the built app and verify:

1. the top-level menu-bar item still uses the branded monochrome template icon;
2. failure rows show red dots, review or permission rows show yellow dots, and processing rows show blue dots;
3. task labels contain only Issue ID and title, with no trailing status description;
4. each section still shows at most four tasks plus overflow;
5. clicking the dot, label, or remaining row area opens and selects the same Issue;
6. dots are sharp on Retina and readable in light and dark menu appearances.

- [ ] **Step 3: Record the clean completion state**

```bash
git log -6 --oneline
git status --short
```

Expected: design, plan, model, controller, assets, and integration commits are visible; worktree is clean.
