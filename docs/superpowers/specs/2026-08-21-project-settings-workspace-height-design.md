# Project Settings Workspace Height Design

## Problem

The project editor currently combines a viewport-filling `.page-scroll` with fixed `520px` and `438px` minimum rows. At a 1368×1230 viewport this leaves 588px of unused page space and inserts a 247px gap between the last project field and the save action.

## Approved behavior

- On desktop, the project editor fills the workspace below the project toolbar.
- The project navigation spans the editor height.
- The active panel owns the scrollable content area and the save action sits in a dedicated footer at the bottom.
- Fixed `520px` and `438px` layout heights are removed.
- At widths up to 760px, the editor returns to natural document flow so the horizontal tab list and form scroll together.

## Verification

- Automated browser coverage asserts the editor and navigation reach the workspace bottom, the save action is bottom-aligned, and the page has no extra vertical scroll on desktop.
- Narrow viewport coverage asserts the editor uses natural height and remains page-scrollable.
- Acceptance captures the real `/projects` page at desktop size; automated browser coverage protects the narrow layout.
