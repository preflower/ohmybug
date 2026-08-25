# macOS Menu Bar Task Status Dots Design

## Goal

Make pending tasks in the native macOS menu easier to scan by replacing the trailing status description with a compact leading status dot. The full native menu row remains the click target.

## Menu Presentation

Each task row uses the existing macOS menu-item icon gutter and the label format:

```text
[status dot] OHMYBUG-22 · Issue title
```

The label no longer appends `— <status>`. Existing section headings remain unchanged:

- `需要你操作`
- `AI 处理中`

Each section continues to show at most four tasks, followed by the existing overflow action when needed.

## Status Mapping

The task model exposes one of three semantic indicators:

- `failure`, rendered with the design-system danger red, for `ASSESSMENT_FAILED`, `EVIDENCE_FAILED`, `REPAIR_FAILED`, and `FINALIZATION_FAILED`;
- `review`, rendered with the design-system warning yellow, for `ASSESSMENT_REVIEW`, `PERMISSION_REQUIRED`, and `ACCEPTANCE_REVIEW`;
- `processing`, rendered with the design-system info blue, for every status already classified into the `AI 处理中` section.

Section headings preserve a text description of the task category, so color is supplementary rather than the only state signal.

## Native Menu Integration

The menu controller receives a resolver that maps each semantic indicator to an Electron menu icon. Task entries set both the plain-text label and the resolved icon. Clicking the icon, text, or remaining row area triggers the same native menu-item action and opens the corresponding Issue.

The three dot assets are non-template images so macOS preserves their semantic colors. Each dot is visually 8 px and includes a Retina representation. The existing branded menu-bar icon remains a template image and is unaffected.

If a status-dot image cannot be loaded, the resolver returns no icon and the task remains available as a normal text menu item. A visual asset failure must never block loading or navigating the task list.

## Packaging

The red, yellow, and blue dot resources live with the existing desktop tray assets. The Electron build copies them into the same packaged asset directory, and the packaged-runtime contract lists each required file explicitly.

## Testing

Automated tests cover:

- every pending Issue status maps to the expected semantic indicator;
- task labels contain only the Issue identifier and truncated title;
- menu entries request the correct icon for failure, review, and processing tasks;
- task rows remain clickable and navigate to the same Issue;
- missing icon resolution falls back to a working text-only row;
- all status-dot resources are present in the packaged layout.

Final macOS verification checks red, yellow, and blue dots in the native menu at Retina scale and confirms that clicking anywhere on a task row still opens and selects the Issue.
