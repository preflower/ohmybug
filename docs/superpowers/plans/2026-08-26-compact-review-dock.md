# Compact Review Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized Issue review form with a one-row bottom action dock that expands only for feedback, response data, or complex review context.

**Architecture:** Keep the existing `IssueDetail → IssueActions → ReviewPanel` boundary and the existing Runtime submission contract. Convert `ReviewPanel` into a small local UI state machine with collapsed, composing, expanded, submitting, and error presentations; keep review-kind content in `review-renderers.tsx` and use the existing fixed grid row in `IssueDetail` so the dock never overlays evidence.

**Tech Stack:** React 19, TypeScript, Base UI primitives, lucide-react, CSS design tokens, Vitest + Testing Library, Playwright browser/Electron E2E.

---

## File Map

- Modify `apps/desktop/src/web/issues/review-panel.tsx`: own dock state, immediate actions, progressive composers, complex-choice expansion, submission, errors, and overflow cancellation.
- Modify `apps/desktop/src/web/issues/review-renderers.tsx`: expose compact Assessment/Delivery metadata separately from full complex review context.
- Modify `apps/desktop/src/web/styles/global.css`: replace stacked review-form styling with the compact dock and expandable composer styles; preserve responsive and 200% zoom behavior.
- Modify `apps/desktop/test/web/review-panel.test.tsx`: define the component interaction contract for Delivery, Assessment, conflict, busy, error, and cancellation states.
- Modify `apps/desktop/test/electron/e2e/manual-workflow.spec.ts`: replace radio-first Assessment interactions and assert compact Delivery dock geometry.
- Modify `test/e2e/manual-workflow.spec.ts`: assert evidence remains visible with the dock and keep the end-to-end acceptance path.
- Modify `apps/desktop/scripts/dev-browser-snapshot.ts` only if its deterministic fixture needs an additional choice description or response field to expose the final dock state; do not change Runtime semantics.

### Task 1: Lock the compact Delivery interaction with failing tests

**Files:**
- Modify: `apps/desktop/test/web/review-panel.test.tsx`

- [ ] **Step 1: Add a reusable Delivery fixture**

Add this fixture below the existing `issue` fixture:

```tsx
const deliveryIssue: IssueDto = {
  ...issue,
  repair: {
    iteration: 2,
    delivery: {
      summary: "Cancellation semantics now match the approved policy.",
      evidence: [{
        type: "screenshot",
        evidenceId: `sha256-${"a".repeat(64)}`,
        label: "Cancellation acceptance",
      }],
  },
  review: {
    id: "review-delivery-1",
    kind: "delivery",
    requestedFrom: "EVIDENCE_CHECK",
    payload: { repairIteration: 2, evidenceCount: 1 },
    choices: [{
      id: "accept",
      label: "接受交付",
      continuation: { operation: "FINALIZE", resumeStatus: "FINALIZING", resolution: "FIXED" },
    }, {
      id: "request-changes",
      label: "要求修改",
      feedbackRequired: true,
      continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
    }],
    requestedAt: timestamp,
  },
};
```

- [ ] **Step 2: Add failing tests for the collapsed row and immediate acceptance**

Add tests that assert the old selection form is absent and the explicit acceptance action submits without a second generic submit button:

```tsx
it("renders Delivery review as a collapsed action dock and accepts directly", async () => {
  const onSubmit = vi.fn(async () => undefined);
  render(<ReviewPanel issue={deliveryIssue} onSubmit={onSubmit} />);

  const dock = screen.getByRole("region", { name: "验收 Delivery" });
  expect(dock).toHaveAttribute("data-review-mode", "collapsed");
  expect(within(dock).getByText("迭代 2 · 1 项证据")).toBeVisible();
  expect(within(dock).getByText("接受后发布已验证 commit")).toBeVisible();
  expect(within(dock).queryByRole("radiogroup")).not.toBeInTheDocument();
  expect(within(dock).queryByLabelText(/补充说明/)).not.toBeInTheDocument();

  fireEvent.click(within(dock).getByRole("button", { name: "接受交付" }));
  await act(async () => undefined);
  expect(onSubmit).toHaveBeenCalledWith({
    expectedRevision: 12,
    requestId: "review-delivery-1",
    choiceId: "accept",
  });
});
```

- [ ] **Step 3: Add failing tests for the request-changes composer**

```tsx
it("expands feedback only for request changes and can return to the dock", () => {
  render(<ReviewPanel issue={deliveryIssue} onSubmit={async () => undefined} />);

  fireEvent.click(screen.getByRole("button", { name: "要求修改" }));
  expect(screen.getByRole("region", { name: "验收 Delivery" })).toHaveAttribute(
    "data-review-mode",
    "composing",
  );
  expect(screen.getByLabelText("修改说明（必填）")).toBeFocused();
  expect(screen.getByRole("button", { name: "提交修改要求" })).toBeDisabled();

  fireEvent.change(screen.getByLabelText("修改说明（必填）"), {
    target: { value: "Keep the close control visible on light images." },
  });
  expect(screen.getByRole("button", { name: "提交修改要求" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "返回审核操作" }));
  expect(screen.queryByLabelText("修改说明（必填）")).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "验收 Delivery" })).toHaveAttribute(
    "data-review-mode",
    "collapsed",
  );
});
```

- [ ] **Step 4: Run the focused tests and confirm the new assertions fail**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- review-panel.test.tsx
```

Expected: FAIL because `data-review-mode`, compact metadata, and the action-driven composer do not exist yet.

- [ ] **Step 5: Commit the failing tests**

```bash
git add apps/desktop/test/web/review-panel.test.tsx
git commit -m "test(desktop): define compact delivery review dock"
```

### Task 2: Implement the compact Delivery dock

**Files:**
- Modify: `apps/desktop/src/web/issues/review-panel.tsx`
- Modify: `apps/desktop/src/web/issues/review-renderers.tsx`

- [ ] **Step 1: Replace default choice selection with explicit dock state**

In `ReviewPanelContent`, replace the initial `choiceId` with an explicit mode and selected choice. Business conflicts and unknown kinds must start without a selected outcome:

```tsx
type ReviewMode = "collapsed" | "composing" | "expanded";

const [mode, setMode] = useState<ReviewMode>("collapsed");
const [choiceId, setChoiceId] = useState("");
const selected = useMemo(
  () => choices.find((choice) => choice.id === choiceId),
  [choiceId, choices],
);
```

Keep `feedback`, `choiceData`, `busy`, and `error` keyed by the persisted review through the existing `key={review.id}` boundary.

- [ ] **Step 2: Add compact review metadata helpers**

Export a compact metadata component from `review-renderers.tsx`:

```tsx
export function ReviewCompactContext({ issue }: { issue: IssueDto }) {
  const review = issue.review;
  if (!review) return null;
  const payload = record(review.payload) ?? {};

  if (review.kind === "delivery") {
    const iteration = payload.repairIteration ?? issue.repair?.iteration ?? "-";
    const evidenceCount = payload.evidenceCount ?? issue.repair?.delivery?.evidence.length ?? 0;
    return <>
      <strong>迭代 {String(iteration)} · {String(evidenceCount)} 项证据</strong>
      <span>接受后发布已验证 commit</span>
    </>;
  }

  if (review.kind === "assessment") {
    const verdict = text(payload.verdict) ?? issue.assessment?.verdict ?? "待确认";
    const revision = issue.assessment?.revision ?? "-";
    return <>
      <strong>{verdict} · Assessment {String(revision)}</strong>
      <span>批准后允许 Agent 修改 Issue 工作区并运行验证</span>
    </>;
  }

  if (review.kind === "business-merge-conflict") return <>
    <strong>业务行为冲突</strong>
    <span>选择最终语义后，Agent 将继续当前 Repair</span>
  </>;

  return <><strong>扩展审核</strong><span>展开上下文后选择明确操作</span></>;
}
```

Keep the existing full `ReviewRenderer` for expanded complex content. Remove only the duplicated Assessment/Delivery blocks after the dock consumes their compact metadata.

- [ ] **Step 3: Add action classification and submission helpers**

Inside `review-panel.tsx`, add helpers with the following behavior:

```tsx
function needsComposer(kind: string, choiceId: string, feedbackRequired?: boolean): boolean {
  return Boolean(feedbackRequired) || (kind === "assessment" && ["implement", "duplicate"].includes(choiceId));
}

function composerSubmitLabel(kind: string, choiceId: string, fallback: string): string {
  if (kind === "delivery" && choiceId === "request-changes") return "提交修改要求";
  return fallback;
}

function isComplexReview(kind: string): boolean {
  return kind === "business-merge-conflict" || !["assessment", "delivery"].includes(kind);
}
```

Change `submit` to accept the chosen id so immediate actions do not depend on a prior radio state:

```tsx
const submit = async (submittedChoiceId: string) => {
  const submittedChoice = choices.find((choice) => choice.id === submittedChoiceId);
  const submittedResponse = choiceData[submittedChoiceId] ?? defaultResponse(issue, review.kind, submittedChoiceId);
  if (!submittedChoice || (submittedChoice.feedbackRequired && !feedback.trim())) return;
  setBusy(true);
  setError("");
  try {
    await onSubmit({
      expectedRevision: issue.revision,
      requestId: review.id,
      choiceId: submittedChoice.id,
      ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
      ...(submittedResponse === undefined ? {} : { data: submittedResponse }),
    });
  } catch (caught) {
    setError(reviewErrorMessage(caught));
  } finally {
    setBusy(false);
  }
};
```

Extract the existing Assessment default response expression into `defaultResponse(issue, kind, choiceId)` without changing its title or duplicate behavior.

```tsx
function defaultResponse(
  issue: IssueDto,
  kind: string,
  choiceId: string,
): ReviewSubmissionInput["data"] {
  if (kind !== "assessment") return undefined;
  if (choiceId === "implement") {
    return { title: issue.assessment?.suggestedTitle ?? issue.title };
  }
  const duplicateCandidate = issue.assessment?.suspectedDuplicateOf?.trim();
  if (choiceId === "duplicate" && duplicateCandidate) {
    return { duplicateOf: duplicateCandidate };
  }
  return undefined;
}
```

- [ ] **Step 4: Render the one-row Delivery actions and composer**

Replace the stacked shell with this structure. Use `MoreHorizontal` for the overflow trigger and the existing Popover components for cancellation:

```tsx
<section
  aria-label={reviewTitle(review.kind)}
  className="review-dock"
  data-review-kind={review.kind}
  data-review-mode={busy ? "submitting" : mode}
>
  {mode === "composing" && selected ? <div className="review-composer">
    <ReviewResponseFields
      issue={issue}
      choiceId={choiceId}
      data={response}
      onDataChange={(next) => setChoiceData((current) => ({
        ...current,
        [choiceId]: next,
      }))}
    />
    {selected.feedbackRequired ? <label className="feedback-field">
      {review.kind === "delivery" ? "修改说明（必填）" : "补充说明（必填）"}
      <Textarea autoFocus disabled={busy} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
    </label> : null}
    <div className="review-composer-actions">
      <Button aria-label="返回审核操作" disabled={busy} type="button" variant="ghost" onClick={closeComposer}>取消</Button>
      <Button
        disabled={busy || !selected || missingRequiredData || Boolean(selected.feedbackRequired && !feedback.trim())}
        type="button"
        onClick={() => void submit(choiceId)}
      >
        {busy ? "提交中…" : composerSubmitLabel(review.kind, choiceId, selected.label)}
      </Button>
    </div>
  </div> : null}
  {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
  <div className="review-dock-row">
    <div className="review-dock-summary">
      <span className="approval-kicker">等待人工决定</span>
      <ReviewCompactContext issue={issue} />
    </div>
    <div className="review-dock-actions">
      {isComplexReview(review.kind) ? (
        <Button type="button" variant="secondary" onClick={() => setMode("expanded")}>选择处理方式</Button>
      ) : choices.map((choice) => (
        <Button
          disabled={busy}
          key={choice.id}
          type="button"
          variant={choice.id === "accept" || choice.id === "implement" ? "default" : "secondary"}
          onClick={() => openOrSubmit(choice)}
        >{choice.label}</Button>
      ))}
      {onCancel ? <ReviewOverflow disabled={busy} onCancel={onCancel} /> : null}
    </div>
  </div>
</section>
```

`openOrSubmit(choice)` sets `choiceId`; if `needsComposer(...)` is true it clears any stale error, sets `mode` to `composing`, and otherwise calls `submit(choice.id)`. `closeComposer()` clears the selected choice, feedback, and error, then returns to `collapsed`.

`ReviewOverflow` uses an icon-only `PopoverTrigger` with `aria-label="更多 Issue 操作"`, `side="top"`, and a `PopoverContent` containing `CancelIssueButton`. No new menu dependency is introduced.

Task 2 intentionally renders no expanded body yet. The `选择处理方式` trigger only changes mode; Task 3 adds the complete complex-review body before the full ReviewPanel suite is expected to pass.

- [ ] **Step 5: Run the Delivery component tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- review-panel.test.tsx
```

Expected: the new Delivery tests PASS; older radio-based tests may still fail until Task 3 updates their interaction contract.

- [ ] **Step 6: Commit the Delivery implementation**

```bash
git add apps/desktop/src/web/issues/review-panel.tsx apps/desktop/src/web/issues/review-renderers.tsx
git commit -m "feat(desktop): add compact delivery review dock"
```

### Task 3: Preserve Assessment and conflict review safety

**Files:**
- Modify: `apps/desktop/test/web/review-panel.test.tsx`
- Modify: `apps/desktop/src/web/issues/review-panel.tsx`

- [ ] **Step 1: Replace radio-based Assessment tests with composer tests**

Update the existing tests so `要求重新分析`, `确认为重复 Issue`, and `开始实现` are buttons that reveal only their required fields. Preserve these assertions:

```tsx
fireEvent.click(screen.getByRole("button", { name: "要求重新分析" }));
expect(screen.getByLabelText("补充说明（必填）")).toBeFocused();
expect(screen.getByRole("button", { name: "要求重新分析" })).toBeDisabled();

fireEvent.click(screen.getByRole("button", { name: "返回审核操作" }));
fireEvent.click(screen.getByRole("button", { name: "开始实现" }));
expect(screen.getByLabelText("Issue 标题")).toHaveValue("Checkout cancellation semantics");
expect(screen.queryByLabelText("补充说明（必填）")).not.toBeInTheDocument();
```

For the duplicate test, click the action button to open the composer, assert the `CHK-9` prefill, then click the same labeled primary action within `.review-composer` and verify only `{ duplicateOf: "CHK-9" }` is submitted.

- [ ] **Step 2: Change the business-conflict test to assert no preselection**

```tsx
expect(screen.queryByText("Keep the order pending when the gateway times out.")).not.toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "选择处理方式" }));
expect(screen.getByText("Keep the order pending when the gateway times out.")).toBeVisible();
expect(screen.getByRole("region", { name: "确认业务冲突处理" })).toHaveAttribute(
  "data-review-mode",
  "expanded",
);
expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
fireEvent.click(screen.getByRole("radio", { name: /保留 Issue 行为/ }));
expect(screen.getByRole("button", { name: "保留 Issue 行为" })).toBeEnabled();
```

Retain the existing exact submission, double-click suppression, and `提交中…` assertions.

- [ ] **Step 3: Add busy and error preservation assertions**

Add a rejection test:

```tsx
it("preserves the selected composer after a submission error", async () => {
  const onSubmit = vi.fn(async () => { throw new Error("审核提交失败"); });
  render(<ReviewPanel issue={deliveryIssue} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole("button", { name: "要求修改" }));
  fireEvent.change(screen.getByLabelText("修改说明（必填）"), {
    target: { value: "Use a darker close-button surface." },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交修改要求" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("审核提交失败");
  expect(screen.getByLabelText("修改说明（必填）")).toHaveValue(
    "Use a darker close-button surface.",
  );
});
```

Add coverage for low-emphasis cancellation and the safe unknown-kind fallback:

```tsx
it("keeps Issue cancellation in the dock overflow", () => {
  render(<ReviewPanel issue={deliveryIssue} onCancel={async () => undefined} onSubmit={async () => undefined} />);
  expect(screen.queryByRole("button", { name: "取消 Issue" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "更多 Issue 操作" }));
  expect(screen.getByRole("button", { name: "取消 Issue" })).toBeVisible();
});

it("expands bounded context before choosing an unknown review kind", () => {
  const extensionIssue: IssueDto = {
    ...issue,
    review: {
      ...issue.review!,
      id: "review-extension-1",
      kind: "extension-review",
      payload: { provider: "example", records: [1, 2, 3] },
    },
  };
  render(<ReviewPanel issue={extensionIssue} onSubmit={async () => undefined} />);
  expect(screen.queryByText("provider")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "选择处理方式" }));
  expect(screen.getByText("provider")).toBeVisible();
  expect(screen.getByText("example")).toBeVisible();
});
```

- [ ] **Step 4: Implement the expanded complex-choice block**

Render the existing `ReviewRenderer`, a radio group with no initial value, the selected choice description, and a footer submit action only inside `.review-dock-expanded`. The submit action label is `selected?.label ?? "提交审核"` and remains disabled until a choice exists and required data is valid. A `收起` ghost button clears `choiceId`, feedback, and errors before returning to the collapsed dock.

```tsx
{mode === "expanded" ? <div className="review-dock-expanded">
  <ReviewRenderer issue={issue} />
  <div className="review-choice-list">
    <span className="review-choice-legend">选择处理方式</span>
    <RadioGroup
      aria-label="选择处理方式"
      disabled={busy}
      name={`review-${review.id}`}
      value={choiceId}
      onValueChange={setChoiceId}
    >
      {choices.map((choice) => <label className="review-choice" key={choice.id}>
        <RadioGroupItem value={choice.id} />
        <span>
          {choice.label}
          {choiceDescription(review.payload, choice.id)
            ? <small>{choiceDescription(review.payload, choice.id)}</small>
            : null}
        </span>
      </label>)}
    </RadioGroup>
  </div>
  <div className="review-expanded-actions">
    <Button disabled={busy} type="button" variant="ghost" onClick={closeExpanded}>收起</Button>
    <Button disabled={busy || !selected} type="button" onClick={() => void submit(choiceId)}>
      {busy ? "提交中…" : selected?.label ?? "提交审核"}
    </Button>
  </div>
</div> : null}
```

Implement `closeExpanded` as:

```tsx
const closeExpanded = () => {
  setChoiceId("");
  setFeedback("");
  setError("");
  setMode("collapsed");
};
```

- [ ] **Step 5: Run all ReviewPanel tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- review-panel.test.tsx
```

Expected: all tests in `review-panel.test.tsx` PASS.

- [ ] **Step 6: Commit the complete interaction contract**

```bash
git add apps/desktop/test/web/review-panel.test.tsx apps/desktop/src/web/issues/review-panel.tsx
git commit -m "test(desktop): cover progressive review decisions"
```

### Task 4: Apply the compact visual layout

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css`

- [ ] **Step 1: Replace the old review shell styles**

Remove the obsolete `.review-panel`, full-width `.review-choice` collapsed-state rules, and large `.approval-panel` spacing from the review path. Keep business-conflict styles because they remain in the expanded area.

Add token-driven dock styles:

```css
.review-dock {
  display: grid;
  width: min(760px, 100%);
  margin: 0 auto;
  color: var(--text);
}

.review-dock-row {
  display: grid;
  min-height: 58px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
}

.review-dock-summary {
  display: grid;
  min-width: 0;
  grid-template-columns: auto auto;
  align-items: baseline;
  justify-content: start;
  gap: 3px 9px;
}

.review-dock-summary .approval-kicker {
  grid-column: 1 / -1;
}

.review-dock-summary strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-dock-summary > span:last-child {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-dock-actions,
.review-composer-actions,
.review-expanded-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
}

.review-composer,
.review-dock-expanded {
  display: grid;
  gap: 10px;
  border-bottom: 1px solid var(--border);
  padding: 12px 0;
}

.review-dock > .form-error {
  margin: 8px 0 0;
}

.review-overflow {
  min-width: 150px;
  padding: 6px;
}

.review-overflow [data-slot="button"] {
  width: 100%;
  justify-content: flex-start;
}
```

- [ ] **Step 2: Reduce the Issue action row itself**

Change `.issue-actions` from a scrollable large form tray to a bounded bottom row:

```css
.issue-actions {
  z-index: 2;
  display: grid;
  max-height: min(58vh, 620px);
  overflow: auto;
  border-top: 1px solid var(--border);
  background: var(--surface-raised);
  padding: 0 clamp(20px, 3.5vw, 36px);
  box-shadow: 0 -8px 20px rgb(0 0 0 / 8%);
}
```

The review dock receives no extra card border, radius, or nested surface. Keep non-review action panels working by giving `.issue-actions > .failure-actions` and `.issue-actions > .capability-request-panel` their existing vertical margin through targeted selectors.

- [ ] **Step 3: Add responsive behavior**

At `max-width: 900px`, let the dock become two rows without hiding choices:

```css
@media (max-width: 900px) {
  .review-dock-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    padding: 10px 0;
  }

  .review-dock-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
```

Do not add layout-property animation. Existing button focus styles and reduced-motion rules remain authoritative.

- [ ] **Step 4: Run typecheck and focused tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop typecheck
pnpm --filter @oh-my-bug/desktop test -- review-panel.test.tsx
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the layout**

```bash
git add apps/desktop/src/web/styles/global.css
git commit -m "style(desktop): compact the issue review dock"
```

### Task 5: Update the complete workflow tests

**Files:**
- Modify: `apps/desktop/test/electron/e2e/manual-workflow.spec.ts`
- Modify: `test/e2e/manual-workflow.spec.ts`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Replace Assessment radio interactions in Electron E2E**

Replace the old radio scroll-stability block with action-driven composer checks:

```tsx
await rootApproval.getByRole("button", { name: "要求重新分析" }).click();
await expect(rootApproval.getByLabel("补充说明（必填）")).toBeFocused();
await rootApproval.getByRole("button", { name: "返回审核操作" }).click();

await rootApproval.getByRole("button", { name: "确认为重复 Issue" }).click();
await expect(rootApproval.getByRole("textbox", { name: "重复 Issue" })).toBeVisible();
await rootApproval.getByRole("button", { name: "返回审核操作" }).click();

await rootApproval.getByRole("button", { name: "开始实现" }).click();
await expect(rootApproval.getByRole("textbox", { name: "Issue 标题" })).toBeVisible();
await rootApproval.getByRole("button", { name: "开始实现" }).click();
```

- [ ] **Step 2: Assert compact Delivery geometry and evidence reachability**

Before accepting in Electron E2E, add:

```tsx
const dockBounds = await acceptanceApproval.boundingBox();
expect(dockBounds).not.toBeNull();
expect(dockBounds!.height).toBeLessThanOrEqual(72);
await expect(acceptanceApproval.getByText(/迭代 1 · 2 项证据/)).toBeVisible();
await evidence.scrollIntoViewIfNeeded();
await expect(evidence).toBeVisible();
```

Capture `acceptance-review.png` without `fullPage: true` so the artifact proves the evidence and collapsed dock share the target viewport.

- [ ] **Step 3: Keep browser E2E aligned with the action contract**

In `test/e2e/manual-workflow.spec.ts`, retain direct `开始实现` and `接受交付` button actions. Add a dock height assertion and scroll the final evidence control into view before the acceptance screenshot:

```tsx
const acceptanceBounds = await acceptanceApproval.boundingBox();
expect(acceptanceBounds).not.toBeNull();
expect(acceptanceBounds!.height).toBeLessThanOrEqual(72);
await page.getByRole("button", { name: "播放 Checkout recording" }).scrollIntoViewIfNeeded();
```

- [ ] **Step 4: Update the App integration test only where accessible queries changed**

Keep its direct `接受交付` button click and exact `submitReview` payload assertion. Add an assertion that `radiogroup` is absent from the Delivery review region before the click.

- [ ] **Step 5: Run the web test suite and targeted browser workflow**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test
pnpm test:e2e -- test/e2e/manual-workflow.spec.ts
```

Expected: desktop Vitest suite PASS; browser manual workflow PASS and produces the updated acceptance artifact.

- [ ] **Step 6: Run the Electron workflow**

Run:

```bash
pnpm test:e2e:electron -- apps/desktop/test/electron/e2e/manual-workflow.spec.ts
```

Expected: PASS with the ReviewPanel action flow and evidence assertions.

- [ ] **Step 7: Commit workflow coverage**

```bash
git add apps/desktop/test/electron/e2e/manual-workflow.spec.ts test/e2e/manual-workflow.spec.ts apps/desktop/test/web/app-workbench.test.tsx
git commit -m "test(desktop): verify compact review workflow"
```

### Task 6: Visual QA and final verification

**Files:**
- Modify if defects are found: `apps/desktop/src/web/issues/review-panel.tsx`
- Modify if defects are found: `apps/desktop/src/web/issues/review-renderers.tsx`
- Modify if defects are found: `apps/desktop/src/web/styles/global.css`
- Keep uncommitted: `.artifacts/`

- [ ] **Step 1: Load the project design context and product reference**

Run the Impeccable context loader and read the product-register reference before visual refinement:

```bash
node /Users/starrblink/.agents/skills/impeccable/scripts/load-context.mjs
sed -n '1,320p' /Users/starrblink/.agents/skills/impeccable/reference/product.md
```

Expected: `PRODUCT.md` reports `register: product`; `DESIGN.md` is present.

- [ ] **Step 2: Generate the deterministic browser snapshot**

Use the repository's `dev-browser-snapshot.ts` fixture and normal Vite runtime to render the Delivery review. Store screenshots and diffs under `.artifacts/compact-review-dock/`; do not commit them.

Inspect at the default desktop viewport, 900 px width, and 200% zoom. Verify:

- the collapsed Delivery review is one row at desktop width;
- Assessment, Delivery summary, and evidence remain the main visual mass;
- the last evidence control is reachable;
- action labels never truncate;
- `要求修改` focuses the feedback textarea;
- the error row does not erase the entered feedback;
- light and dark themes keep WCAG AA contrast and visible focus.

- [ ] **Step 3: Run repository verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build:web
```

Expected: every command exits 0. If an unrelated pre-existing failure appears, record the exact command and output; do not hide or rewrite unrelated code.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~4..HEAD
```

Expected: no whitespace errors; only the files named in this plan plus the approved spec and plan are changed; `.artifacts/` remains uncommitted.

- [ ] **Step 5: Commit any visual-QA corrections**

If visual QA required code corrections:

```bash
git add apps/desktop/src/web/issues/review-panel.tsx apps/desktop/src/web/issues/review-renderers.tsx apps/desktop/src/web/styles/global.css
git commit -m "fix(desktop): polish compact review dock"
```

If no corrections were required, do not create an empty commit.
