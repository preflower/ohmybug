# Shadcn UI and Theme System Design

**Date:** 2026-08-21

**Status:** Proposed

**Design authority:** [`DESIGN.md`](../../../DESIGN.md)

## Objective

Make the desktop renderer consistently use checked-in shadcn/ui primitives for interactive controls while preserving the product-specific visual language defined by `DESIGN.md`. Replace the current two-state theme toggle with a complete `system | light | dark` theme model that follows operating-system changes unless the user explicitly overrides them.

This work improves consistency and maintainability without redesigning the product, changing runtime behavior, or replacing semantic application layouts with generic cards.

## Current State

The repository contains a shadcn configuration using the `base-nova` style and checked-in primitives under the desktop application. Those primitives preserve the product-specific visual contract while using Base UI for behavioral foundations.

The renderer currently initializes its theme to `light` only when that exact value exists in local storage; every other state becomes `dark`. It then writes an explicit `data-theme` value to the root element. Consequently, the CSS `prefers-color-scheme` fallback is overridden on startup and there is no persistent “follow system” mode.

## Product Decisions

1. `DESIGN.md` remains the visual source of truth. Shadcn supplies accessible interaction primitives and checked-in source structure, not a replacement aesthetic.
2. The migration covers reusable interactive controls. Semantic product structures such as the application shell, Issue rows, reports, approval panels, activity timelines, evidence galleries, and settings sections remain product-owned components.
3. Theme selection has three user-visible modes: `system`, `light`, and `dark`.
4. With no stored choice, the application uses `system`. A light operating-system preference resolves to light; all other system states resolve to the design contract's dark default.
5. Choosing `system` is persisted as a valid preference and continues to react to operating-system changes.
6. Existing product wording, route structure, keyboard shortcuts, persistence APIs, and workflow behavior remain unchanged except for the theme controls explicitly described here.

## Architecture

### Component foundation

Checked-in primitives live under `apps/desktop/src/web/components/ui`. They use Base UI where behavior benefits from it, `class-variance-authority` for variants, the existing `cn` helper for class composition, and semantic CSS variables bridged to the product tokens.

Add only primitives required by the current interface:

- `Button`
- `Input`
- `Textarea`
- `Select`
- `Checkbox`
- `Dialog`
- `Tooltip`
- `Badge`
- `Separator`
- `Tabs`
- `Alert`

`Button`, `Tabs`, and `Alert` are aligned with the design contract rather than regenerated blindly. `Button`, `Dialog`, `Select`, `Checkbox`, `Tabs`, and `Tooltip` use Base UI behavior. `Input`, `Textarea`, `Badge`, and `Separator` are lightweight checked-in components.

No `Card` abstraction is introduced. The design contract explicitly discourages turning every section into a card, and the current product panels have workflow-specific semantics. No generic form framework is introduced; existing controlled React state and validation remain sufficient.

### Product component boundaries

Feature components consume UI primitives instead of styling native interactive elements directly:

| Product area | Migration |
| --- | --- |
| Application shell and route headers | Use `Button` and `Tooltip` for actions; preserve shell layout and navigation semantics. |
| Issue list and detail | Use `Button`, `Badge`, and `Separator` where applicable; preserve Issue-specific rows, reports, evidence, and activity components. |
| Approval workflow | Use `Button`, `Input`, `Textarea`, `Alert`, and status `Badge`; preserve approval-panel semantics and wording. |
| Project settings | Retain `Tabs`, `Button`, and `Alert`; migrate native text, select, textarea, and checkbox controls. |
| Settings | Use a product-owned theme selector composed from shadcn buttons and accessible grouping semantics. |
| New Issue dialog and command menu | Replace hand-built modal behavior with `Dialog`; use shadcn form controls and buttons. |
| Transient icon actions | Use `Button` plus `Tooltip`, with an accessible name on every icon-only control. |

Native semantic elements remain appropriate for non-interactive structure, navigation links, headings, descriptions, lists, definition lists, figures, code, status text, and form labels.

### Styling and tokens

`apps/desktop/src/web/styles/tokens.css` continues to define the product palette, typography, and semantic surfaces. `global.css` continues to expose those variables to Tailwind and shadcn names such as `background`, `foreground`, `primary`, `muted`, `destructive`, `border`, `input`, and `ring`.

The migration adds any missing `DESIGN.md` tokens, including pressed accent, focus, soft status colors, info, and overlay. Components consume semantic variables only; no component selects a dark or light hex value directly.

Reusable control dimensions follow the design contract:

- standard button: 30px high, 6px radius;
- input and select: 32px high, 6px radius;
- compact icon control: 30px square unless its surrounding density requires the existing 26–28px compact size;
- focus ring: the semantic focus color with visible offset and WCAG AA contrast;
- dialog: 10–12px radius with overlay and restrained shadow;
- hover/focus transitions: 100–140ms;
- dialog transitions: 140–180ms with reduced-motion support.

Feature layout CSS remains in `global.css` during this migration. Rules that exist only to emulate primitive behavior—generic primary/secondary buttons, global form-control appearance, modal backdrop/content mechanics, and duplicated focus styles—are removed after all consumers migrate. Product-specific layout and state rules remain.

### Theme domain

Introduce a small renderer-owned theme module with two concepts:

```ts
type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";
```

The module owns:

- parsing stored preferences safely;
- resolving `system` through `matchMedia("(prefers-color-scheme: light)")`;
- applying `data-theme` and `color-scheme` to `document.documentElement`;
- subscribing to system preference changes only while the selected preference is `system`;
- persisting the selected preference under the existing `oh-my-bug-theme` key;
- exposing preference and resolved theme through a React context and `useTheme` hook.

Unknown legacy values fall back to `system`. Existing stored `light` and `dark` values remain compatible.

### Startup and flash prevention

Theme resolution must happen before React renders. A small inline bootstrap in the renderer HTML reads the stored preference, resolves the media query, and applies the root `data-theme`. The React provider repeats the same pure resolution logic and takes ownership after mount.

The bootstrap must fail closed: unavailable storage, malformed values, or unavailable media-query APIs resolve to dark without preventing application startup. This keeps the default consistent with `DESIGN.md` and avoids a bright flash in Electron.

The inline bootstrap and React module share the same storage key and accepted values. The bootstrap stays deliberately small; behavior is covered through the pure theme helpers and an integration assertion against the HTML contract.

### Theme controls

Settings → Appearance presents an accessible three-option selector labeled “跟随系统”, “浅色”, and “深色”. It shows both the stored preference and, when following the system, the currently resolved appearance.

The command menu adds theme actions as required by `DESIGN.md`. Theme changes are safe, reversible, and do not close or approve workflow decisions. Selecting the current theme is idempotent.

## Data Flow

1. Before renderer startup, the HTML bootstrap reads `oh-my-bug-theme` and applies the resolved root theme.
2. `ThemeProvider` initializes from the same stored value and media query.
3. Product controls call `setThemePreference(nextPreference)`.
4. The provider persists the preference, resolves its effective theme, and updates `document.documentElement.dataset.theme`.
5. If the preference is `system`, operating-system changes update only the resolved theme. The stored preference remains `system`.
6. CSS variables in `tokens.css` react to `data-theme`; both shadcn primitives and product layouts consume the same semantic variables.

## Error Handling

- Local-storage read or write failures never block rendering. The provider keeps the in-memory preference and resolves safely.
- Invalid stored values are treated as `system` and replaced on the next successful preference write.
- Missing `matchMedia` support resolves `system` to dark.
- Base UI-controlled surfaces remain closable by Escape and restore focus to their trigger.
- Existing form validation and persistence failures retain their current visible placement and wording while changing only the rendering primitives.

## Accessibility

- All controls preserve semantic labels and visible keyboard focus.
- Icon-only controls require both an accessible name and a tooltip.
- Dialogs and command surfaces trap focus, close on Escape, and restore focus.
- Theme selection exposes a single named group with an observable selected option; it does not rely on color alone.
- Status badges retain text labels and do not use color as the only distinction.
- Reduced-motion preferences disable nonessential primitive animations.
- Dark and light tokens are checked for readable text and control contrast at normal and muted emphasis.

## Testing Strategy

Implementation follows red-green-refactor in bounded slices.

### Theme tests

- stored `light`, `dark`, and `system` values initialize correctly;
- missing and invalid stored values resolve to `system`;
- `system` resolves from the media query and reacts to changes;
- explicit light/dark preferences ignore later system changes;
- storage failures do not prevent applying the theme;
- the renderer bootstrap applies a theme before React starts;
- Settings and the command menu change the same provider state and persist it.

### Primitive tests

- each added primitive renders its accessible role and label;
- keyboard interaction is covered for Dialog, Select, Checkbox, and Tooltip where applicable;
- variants expose stable data attributes or classes needed by product styling;
- disabled and invalid states remain visible and non-interactive.

### Feature regression tests

- project creation and integration configuration preserve values and validation;
- New Issue and command dialogs open, close, submit, and restore focus;
- approval and retry/cancel actions preserve current API calls and wording;
- Issue selection and navigation remain keyboard accessible;
- no migrated feature renders legacy generic button, input, or modal classes.

### Visual acceptance

Run the packaged Electron renderer at standard desktop width and a narrow width. Capture and inspect Issues, Projects settings, Settings appearance, New Issue, command menu, and both approval states in dark and light themes. Verify hierarchy, density, focus, overlay behavior, overflow, and absence of theme flash against `DESIGN.md`.

## Migration Sequence

1. Lock theme resolution and bootstrap behavior with failing tests, then implement the provider and three-state controls.
2. Add and validate the missing shadcn primitives against the semantic token bridge.
3. Migrate project settings and application settings controls.
4. Migrate dialogs and command menu.
5. Migrate Issue list/detail actions and approval controls.
6. Remove only legacy primitive CSS proven to have no consumers.
7. Run full engineering verification followed by dark/light visual acceptance.

Each step must leave the application testable and visually coherent. A migration step does not combine unrelated workflow or backend changes.

## Non-Goals

- Redesigning the information architecture or changing primary routes.
- Replacing product-specific layouts with generic shadcn cards.
- Changing runtime, agent, integration, persistence, or Electron IPC contracts.
- Adding a remote font request, analytics, cloud theme synchronization, or user-defined color palettes.
- Rewriting all feature CSS into Tailwind utilities solely for stylistic uniformity.
- Introducing approval shortcuts or changing dangerous-action safeguards.

## Completion Criteria

- Every reusable interactive control in the current renderer uses a checked-in UI primitive or a documented product-specific composite built from those primitives.
- Legacy generic button, form-control, focus, and modal behavior styles have no remaining consumers and are removed.
- Theme preference supports `system`, `light`, and `dark`; system changes are reflected live while in system mode.
- Theme is applied before React rendering without a visible startup flash.
- Settings and command-menu theme controls remain synchronized and persistent.
- Existing user workflows and API calls pass regression tests.
- Typecheck, lint, unit/component tests, builds, and Electron tests pass.
- Fresh acceptance evidence demonstrates the required views in both dark and light themes and records any deliberately retained product-specific styling.
