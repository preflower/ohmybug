# Project Settings Browser Feedback Design

## Goal

Resolve the six browser review comments on the project integration settings page while preserving Oh My Bug's compact, truthful settings experience.

## Scope

The change covers DingTalk receive filtering, integration status presentation, advanced-section alignment, save failure feedback, narrow-layout wrapping, and the project settings action bar. It does not redesign unrelated settings or change the overall navigation structure.

## DingTalk Group Filtering

Add a persisted DingTalk boolean configuration named `conversationFilterEnabled`.

- When disabled, DingTalk accepts messages from any group conversation when the bot is mentioned. The group ID editor is hidden and group IDs are not required.
- When enabled, the group ID editor is visible, at least one non-empty ID is required, duplicate IDs are rejected, and messages from groups outside the configured list are ignored.
- Existing saved configurations that contain one or more group IDs are treated as enabled when the new boolean is absent. This preserves the behavior of existing projects.
- New DingTalk configurations default the filter to disabled.

The “接收规则” section presents a standard switch row labeled “群聊过滤”. Its supporting text explains the current behavior. The group ID editor is conditionally rendered beneath the switch only when filtering is enabled. The previous static “接收范围 / 指定群聊” summary is removed because the switch communicates the state directly.

## Integration Header and Health

The top-right integration switch remains the authoritative enabled/disabled control and keeps its text label. The secondary health line is omitted while the integration is disabled, removing the duplicate “已停用” state. When the integration is enabled, health remains visible for connected, connecting, retrying, or unexpectedly stopped states.

## Advanced Section Alignment

The collapsed-section disclosure indicator aligns to the visual center of the “高级设置” heading line, not the combined heading-and-description block. The summary remains a native `details`/`summary` interaction with keyboard focus and the existing expanded/collapsed behavior.

## Save Failure Toast

Replace the form-width save error alert with the checked-in shadcn Sonner toast component.

- Mount one application-level toaster inside the theme provider.
- Report a failed save with `toast.error`, using the transport's existing public error message.
- Keep field and integration validation inline because those errors belong to specific controls.
- The toast remains dismissible and announced accessibly by the component.

## Narrow Layout

At the reported `693 × 755` viewport, the project navigation becomes horizontal but integration field rows do not collapse prematurely. The group filter row and group ID editor retain their label/control relationship while space permits. Field rows collapse to one column only at the smaller phone breakpoint.

The project settings workspace continues to fill the available application height below the headers. In narrow mode:

- the tab navigation occupies its natural-height first row;
- the settings main area fills the remaining row;
- the content region scrolls independently;
- the action footer remains at the bottom of the settings workspace.

This removes the trailing blank region below the footer without turning the whole application shell into a document scroller.

## Data Flow and Compatibility

The DingTalk manifest exposes `conversationFilterEnabled` as a boolean config field in the rules section. Desktop rendering uses that value to conditionally show `conversationIds`. Runtime validation and adapter construction normalize absent legacy values from the presence of existing IDs. The adapter checks membership only when the filter is enabled.

Saving normalizes the new boolean and removes no valid legacy group IDs. Disabling filtering may retain the IDs so re-enabling restores the user's previous list; they are ignored while the filter is disabled.

## Error Handling

- Required and duplicate group ID failures remain inline and focus the affected editor.
- Save transport failures appear as an error toast and do not mark the form as saved.
- An enabled integration that is stopped still exposes its stopped health state; only the redundant disabled health state is hidden.

## Testing

Follow red-green-refactor for each behavior:

1. DingTalk plugin tests cover default-off behavior, legacy migration, enabled-filter validation, and adapter membership filtering.
2. Desktop component tests cover the filter switch, conditional group ID editor, retained values, and hidden disabled health status.
3. Project form tests cover save failure through the toast API while preserving inline field validation.
4. Layout contract tests cover disclosure alignment, the delayed one-column breakpoint, and full-height narrow workspace rows.
5. Playwright acceptance uses a `693 × 755` viewport to verify no premature group-field wrapping, the footer at the workspace bottom, conditional group ID visibility, and toast feedback in browser read-only mode.

## Acceptance Criteria

- Turning “群聊过滤” off hides group IDs and allows any mentioned group message.
- Turning it on reveals group IDs and enforces the configured allowlist.
- Existing projects with group IDs retain filtering after upgrade.
- The advanced disclosure indicator aligns with its title.
- Save failures use a shadcn toast, not an inline page-width alert.
- Disabled integrations show “已停用” only once.
- The group editor does not unexpectedly stack at 693px.
- The action footer sits at the bottom of the available settings workspace at 693 × 755.
