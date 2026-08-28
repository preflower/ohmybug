# Issue Detail Evidence Workbench Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, verify, and save one high-fidelity ImageGen design board for the approved Issue detail evidence workbench redesign.

**Architecture:** The approved specification is converted into one structured `ui-mockup` prompt. The built-in ImageGen tool produces the raster design board, visual inspection checks the truthful main Delivery state and the complete state atlas, and the selected output is copied into the repository with a non-destructive versioned filename.

**Tech Stack:** Built-in ImageGen tool, Codex image viewer, PNG artifact, Git

---

## File Structure

- Create: `docs/design/issue-detail-evidence-workbench-imagegen-prompt.md` — records the exact final prompt and validation checklist.
- Create: `docs/design/issue-detail-evidence-workbench-v1.png` — final approved project-bound visual artifact.
- Read: `docs/superpowers/specs/2026-08-26-issue-detail-evidence-workbench-redesign.md` — approved source of truth.

### Task 1: Freeze the production ImageGen prompt

**Files:**
- Create: `docs/design/issue-detail-evidence-workbench-imagegen-prompt.md`
- Read: `docs/superpowers/specs/2026-08-26-issue-detail-evidence-workbench-redesign.md`

- [ ] **Step 1: Create the prompt record**

Write the structured prompt with these exact sections:

```text
Use case: ui-mockup
Asset type: high-fidelity desktop product UI redesign board
Primary request: Redesign Oh My Bug ?!'s current Issue detail as an evidence-first engineering workbench. Show one truthful Delivery REVIEW_REQUIRED main screen plus a separately labeled operation-state atlas covering all other current actions.
Scene/backdrop: crisp 1x desktop application UI on a 27-inch engineering monitor in a dim evening workspace; render the interface itself, not a physical monitor or marketing scene
Style/medium: production-grade dark product UI, calm, precise, trustworthy, compact expert density
Composition/framing: landscape design board; dominant full desktop screen with quiet inverted-L shell, compact Issue list, wide evidence document, 280px metadata and Agent activity rail, sticky 64px review dock; a clearly separated state-reference atlas beside or beneath the main screen
Color palette: restrained cool tinted dark neutrals; blue-violet interactive accent under 10%; truthful success, warning, danger, and info states
Typography: Inter or native system sans; compact monospace for Issue IDs, Git refs, commands, paths, sessions, and timestamps
Main screen exact text: "Issues", "当前 Issues", "CHK-42", "修复证据预览偶发空白", "等待交付验收", "评估结果 · Assessment", "判断：是 Bug", "Bug 原因", "解决方案", "Delivery · 迭代 2", "交付分支", "迭代 2 · 3 项证据", "接受后发布已验证 commit", "要求修改", "接受交付", "更多 Issue 操作", "详情", "项目", "分支", "Worktree", "来源", "状态", "Agent 会话", "在 Terminal 中打开", "创建时间", "更新时间", "Agent 活动"
State atlas exact action labels: "开始实现", "要求重新分析", "确认为重复 Issue", "提交修改要求", "选择处理方式", "保留基线行为", "保留 Issue 行为", "收起", "授权并继续", "返回", "确认授权并继续", "暂停 Agent", "继续执行", "等待暂停完成", "重试分析", "重试实现", "重试证据", "重新验证并修复", "重建 Agent 会话", "取消 Issue", "确认取消", "预览", "播放", "关闭预览", "缩小", "放大", "重置视图", "显示详情栏", "隐藏详情栏"
Constraints: main screen must remain a single truthful Delivery review state; keep Assessment, Delivery, visual evidence, branch, review dock, metadata, Terminal action, and Agent activity visible; operation atlas is labeled "操作状态总览 · 非同时可用"; use continuous document sections, spacing, alignment, small radii, and one-pixel separators; no mutually exclusive actions inside the live main screen; no standalone ambiguous "确认"
Avoid: gibberish primary labels, fake logos, gradients, glassmorphism, glow, large shadows, oversized cards, decorative charts, marketing copy, chatbot layout, copied Linear branding, device mockup, impossible mixed-state controls, watermark
```

- [ ] **Step 2: Add the validation checklist**

Append this checklist below the prompt:

```markdown
## Validation

- Main screen is visibly one Delivery `REVIEW_REQUIRED` state.
- Issue list, detail document, and metadata rail form the primary three-region hierarchy.
- Assessment, Delivery, branch, screenshots or recording, and sticky review dock are visible.
- Project, Worktree, source, state, Agent session, Terminal, timestamps, and Agent activity are visible.
- The atlas is labeled `操作状态总览 · 非同时可用`.
- Every action group from the approved spec is represented.
- Primary Chinese labels are readable enough to identify the intended action.
- Blue-violet is restrained and semantic colors remain truthful.
- There are no gradients, glass effects, glow, decorative dashboard charts, or nested-card grid.
```

- [ ] **Step 3: Check the prompt record**

Run:

```bash
rg -n "Use case: ui-mockup|操作状态总览 · 非同时可用|Avoid:|## Validation" docs/design/issue-detail-evidence-workbench-imagegen-prompt.md
```

Expected: all four required markers are found.

### Task 2: Generate and inspect the design board

**Files:**
- Read: `docs/design/issue-detail-evidence-workbench-imagegen-prompt.md`
- Create: `docs/design/issue-detail-evidence-workbench-v1.png`

- [ ] **Step 1: Generate the first visual**

Call the built-in ImageGen tool once with the full structured prompt from Task 1. Do not use the CLI fallback and do not request an output path from the generator.

Expected: ImageGen returns one landscape high-fidelity UI mockup and a generated-image file reference.

- [ ] **Step 2: Inspect the generated image**

Open the generated output with the image viewer at original detail and compare it with every item in the prompt record's validation checklist.

Expected: the main screen remains a truthful Delivery review; all mandatory regions exist; the state atlas is visibly separate; no prohibited visual style dominates.

- [ ] **Step 3: Make one targeted correction if required**

If a mandatory region is missing or a key operation group is absent, call ImageGen edit once with the first output included and this invariant:

```text
Preserve the approved dark evidence-first layout, three-region hierarchy, restrained blue-violet palette, and truthful Delivery review main screen. Change only the missing or materially incorrect region identified during inspection. Keep the operation atlas labeled as non-simultaneous state reference. Do not add gradients, glass, glow, oversized cards, or mixed-state actions to the main screen.
```

Expected: the corrected output fixes the named defect without rearranging approved regions.

- [ ] **Step 4: Save the selected output in the workspace**

Copy the selected ImageGen output to:

```text
docs/design/issue-detail-evidence-workbench-v1.png
```

If that filename already exists, use the next free version such as `issue-detail-evidence-workbench-v2.png`; never overwrite an existing artifact.

- [ ] **Step 5: Verify the saved artifact**

Run:

```bash
file docs/design/issue-detail-evidence-workbench-v1.png
git status --short docs/design/issue-detail-evidence-workbench-v1.png docs/design/issue-detail-evidence-workbench-imagegen-prompt.md
```

Expected: `file` identifies a PNG image and Git reports only the planned prompt and image artifacts as new files.

### Task 3: Commit and hand off the visual

**Files:**
- Create: `docs/design/issue-detail-evidence-workbench-imagegen-prompt.md`
- Create: `docs/design/issue-detail-evidence-workbench-v1.png`

- [ ] **Step 1: Check repository hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the planned prompt and PNG are uncommitted.

- [ ] **Step 2: Commit the visual artifacts**

Run:

```bash
git add docs/design/issue-detail-evidence-workbench-imagegen-prompt.md docs/design/issue-detail-evidence-workbench-v1.png
git commit -m "docs: add issue detail redesign visual"
```

Expected: one commit containing the prompt record and final PNG.

- [ ] **Step 3: Present the final artifact**

Render the saved PNG inline and report:

- the absolute clickable image path;
- the absolute clickable prompt-record path;
- that the built-in ImageGen mode was used;
- whether one targeted correction was required;
- the final commit identifier.
