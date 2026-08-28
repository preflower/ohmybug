# Keyboard Shortcut Overview Design

## Goal

Make Oh My Bug ?!'s implemented keyboard shortcuts easy to discover without crowding primary controls, keep every visible shortcut synchronized with its behavior, and give icon-only tooltips a compact, consistent presentation.

## Scope

This change covers the existing application shortcuts, their presentation in Settings and the command menu, the selected Issue metadata-rail shortcut, and the shared Tooltip visual style. Shortcut customization, persistence, conflict resolution, and unimplemented shortcuts are out of scope.

## Shortcut catalog

The application will maintain one typed shortcut registry as the source of truth for keyboard matching, accessible shortcut metadata, and visual labels.

| Action | macOS | Windows/Linux | Scope |
| --- | --- | --- | --- |
| Open command menu | `⌘ + K` | `Ctrl + K` | Global outside editable controls |
| Create Issue | `⌘ + N` | `Ctrl + N` | Available when at least one project exists, outside editable controls |
| Open project | `⌘ + O` | `Ctrl + O` | Global outside editable controls |
| Toggle Issue details rail | `⌘ + B` | `Ctrl + B` | Only while an Issue is selected, outside editable controls |
| Close current transient surface | `Esc` | `Esc` | When a dismissible dialog or command menu is open |

The details-rail shortcut no longer requires `Shift`. `⌘/Ctrl + Shift + B` must not match the new binding. Existing repeat, Alt-key, editable-input, textarea, select, and content-editable protections remain in place.

## Architecture

Create a focused keyboard-shortcut module under the desktop web application. Each registry entry owns a stable ID, action label, primary key, modifier requirements, and an optional scope description. Small helpers will:

- match a `KeyboardEvent` against a registry entry;
- return the platform-appropriate visual modifier;
- return the standards-compliant `aria-keyshortcuts` value;
- provide ordered entries for the Settings overview.

Application handlers may remain near the state they control, but they must call the shared matcher instead of duplicating key and modifier conditions. The command menu, Settings overview, `KbdShortcut`, and details-rail button metadata must consume the same registry entries.

## Settings presentation

Add a read-only “键盘快捷键” option within the existing “偏好设置” section. Do not introduce another nested card. Use a compact aligned list:

- action name and optional scope note on the left;
- the current platform's key sequence on the right;
- explicit `+` separators between every modifier and key, such as `⌘ + B` and `Ctrl + O`;
- `Esc` shown as a single key without separators.

The overview lists only shortcuts that are implemented in the current application. It must not advertise planned shortcuts from design documentation.

## Existing control presentation

- Remove the inline shortcut from the sidebar “新建 Issue” button. Keep its label, icon, accessible name, and behavior unchanged.
- Keep shortcut hints beside “新建 Issue” and “打开项目” in the command menu.
- Keep `aria-keyshortcuts` on the details-rail toggle, updated to `Control+B Meta+B`.
- Keep the details-rail toggle Tooltip, but show only “隐藏详情栏” or “显示详情栏”; do not render a key sequence inside it.

## Tooltip styling

Update the shared Tooltip primitive so all icon-only action hints use the same compact visual language:

- high-contrast inverse neutral surface and text;
- no border;
- 12px text;
- 6px corner radius;
- compact horizontal and vertical padding;
- a restrained shadow that separates the hint without making it resemble a popover;
- existing portal, positioning, reduced-motion behavior, accessible tooltip role, and trigger semantics remain unchanged.

This is a global primitive adjustment so close buttons and other icon-only controls remain visually consistent.

## Accessibility

- Visual shortcut strings are hidden from assistive technology when the action already has an accessible label.
- `aria-keyshortcuts` uses platform-independent token syntax rather than the visual `+`-separated presentation.
- The Settings overview exposes action names and readable key sequences in DOM order.
- Keyboard focus continues to trigger icon-only tooltips.
- Shortcut handling never takes precedence while the user is editing text or selecting a form value.

## Verification

Use test-driven development for each behavior change. Automated coverage must prove:

1. The registry formats macOS and Windows/Linux shortcuts with visible `+` separators.
2. `⌘/Ctrl + B` toggles the selected Issue details rail.
3. `⌘/Ctrl + Shift + B`, repeated events, Alt-modified events, and events from editable controls do not toggle the rail.
4. Settings displays the complete implemented shortcut catalog using the current platform.
5. The sidebar “新建 Issue” button contains no shortcut hint.
6. The command menu retains its create-Issue and open-project hints.
7. The details-rail toggle exposes `Control+B Meta+B`, while its Tooltip contains only the action label.
8. The shared Tooltip renders the agreed compact, borderless, high-contrast style.
9. Existing desktop web tests, Electron shortcut acceptance coverage, type checking, linting, and the production build remain green.

