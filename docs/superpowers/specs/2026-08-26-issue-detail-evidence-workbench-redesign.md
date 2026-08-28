# Issue Detail Evidence Workbench Redesign

**Date:** 2026-08-26  
**Status:** Approved visual direction, pending mockup generation

## Objective

Redesign the current Issue detail surface as a calm, evidence-first engineering workbench. The result is a high-fidelity raster UI mockup generated with the built-in ImageGen tool. It must preserve every current Issue detail region and operation while keeping mutually exclusive state actions out of the live main screen.

## Deliverable

Create one landscape design board in dark theme:

- the primary area shows a truthful desktop Issue detail screen in `REVIEW_REQUIRED` Delivery state;
- a clearly separated operation-state atlas on the same board documents the actions available in all other Issue states;
- the final image is saved under the project workspace without overwriting an existing asset;
- the design board is a product UI concept, not an implementation-ready screenshot and not a replacement for deterministic component specifications.

## Chosen Direction

Use an evidence-first split workbench. Preserve the existing desktop shell and its three working regions:

1. a compact Issue list pane;
2. a dominant Issue document and evidence workspace;
3. a collapsible metadata and Agent activity rail.

The main screen shows a Delivery awaiting human review because it exercises the richest normal evidence workflow without mixing incompatible lifecycle states. The bottom review dock stays continuously visible and compact. Other operations appear only in the adjacent state atlas.

## Physical Scene and Theme

An engineer is reviewing visual acceptance evidence on a 27-inch monitor in a dim evening workspace and needs failures, pending decisions, and code context to remain legible without glare. This requires the product's dark theme, restrained blue-violet accent, cool tinted neutrals, and semantic state colors.

## Main Screen Structure

### Application shell

- Use the existing quiet inverted-L shell, including the product sidebar and the `Issues` location header.
- Keep the Issue list compact and visibly selected through a modest surface lift, not a full accent fill.
- Give the detail document the highest surface contrast.
- Keep the metadata rail visually quieter than the evidence document and make its hide control discoverable.

### Issue document

Order the content as:

1. Issue identifier, status, title, latest input summary, occurrence count, and truthful failure or resolution messaging when applicable;
2. Assessment verdict, reasoning, root cause, solution, suspected duplicate when present, and Assessment revision context;
3. Delivery iteration, summary, branch/commit/remote context, and visual evidence;
4. a compact sticky review dock at the bottom of the detail viewport.

Use continuous document sections, spacing, alignment, and restrained one-pixel separators. Do not create a grid of nested cards.

### Evidence

- Show screenshot and recording evidence with preserved aspect ratios.
- Expose preview or play affordances with text and icons.
- Represent the focused evidence viewer controls in the state atlas: close, zoom out, zoom percentage, zoom in, reset view, and recording playback.
- Include bounded loading and unavailable-evidence states in the atlas without presenting them as successful evidence.

### Review dock

The main Delivery state uses an approximately 64px sticky dock with:

- `等待人工决定`;
- `迭代 2 · 3 项证据`;
- `接受后发布已验证 commit`;
- secondary action `要求修改`;
- primary action `接受交付`;
- overflow action `更多 Issue 操作`, containing `取消 Issue`.

The dock must not cover the final evidence item. It uses an opaque application surface and one top border, without a floating-card treatment or large shadow.

## Metadata and Activity Rail

Preserve:

- project;
- branch and `Worktree` marker;
- source;
- Issue status;
- Agent session identifier;
- `在 Terminal 中打开`, including its disabled and opening states;
- created and updated timestamps;
- collapsible chronological Agent activity with timestamps, concise event labels, expandable details, and bounded command output;
- `显示详情栏` and `隐藏详情栏` actions.

## Complete Operation-State Atlas

The atlas is documentation adjacent to the truthful main screen, not a set of simultaneously available controls. Group operations by state and retain the current user-facing labels.

### Assessment review

- `开始实现`;
- `要求重新分析`;
- contextual `确认为重复 Issue` only when the Agent supplied a candidate;
- edit confirmed Issue title;
- edit duplicate Issue target;
- required feedback composer where specified;
- `取消 Issue` through low-emphasis overflow.

### Delivery review

- `接受交付`;
- `要求修改`;
- `提交修改要求` with required feedback;
- composer `取消`;
- `取消 Issue` through low-emphasis overflow.

### Business merge conflict and extension review

- `选择处理方式`;
- `保留基线行为`;
- `保留 Issue 行为`;
- `收起`;
- bounded unknown-extension fallback and `提交审核` where no safer specific label exists;
- no preselected business outcome.

### Capability request

- display requested host execution or network capability, reason, blocked command, and requester;
- `授权并继续`;
- host-execution confirmation actions `返回` and `确认授权并继续`;
- `取消 Issue`.

### Active and paused execution

- active Agent operation: `暂停 Agent`;
- paused and ready: `继续执行` and `取消 Issue`;
- pause not yet ready: disabled `等待暂停完成` and enabled `取消 Issue`.

### Failure and recovery

- Assessment failure: `重试分析` and `取消 Issue`;
- Repair failure: `重试实现` and `取消 Issue`;
- evidence failure: `重试证据` and `取消 Issue`;
- finalization failure: `重新验证并修复` and `取消 Issue`;
- unavailable Agent session: `重建 Agent 会话` and `取消 Issue`;
- automatic finalization recovery remains informational while `暂停 Agent` is the available active control.

### Lifecycle and dialogs

- other interruptible non-terminal states: `取消 Issue`;
- cancel confirmation: `返回` and destructive `确认取消`;
- terminal and publishing states expose no Issue actions;
- busy labels remain truthful, including `提交中…`, `授权中…`, `暂停中…`, `继续中…`, `重试中…`, `重建中…`, `重新验证中…`, and `取消中…`;
- attached inline errors preserve the user's current state and inputs.

### Evidence viewer and rail actions

- evidence `预览` and `播放`;
- viewer `关闭预览`, `缩小`, `放大`, and `重置视图`;
- visible zoom percentage;
- metadata `显示详情栏` and `隐藏详情栏`;
- `在 Terminal 中打开` and its unavailable-reason tooltip.

## Visual System

- Register: product.
- Color strategy: restrained, with the blue-violet accent occupying less than 10% of the surface.
- Use the current Oh My Bug ?! semantic dark tokens as the visual reference: dark canvas, sidebar, surface, raised surface, hover surface, borders, text tiers, accent, success, warning, danger, and info.
- Use Inter Variable with the system stack fallback. Technical identifiers, Git refs, commands, paths, and timestamps use a compact monospace face.
- Use a 4px spacing base, 30–32px dense controls, 4–8px control radii, 8px review surfaces, and 14–16px line icons with consistent stroke weight.
- Use sentence case and the existing Chinese labels. Color is never the only status signal.
- Avoid gradients, glass effects, glow, decorative shadows, oversized typography, ambient decoration, copied Linear branding, and ambiguous standalone confirmation labels.

## Accessibility and Responsive Intent

- Preserve WCAG AA contrast for text and controls.
- Make keyboard focus visible and maintain logical focus order.
- Pair semantic icons with text or accessible names.
- Keep actions operable at 200% zoom; allow dock actions to wrap rather than truncate.
- Below 1200px, collapse the metadata rail behind its toggle. Below 960px, navigate between Issue list and detail rather than compressing all columns.
- Increase compact controls to at least 40px for coarse pointers.

## ImageGen Prompt Requirements

Use the `ui-mockup` taxonomy. Request a high-fidelity, professional desktop product design board, not a marketing scene or device mockup. Ask for exact Chinese operation labels, crisp 1x UI rendering, restrained dark surfaces, and a visually dominant evidence document. Explicitly prohibit gibberish, fake logos, gradients, glass, glow, oversized cards, decorative charts, and impossible mixed-state controls inside the main screen.

The main screen must read as a real Delivery review state. The operation-state atlas must be visibly labeled as a state reference so it cannot be mistaken for controls simultaneously available in the main screen.

## Validation

After generation, inspect the image for:

- correct three-region hierarchy and compact density;
- truthful Delivery state in the main screen;
- presence of Assessment, Delivery, branch, evidence, review dock, metadata, Terminal, and Agent activity regions;
- coverage of every operation group listed above;
- readable, non-gibberish primary Chinese labels;
- correct restrained palette and absence of prohibited visual effects;
- no implication that mutually exclusive lifecycle actions are simultaneously available.

If the first output misses a required region or materially corrupts key labels, iterate once with a targeted correction while preserving the approved layout and style.
