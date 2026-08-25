# New Issue Icon Alignment Design

## Goal

Place the plus icon at the right edge of the expanded sidebar's “新建 Issue” button while keeping the label at the left edge.

## Behavior

- In the expanded desktop sidebar, the button label and plus icon use opposite horizontal edges inside the existing padding.
- At the existing collapsed-sidebar breakpoint, the hidden label leaves the plus icon centered in the button.
- The button's dimensions, copy, accessible name, colors, interaction, and dialog behavior remain unchanged.

## Implementation

Change only the `.new-issue` desktop alignment rule in `apps/desktop/src/web/styles/global.css` from start alignment to space-between alignment. Keep the existing narrow-screen override that centers the icon.

## Verification

Add a stylesheet regression test for both responsive rules and a packaged-Electron layout test that measures the real rendered button. At desktop width, the plus icon's right edge must sit within the button's right padding. At collapsed width, the icon and button centers must coincide. Run desktop tests, type checking, and a production web build, then capture the expanded packaged desktop state as acceptance evidence.
