# Review Choice Scroll Stability Design

## Problem

Assessment review choices currently sit below a choice-dependent editor. Selecting
“开始实现”, “确认为重复 Issue”, or “要求重新分析” inserts or removes that editor
above the focused radio control. The resulting layout shift moves the review choices
inside the scrollable Issue detail document and makes the page appear to jump.

## Approved design

Keep the stable review context above the bounded choices. Render only the selected
choice's response field after the choice list and before the general feedback field.
The radio group therefore keeps the same document position while the title or
duplicate-Issue editor appears and disappears.

This is preferred over reserving blank height or imperatively restoring `scrollTop`:
it removes the source of the shift, adds no unused space, and does not interfere with
native focus scrolling for keyboard users. Delivery, business-conflict, and extension
review contexts remain unchanged.

## Verification

- A component regression test verifies that the Assessment response field follows
  the “选择处理方式” radio group and still switches between title, duplicate, and no
  field states.
- Focused Desktop tests cover existing review submission behavior and TypeScript
  contracts.
- A real browser acceptance run scrolls the Issue detail, switches the processing
  choice, and captures the stable choice list in the rendered application.
