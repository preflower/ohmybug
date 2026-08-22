# Projects List: Three Visual Directions

## Goal

Create three 1536×1024 dark desktop UI mockups for the Projects list. Each mockup must preserve the current Oh My Bug application shell while offering a distinct organization for the Projects main content area.

The mockups are design references, not screenshots of implemented behavior.

## Shared visual contract

- Preserve the 220px left sidebar, 44px location header, and 40px view header.
- Keep Projects selected in the sidebar and retain the existing product navigation, project shortcuts, brand mark, New Issue action, and Codex connection state.
- Use the existing dark semantic palette, Inter-style sans typography, monospaced technical values, blue-violet interactive accent, 1px borders, 4–8px radii, and 30–32px controls.
- Keep the page calm, compact, precise, and clearly intended for engineers.
- Do not use gradients, glow, glass, large shadows, oversized cards, dashboards, charts, decorative metrics, or chatbot patterns.
- Use the accent only for selection, focus, and the primary action. Use semantic status colors only for truthful state.
- Keep the primary action `打开项目目录` and the secondary action `高级：手动输入路径` in the view header.

## Data and copy

All three directions use the same representative project data so the visual organization can be compared directly:

| Project | Key | Local path | Agent | Enabled integrations | Updated |
| --- | --- | --- | --- | --- | --- |
| ohmybug | OHMYBUG | `~/Documents/Workspace/ohmybug` | Codex | Sentry, DingTalk | 刚刚 |
| logistics-core | LOGISTICS | `~/Documents/Workspace/logistics-core` | Codex | DingTalk | 18 分钟前 |
| storefront | STOREFRONT | `~/Documents/Workspace/storefront` | Codex | 未启用 | 昨天 |

Visible page copy should use these labels verbatim where the design includes them: `Projects`, `本机项目`, `搜索项目`, `打开项目目录`, `高级：手动输入路径`, `项目`, `本机路径`, `Agent`, `集成`, `最近更新`, and `配置项目`.

Do not invent a project health score, build status, issue count, or repository activity. Revision and update timestamps may be shown because the current project model provides them. Enabled integration names and counts may be derived from project configuration.

## Direction A: Engineering table

This is the recommended direction and the strongest baseline for later implementation.

- Use one dense, aligned table with columns for Project, Local path, Agent, Integrations, and Updated.
- Place a compact search field and a small sort control above the table; default sorting is most recently updated.
- Keep rows approximately 64–70px high so the project name, mono key, and long path remain readable without becoming card-like.
- Use a quiet hover or selected surface change and a small blue-violet marker. Do not fill the row with the accent.
- Reveal the right chevron or overflow action at the row edge.
- Show a restrained project count near the section heading, not as a hero metric.

Trade-off: fastest comparison and best scaling, but it needs enough horizontal room for all columns.

## Direction B: List with inspector

- Divide the main content into a 340–380px project list and a flexible read-only inspector.
- Each list row shows the project name, mono key, shortened path, and updated time.
- The selected project inspector shows its full local path, Agent, enabled integrations, revision, created time, and updated time using flat definition rows.
- Put `配置项目` in the inspector header as the contextual primary action.
- Keep selection visible through surface contrast and a small accent marker.
- The inspector is a page region, not a floating card or modal.

Trade-off: quickest way to inspect one project before editing, but the split view uses more persistent structure and makes direct cross-project comparison slower.

## Direction C: Unboxed repository ledger

- Use a full-width, unboxed list with horizontal separators rather than card borders or a surrounding table frame.
- Give each project a two-line hierarchy: project name and key on the first line, full mono path on the second.
- Align Agent, enabled integrations, updated time, and row action in a quiet metadata track on the right.
- Keep the search field compact and place sorting in a text-style control beside it.
- Use generous outer margins and restrained row spacing so the page feels quieter while remaining dense.
- Highlight the active row with a subtle raised surface and small accent marker only.

Trade-off: best for long paths and the calmest presentation, but column-to-column comparison is less exact than Direction A.

## Responsive intent

These deliverables show the 1536×1024 desktop state. A later implementation should collapse secondary columns below 960px and replace the inspector split view with navigable list/detail states, but no narrow mockup is part of this image-generation task.

## Acceptance criteria

- Three distinct 1536×1024 mockups are generated with the built-in ImageGen tool.
- The application shell is visibly consistent across all three images.
- The three main-content organizations clearly match Directions A, B, and C.
- All visible project facts come from the representative data above or the current project model.
- Text is legible, key labels are spelled correctly, and the images contain no watermark.
- Final images and prompt files are saved under `output/ui-concepts/` with non-destructive filenames.
