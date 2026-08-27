# Issue Detail Lean Stage Cards

Date: 2026-08-27

## Goal

Redesign the Oh My Bug Issue detail page with four lightweight stage cards—Assessment, Execution, Evidence, and Delivery—while removing redundant state labels, counts, explanatory headings, and nested cards. The detail page presents content only; the outer application already communicates the current Issue state.

## Core principle

Use one card per semantic stage, not one card per content fragment. A stage card establishes grouping; its interior remains flat and minimal.

The Issue detail page must not repeat the current workflow state. Do not add progress bars, step nodes, status chips, completed or pending labels, stage counts, or other state indicators.

## Page architecture

The desktop detail workspace contains:

1. Issue header in the main column.
2. Four stage cards in the main column.
3. Existing narrow metadata rail on the right.
4. Existing fixed action bar at the bottom.

The global application sidebar and Issue list are outside the generated concept-image scope.

## Issue header

Show only:

- Issue ID
- Issue title
- Concise problem description

Do not add a status banner, stage indicator, progress component, summary statistics, or decorative metadata to the header.

## Assessment card / 评估

Show:

- Verdict, such as “是 Bug”
- Bug root cause
- Proposed solution

Remove:

- Assessment confirmation state
- “Assessment result” wrapper heading
- Revision number
- Review-state label
- Repeated reasoning or impact headings when the body already explains them

## Execution card / 执行

Show:

- One or two concise sentences describing the implementation
- Changed-file rows
- Additions and deletions

Remove:

- “Implementation complete” state
- Execution progress or success labels
- Agent activity details duplicated from the metadata rail
- Additional containers around the implementation summary or file list

## Evidence card / 证据

Show:

- One direct verification conclusion, such as “内容较少时 Footer 已贴底，内容较多时滚动正常。”
- Evidence screenshots or recordings directly beneath the conclusion

Remove:

- “4 items of evidence” or any evidence count
- “Verification result” heading
- Verification passed state chip
- Evidence acceptance, pending, retry, or current-stage state
- A nested gallery card around the thumbnails

Each thumbnail may keep its own thin border and short descriptive caption because the media requires a visible boundary.

## Delivery card / 交付

Show:

- Concise delivery description
- Target branch
- Issue commit or commit summary

Remove:

- Pending-delivery state
- Acceptance-state label
- Close-Issue status
- Repeated evidence or verification summary

## Metadata rail

Keep:

- Project
- Branch and Worktree
- Source
- Agent session
- Open in Terminal
- Created time
- Updated time
- Collapsed Agent activity entry and event count

Remove the Issue status field from the detail rail because the outer application already provides the authoritative state.

## Fixed action bar

Keep the actual currently available actions directly visible, such as Cancel Issue, Retry, and the violet primary confirmation action. Do not add helper text, stage descriptions, or duplicate state labels to the action bar.

## Visual system

- Use the current Oh My Bug light desktop design system exactly.
- Cards use the existing white surface, subtle gray border, approximately 8 px radius, and no decorative shadow.
- Use approximately 12 px between stage cards and 8–12 px internal spacing.
- Card headers contain only the Chinese stage name: 评估, 执行, 证据, 交付.
- Do not add stage numbers, English subtitles, icons, status chips, progress nodes, colored header fills, or decorative accents.
- Do not nest rounded cards, filled panels, or boxed content inside stage cards.
- Use text hierarchy, rows, dividers, and whitespace inside each card.
- Assessment, Execution, and Delivery remain compact. Evidence may be taller because screenshots are primary content.
- Violet is reserved for actual interactive controls and the primary action.
- Use no gradients, glow, glass, atmospheric background, oversized headings, fake branding, or yellow review styling.

## Image deliverable

Generate one 1440×960 high-fidelity desktop concept image:

- `docs/design/issue-detail-lean-stage-cards.png`

The image shows only the selected Issue detail workspace, right metadata rail, and fixed bottom action bar.

## Acceptance criteria

- Exactly four top-level stage cards appear in the main column.
- No stage card contains another card.
- No workflow state, completion label, pending label, progress indicator, or evidence count appears anywhere in the detail page.
- The Issue header contains only ID, title, and description.
- Assessment contains only verdict, root cause, and solution.
- Execution contains only implementation summary and changed files.
- Evidence contains one conclusion and the media directly beneath it.
- Delivery contains only delivery description, branch, and commit summary.
- The metadata rail omits the Issue status field.
- Existing bottom actions remain visible without helper copy.
- The result is immediately recognizable as the current Oh My Bug product.
