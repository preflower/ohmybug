# Issue Detail Four Variants ImageGen Prompts

## Shared contract

```text
Use case: ui-mockup
Asset type: high-fidelity desktop Issue detail page concept
Primary request: redesign only the Oh My Bug Issue detail page for a truthful Delivery REVIEW_REQUIRED state. The image must be the interface itself, edge to edge, with no application sidebar, no Issue list, no external state atlas, no browser chrome, no physical monitor, and no marketing frame.
Scenario: CHK-42, title "修复证据预览偶发空白", status "等待交付验收". The engineer must inspect Assessment reasoning and three visual evidence items before deciding whether to accept Delivery.
Exact primary labels: "CHK-42", "修复证据预览偶发空白", "等待交付验收", "评估结果 · Assessment", "判断：是 Bug", "Bug 原因", "解决方案", "Delivery · 迭代 2", "交付分支", "3 项证据", "截图 1", "截图 2", "录屏 1", "等待人工决定", "迭代 2 · 3 项证据", "接受后发布已验证 commit", "要求修改", "接受交付", "更多 Issue 操作", "项目", "分支", "Worktree", "来源", "Agent 会话", "在 Terminal 中打开", "创建时间", "更新时间", "Agent 活动"
Content: Issue identifier, title, status, concise input summary, occurrence context; Assessment verdict, reasoning, root cause, solution, revision; Delivery summary, branch, commit; two screenshot previews and one recording preview with play affordance; project/source/Worktree/session/Terminal/timestamps; chronological Agent activity; compact human review controls.
Style/medium: shippable production-grade dark product UI, calm, precise, trustworthy, compact expert density, crisp 1x rendering, not concept art
Physical scene: an engineer reviews evidence on a large monitor in a dim evening workspace, so use the product dark theme without glare
Color palette: restrained cool tinted near-black neutrals; blue-violet interactive accent under 10%; truthful success, warning, danger, and info colors; no pure black or pure white
Typography: Inter or native system sans; compact monospace for Issue ID, Git refs, paths, session, commit, commands, and timestamps
Component rules: 4px spacing base; 30–32px controls; 4–8px radii; 14–16px line icons; one-pixel separators; continuous document structure instead of nested cards; opaque review dock; text and icons together for state
Constraints: one truthful Delivery review state only; preserve Assessment, Delivery, evidence, metadata, Agent activity access, and review actions; "要求修改" is secondary and "接受交付" is the sole blue-violet primary action; no mutually exclusive lifecycle actions; no standalone ambiguous "确认"; primary Chinese labels rendered verbatim and readable
Avoid: application sidebar, Issue list, external operation atlas, gibberish primary labels, fake logos, gradients, glassmorphism, glow, large shadows, oversized cards, card grid, decorative charts, marketing copy, chatbot layout, copied Linear branding, device mockup, watermark
```

## Prompt 1A

```text
Direction: classic continuous document.
Composition/framing: landscape Issue detail page only. Use a wide main document plus a permanent 280px metadata and Agent activity rail on the right. The main document reads vertically from compact Issue header, to fully expanded Assessment, to Delivery branch and commit context, to a two-column evidence gallery. Give the recording a deliberate wide slot. Anchor an opaque 64px review dock to the bottom of the main document viewport without covering evidence.
Hierarchy: title and status are compact; Assessment is fully readable and comes before evidence; Delivery and visual evidence receive the strongest content contrast; metadata and completed Agent activity recede.
Review dock exact text: "等待人工决定", "迭代 2 · 3 项证据", "接受后发布已验证 commit", "要求修改", "接受交付" plus icon-only overflow for "更多 Issue 操作".
Distinctive requirement: this must look like a refined engineering document, not a dashboard and not a split-screen media viewer.
```

## Prompt 1B

```text
Direction: evidence-weighted continuous document.
Composition/framing: landscape Issue detail page only. Use a dense single-line technical header containing CHK-42, title, status, branch, and commit. Below it, show Assessment as one compact verdict strip with concise expandable summaries for reasoning, Bug 原因, and 解决方案. Move the Delivery evidence gallery above the long Assessment detail and give it approximately 60% of visible document height. Keep a quiet permanent 280px metadata and Agent activity rail on the right. Anchor the same opaque 64px review dock to the bottom.
Hierarchy: the first visible scan path is header -> Delivery evidence -> compact Assessment summaries -> human decision. Evidence thumbnails are larger than in 1A while the document remains vertically scrollable.
Review dock exact text: "等待人工决定", "迭代 2 · 3 项证据", "接受后发布已验证 commit", "要求修改", "接受交付" plus icon-only overflow.
Distinctive requirement: visibly denser and more evidence-forward than 1A, but still a continuous document, not a 38/62 split workspace.
```

## Prompt 2A

```text
Direction: side-by-side evidence inspection desk.
Composition/framing: landscape Issue detail page only. Divide the internal workspace into a 38% left decision column and a 62% right evidence stage. The left column contains compact Issue context, fully readable Assessment, Delivery summary, branch, commit, and compact project/source/Worktree/session metadata. Agent 活动 is a collapsed chronological section at the bottom of the left column. The right stage contains one large selected screenshot, a clearly labeled horizontal filmstrip with 截图 1, 截图 2, and 录屏 1, plus a play icon on the recording. Anchor the review dock to the bottom of the right evidence stage.
Hierarchy: the selected evidence is the largest object on the page. The decision column remains readable without cards. Metadata uses quiet key/value rows.
Review dock exact text: "等待人工决定", "迭代 2 · 3 项证据", "接受后发布已验证 commit", "要求修改", "接受交付" plus icon-only overflow.
Distinctive requirement: the 38/62 vertical split must be unmistakable; do not revert to a full-width document with a narrow metadata rail.
```

## Prompt 2B

```text
Direction: stacked immersive evidence inspection desk.
Composition/framing: landscape Issue detail page only. Use a compact full-width top decision band containing CHK-42, title, status, Assessment verdict, Delivery summary, branch, commit, and essential project/Worktree/session metadata. Below it, use a large edge-to-edge evidence canvas occupying most of the page. Place a narrow vertical thumbnail rail inside the evidence region for 截图 1, 截图 2, and 录屏 1, with the selected screenshot filling the remaining canvas. Provide a quiet right-edge trigger labeled "Agent 活动" that implies a collapsible activity drawer without consuming permanent width. Anchor a full-width opaque review dock to the bottom, clearly separate from evidence-viewer controls.
Hierarchy: the evidence canvas has the greatest horizontal and vertical area of all four concepts. The top decision band stays compact and persistent. The activity drawer remains closed.
Review dock exact text: "等待人工决定", "迭代 2 · 3 项证据", "接受后发布已验证 commit", "要求修改", "接受交付" plus icon-only overflow.
Distinctive requirement: unmistakable stacked top-band / immersive-canvas / bottom-dock geometry; no permanent right metadata rail and no 38/62 side-by-side decision column.
```

## Validation matrix

| Variant | Required geometry | Evidence treatment | Metadata/activity treatment |
| --- | --- | --- | --- |
| 1A | Vertical document + 280px right rail | Two-column gallery after expanded Assessment | Permanent right rail |
| 1B | Dense continuous document + 280px right rail | Large gallery before long Assessment detail | Quieter permanent right rail |
| 2A | 38/62 left decision/right evidence split | One large selected image + horizontal filmstrip | Compact metadata and collapsed activity in left column |
| 2B | Full-width top band + canvas + bottom dock | One immersive selected image + vertical thumbnails | Essential metadata in top band, activity drawer closed |

Every variant must contain only the Issue detail page, one truthful Delivery review, readable core actions, and no prohibited visual effects.
