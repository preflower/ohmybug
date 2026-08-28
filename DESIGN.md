---
version: alpha
name: Oh My Bug ?! Console
description: "A calm, dense local engineering console. Quiet neutral surfaces keep attention on root-cause evidence, agent progress, visual evidence, and explicit approval decisions. The system is inspired by Linear's hierarchy and interaction discipline while using an original blue-violet accent and workflow-specific components."
colors:
  accent: "#716BFF"
  accent-hover: "#817CFF"
  accent-pressed: "#625CE8"
  accent-soft: "#716BFF1A"
  on-accent: "#FFFFFF"
  focus: "#8D88FF"
  dark-canvas: "#111115"
  dark-sidebar: "#0D0D11"
  dark-surface: "#17171C"
  dark-surface-raised: "#1D1D24"
  dark-surface-hover: "#24242D"
  dark-border: "#292932"
  dark-border-strong: "#3A3A46"
  dark-text: "#F2F2F5"
  dark-text-secondary: "#AAAAB4"
  dark-text-muted: "#74747F"
  light-canvas: "#F7F7F8"
  light-sidebar: "#F0F0F2"
  light-surface: "#FFFFFF"
  light-surface-raised: "#FBFBFC"
  light-surface-hover: "#EFEFF3"
  light-border: "#E2E2E7"
  light-border-strong: "#CDCDD5"
  light-text: "#1D1D22"
  light-text-secondary: "#5F5F69"
  light-text-muted: "#898994"
  success: "#45A978"
  success-soft: "#45A9781A"
  warning: "#D19A3A"
  warning-soft: "#D19A3A1A"
  danger: "#D65F6B"
  danger-soft: "#D65F6B1A"
  info: "#5D8FDE"
  info-soft: "#5D8FDE1A"
  overlay: "#00000099"
typography:
  page-title:
    fontFamily: Inter Variable, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif
    fontSize: 20px
    fontWeight: 590
    lineHeight: 1.25
    letterSpacing: -0.3px
  panel-title:
    fontFamily: Inter Variable, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif
    fontSize: 15px
    fontWeight: 560
    lineHeight: 1.35
    letterSpacing: -0.1px
  body:
    fontFamily: Inter Variable, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-strong:
    fontFamily: Inter Variable, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif
    fontSize: 14px
    fontWeight: 540
    lineHeight: 1.5
    letterSpacing: 0
  ui:
    fontFamily: Inter Variable, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0
  caption:
    fontFamily: Inter Variable, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  mono:
    fontFamily: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  full: 9999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 32px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.ui}"
    rounded: "{rounded.sm}"
    padding: 0 12px
    height: 30px
  button-secondary-dark:
    backgroundColor: "{colors.dark-surface-raised}"
    textColor: "{colors.dark-text}"
    typography: "{typography.ui}"
    rounded: "{rounded.sm}"
    padding: 0 10px
    height: 30px
  button-secondary-light:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-text}"
    typography: "{typography.ui}"
    rounded: "{rounded.sm}"
    padding: 0 10px
    height: 30px
  input-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 0 10px
    height: 32px
  input-light:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 0 10px
    height: 32px
  nav-item:
    typography: "{typography.ui}"
    rounded: "{rounded.sm}"
    padding: 0 8px
    height: 30px
  issue-row:
    typography: "{typography.ui}"
    rounded: "{rounded.xs}"
    padding: 0 12px
    height: 36px
  status-chip:
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 7px
  approval-panel:
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 16px
  review-panel:
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 16px
---

# Oh My Bug ?! Design Contract

## Overview

Oh My Bug ?! should feel like a focused engineering instrument: fast, composed, precise, and trustworthy. It handles dangerous actions, so hierarchy and state clarity matter more than decoration.

The interface borrows Linear's discipline—dense navigation, restrained color, quiet chrome, consistent headers, and keyboard efficiency—but not its identity. Do not use Linear logos, proprietary fonts, exact brand colors, marketing layouts, or copied illustrations.

The central design rule is **earned attention**. The current Assessment or Delivery, an active failure, or a pending approval may be prominent. Navigation, metadata, and completed background activity should recede.

## Colors

### Theme construction

Dark is the default. Light follows the operating-system preference unless the user overrides it. Components consume semantic CSS variables such as `--canvas`, `--surface`, `--text`, and `--border`; they must not choose dark or light token values directly.

Dark surfaces rise by luminance:

```text
dark-sidebar < dark-canvas < dark-surface < dark-surface-raised < dark-surface-hover
```

Light surfaces use the inverse relationship while preserving the same semantic names. Use thin borders only when a surface change and spacing are insufficient.

### Accent and status

- `{colors.accent}` is the sole interactive accent. Reserve it for the primary action, focus, active progress, and selected navigation.
- Never fill large panels with the accent.
- Success, warning, danger, and info colors communicate real state. They are not decoration or project-label colors.
- Prefer a small status dot, icon, or text treatment. Use the `*-soft` token for a restrained chip or callout background.
- Approval actions use the accent; rejecting or canceling uses a neutral secondary action unless the action is destructive.

### Contrast

Normal text and interactive controls must meet WCAG AA contrast. Muted text may be low emphasis but must remain legible. Disabled controls reduce both contrast and affordance and cannot be the only representation of required information.

## Typography

Inter Variable is the preferred open font. The system stack is a required fallback so the local console renders immediately without a network font request.

- Page titles use `{typography.page-title}` only. Avoid marketing-scale display type.
- Panel headings use `{typography.panel-title}`.
- Most content uses `{typography.body}`; labels and compact navigation use `{typography.ui}`.
- IDs, Git refs, file paths, commands, durations, and log output use `{typography.mono}`.
- Use at most three text weights in one view.
- Use sentence case. Do not uppercase navigation, statuses, or buttons.
- Technical English terms such as Sentry, DingTalk, Codex, Agent, Assessment, and Delivery may remain in otherwise Chinese UI copy.

## Layout

### Application shell

Desktop uses a quiet inverted-L shell:

- left sidebar: 220px expanded, 48px collapsed;
- location header: 44px high;
- view header: 40px high when filters or view actions exist;
- main content: fills the remaining viewport and owns the highest contrast;
- optional metadata rail: 280px, collapsible;
- optional Issue list pane: 360px default, resizable from 300px to 460px.

The shell uses full-height surfaces. Do not wrap the whole application in a floating rounded card.

### Density

Spacing follows a 4px base. Dense does not mean cramped:

- navigation item: 30px;
- issue row: 36px;
- standard button: 30px;
- input/select: 32px;
- compact toolbar gap: 4–8px;
- panel padding: 16px;
- major content separation: 24–32px.

Align icons, labels, badges, and row actions to shared horizontal tracks. A one-pixel misalignment is more damaging than an extra separator is helpful.

### Primary routes

- **Issues** is the default route and contains the create action, filters, list, and detail workspace.
- **Projects** lists registered local repositories and opens project configuration.
- **Settings** contains application, appearance, Agent Core, storage, and diagnostics settings.

Do not add a dashboard, inbox, analytics page, or separate activity page until the product has evidence that it needs one.

## Elevation & Depth

Structure should be felt before it is seen.

1. Separate major regions with surface contrast.
2. Use spacing and alignment inside a region.
3. Add a one-pixel semantic border only when the relationship remains unclear.
4. Reserve shadows for popovers, menus, dialogs, and drag previews.

Panels in the main document should normally be flat. Avoid nested cards, glowing edges, gradients, glassmorphism, and ambient spotlights.

## Shapes

- Small controls, rows, and chips: 4–6px radius.
- Assessment, Delivery, and review panels: 8px radius.
- Dialogs and large evidence previews: 10–12px radius.
- Pills are reserved for small statuses and segmented controls.
- Primary buttons are never pills.
- Icons use a consistent 1.5px stroke and render at 14–16px in dense UI.
- Do not place every icon on a colored rounded-square background.

## Components

### Sidebar

The sidebar is dimmer than the main canvas. It contains the product mark, Issues, Projects, Settings, project shortcuts, and collapse control. The selected item gains a modest surface lift and accent marker; inactive icons and text remain neutral.

The primary “New Issue” action may be visible near the top but must not dominate every screen.

### Headers

The 44px location header consistently contains breadcrumbs on the left and page-global actions on the right. A second 40px view header holds filters, layout controls, or context-specific actions. Never move the same class of action between headers on different routes.

### Issue list

Each 36px row contains, in order:

1. state icon;
2. Issue identifier;
3. title;
4. project or source when needed;
5. relative update time;
6. overflow action revealed on hover or keyboard focus.

Selection uses a surface change, not a full accent fill. Group headings are sticky and quiet. Empty states provide one sentence and one action.

### Issue detail

The main column presents the current decision material:

- Issue context;
- Assessment;
- Delivery and visual evidence.

The right rail contains project, source, state, Assessment revision, Agent session, and timestamps. Agent activity is a collapsible chronological timeline. It must not become a chat transcript that displaces the Assessment or Delivery.

### Assessment

Order content as verdict, reasoning, root cause when relevant, solution, and suspected duplicate. Show the exact revision and content-hash fragment being reviewed. `BUG`, `FEATURE`, `NOT_A_BUG`, and `UNCERTAIN` remain proposals until the user confirms or requests reassessment.

### Delivery

Order content as summary and visual evidence. Delivery evidence is deliberately limited to screenshots and recordings; unsupported or undecodable media never reaches human review.

Screenshots use a two-column grid when space permits and preserve aspect ratio. Videos show a poster frame, duration, and explicit play control. Logs and large diffs open in a focused viewer rather than expanding the page indefinitely.

### Agent activity

Events use small semantic icons, timestamps, concise summaries, and expandable detail. Streamed command output uses mono text and a bounded height. Reasoning or internal narration is not presented as authoritative evidence; Assessment, Delivery, and inspected visual evidence are.

### Review panel

One review shell appears for `REVIEW_REQUIRED`; `review.kind` selects only the decision context renderer. The shell stays within the detail document, never covers evidence, and always shows the server-provided bounded choices, optional feedback, and one submit action.

Assessment reviews show the proposed verdict and editable confirmed title. Delivery reviews show the Repair iteration and inspected evidence count. Business-merge-conflict reviews compare base intent and Issue intent, state why they are mutually exclusive, list affected paths, and present the AI recommendation without selecting it on the user's behalf. Unknown extension kinds fall back to a safe bounded summary.

Use the choice labels supplied by Runtime, such as “开始实现”, “要求重新分析”, “接受交付”, “要求修改”, “保留基线行为”, and “保留 Issue 行为”. Never use an ambiguous standalone “确认”.

Never use an ambiguous standalone “确认”.

### Status presentation

State labels use stable language and one icon/color mapping across the product. Running states may animate a small progress glyph. Review states use the accent. Failure states use danger. Completed uses success. Canceled and idle states remain neutral.

Color must never be the only distinction.

### Forms

Project settings use a vertical tab rail grouped as Project settings and Integrations. Project, Agent, and Commands and acceptance are the primary settings tabs; Sentry and DingTalk are separate Integration tabs. Advanced fields remain collapsed until requested. Secrets show configured/not-configured state and replacement controls inside the matching Integration tab; they never reveal their stored value.

Validation is inline and specific. Field errors appear directly below the affected control, while persistence failures appear below the persistent save action. Save actions remain disabled only when the reason is visible, and successful saves expose a polite visible status.

### Dialogs and command menu

Use dialogs for short, interruptive decisions and compact creation. Use full pages or side panels for configuration. The `Cmd/Ctrl + K` command menu supports navigation, Issue creation, retry, and theme changes, but does not expose an approval shortcut that could be triggered accidentally.

## Do's and Don'ts

### Do

- Keep the user's current decision material visually dominant.
- Use one accent sparingly and semantic colors truthfully.
- Prefer aligned dense rows to oversized cards.
- Show the exact Assessment revision or Repair iteration and unlocked capability at approval time.
- Make Agent output inspectable through Assessment, Delivery, visual evidence, and activity events.
- Keep headers and action placement consistent across routes.
- Test every component in dark and light themes.

### Don't

- Do not copy Linear branding, proprietary fonts, or exact product screens.
- Do not turn the experience into a chatbot with navigation attached.
- Do not create a dashboard for information already visible in the Issue list.
- Do not wrap every section in a card or every label in a pill.
- Do not use gradients, glass effects, large shadows, or decorative glow.
- Do not hide failures or skipped checks beneath a green summary.
- Do not present approval without explaining what permission it grants.
- Do not use color, animation, or an icon as the only state signal.

## Motion

- Hover/focus transitions: 100–140ms.
- Panel and dialog transitions: 140–180ms.
- Use ease-out for entry and ease-in for exit.
- Do not use spring, bounce, large scale, or decorative looping animation.
- Running indicators may loop subtly; failures and approvals must not pulse.
- Respect `prefers-reduced-motion` and remove nonessential movement.

## Interaction

Keyboard shortcuts:

- `Cmd/Ctrl + K`: command menu;
- `Cmd/Ctrl + Shift + B`: toggle the selected Issue's right metadata rail;
- `C`: create Issue when focus is not in an input;
- `J` / `K` or arrow keys: move through Issue rows;
- `Enter`: open selected Issue;
- `Esc`: close the current transient surface or return to the list;
- `/`: focus Issue search.

All icon-only controls require a tooltip, accessible name, hover state, and visible keyboard focus. Focus order follows visual order. Mouse-only hover actions must also appear on row focus.

Approval requires an intentional button activation. Never bind approval or another irreversible action to a single-letter shortcut.

## Responsive Behavior

- At 1200px and above, list, detail, and metadata rail may coexist.
- Below 1200px, collapse the metadata rail into a toggleable panel.
- Below 960px, the Issue list and detail become navigable views rather than compressed columns.
- Below 720px, the sidebar becomes an overlay and headers retain only essential actions.
- Touch targets grow to at least 40px on coarse-pointer devices, even though desktop density remains compact.
- Evidence grids collapse to one column. Tables become stacked key/value rows before horizontal scrolling is considered.

The product is desktop-first because it controls local projects, but narrow browser windows must remain fully operable.

## Accessibility

- Meet WCAG AA contrast for text and controls.
- Provide visible `:focus-visible` rings using `{colors.focus}`.
- Announce Agent state and newly completed stages through a polite live region; errors use assertive announcements only when action is required.
- Preserve semantic heading order in Assessment and Delivery sections.
- Provide text alternatives for status icons and generated screenshots.
- Videos require controls, captions when speech exists, and a written scenario summary.
- Logs, diffs, and timelines must remain readable at 200% zoom.

## Source and adaptation notes

This contract is an original Oh My Bug ?! design system informed by Linear's public writing on hierarchy, density, quiet navigation, and consistent chrome, plus the community `awesome-design-md` analysis of Linear's marketing site. The source analysis is reference material rather than an official Linear specification. Oh My Bug ?! intentionally replaces its palette, fonts, components, layouts, and product-specific rules.

- [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh)
- [Linear: How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Community Linear DESIGN.md analysis](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)
- [Google Labs DESIGN.md format](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md)
