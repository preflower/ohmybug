# Project Settings Switch Unification Design

## Context

Project Integration settings currently render two visually similar Boolean controls through different primitives. The Integration enabled control uses a Checkbox with project-specific pseudo-element styling, while manifest Boolean fields use the shared Base UI Switch wrapper. This produces different roles, dimensions, neutral colors, and theme behavior.

The user approved replacing the custom control with the existing shadcn-style Switch while keeping the current compact visual language.

## Design

- Render Integration enabled state with the shared `Switch` component and `role="switch"` semantics.
- Keep the shared Switch track geometry at `36px × 20px`, its `16px` thumb, neutral unchecked track, accent checked track, focus ring, disabled state, and transition behavior.
- Use `--primary-foreground` for the thumb so it remains a high-contrast near-white neutral in both dark and light themes.
- Remove the Checkbox-only Integration toggle CSS. Keep layout styling for the surrounding label and status text.
- Preserve all existing state updates, disabled behavior, labels, and persistence flows.

## Testing

- Component tests assert that the Integration enabled control is the shared Switch primitive, not a Checkbox.
- Primitive tests assert that the thumb uses the primary foreground token.
- Existing project settings tests, TypeScript checking, and browser inspection verify that both Integration enabled and manifest Boolean controls share dimensions and colors in dark and light themes.

