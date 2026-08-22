# Issue Dock and Project Workspace Design

## Goal

Make the Assessment authorization controls a persistent, clearly separated footer and simplify project workspace configuration so that Git delivery reflects the actual repository state rather than free-form user input.

## Scope

This change covers the Issue Assessment authorization dock and the Project configuration screen. It does not redesign Delivery review, add a new Issue terminal state, edit Git remotes, or add remote-provider authentication.

## Issue authorization dock

The compact Assessment authorization panel moves outside the scrolling Issue document. The detail pane becomes a two-row layout: the Issue document owns vertical scrolling, while the authorization dock remains in a non-scrolling footer at the bottom of the detail workspace. The dock uses a top border and restrained upward shadow so it is visibly separate from the Assessment card without resembling a floating card.

The action row is right-aligned and uses shorter labels because the dock summary already explains the decision and unlocked capability:

- `关闭 Issue`
- `重新分析`
- `开始修复` or `开始实现`

The primary action remains explicit through the adjacent heading and capability copy. `关闭 Issue` opens a short confirmation dialog. Confirming calls the existing cancellation operation, terminates an active Agent session when applicable, releases workspace resources through the existing finalization path, and leaves the Issue in `CANCELED` with resolution `CANCELED`. No new `CLOSED` resolution is introduced.

Expanded reassessment feedback remains inside the dock footer. Errors remain adjacent to the actions. At narrow widths the summary stacks above the actions, but the action group remains aligned to the end of the available inline direction.

## Project information architecture

Remove the standalone `工作目录` tab. The `项目` tab contains, in order:

1. Project name and identifier.
2. A read-only local project path with a `重新选择目录` action.
3. Workspace mode, either the original directory or Git Worktree.
4. Provider-specific configuration.
5. A compact Agent and enabled-integration summary.

Selecting a different directory updates the unsaved form state only. Existing project identity, Agent configuration, commands, and integrations remain unchanged until the user explicitly saves. New projects may continue to derive their initial name and identifier from directory inspection.

The ambiguous `本机项目已注册` state is removed. The save footer remains the authoritative saved/unsaved indicator. A quiet note under the path states `项目路径和配置仅保存在这台电脑上。` This means Oh My Bug stores the project record in its local application database; it does not register the project with Git or a remote service.

## Git Worktree delivery

Git Worktree always creates a local Issue branch. Remote publication is therefore represented as a Boolean switch named `完成后推送到远程`, disabled by default. It is not represented as a mutually exclusive `local`/`remote` text field.

The switch can be enabled only when Oh My Bug can resolve a usable remote from the selected Git repository. Remote resolution is deterministic:

1. Use the current branch's configured upstream remote when present.
2. Otherwise use `origin` when present.
3. Otherwise use the sole configured remote.
4. If multiple remotes remain and none is preferred, treat the remote as unresolved.

When resolved, the UI displays the remote URL or filesystem path, for example `git@github.com:team/repository.git` or `/srv/git/repository.git`. The remote name such as `origin` may appear only as secondary technical metadata. Both are read-only. Oh My Bug does not edit `.git/config` or provide a remote URL input.

When no remote is configured, or a default cannot be resolved, the switch is disabled and the UI explains that the user must configure or select an upstream remote with Git before enabling publication. Directory reselection and project loading refresh this inspection.

The stored workspace configuration uses `pushToRemote: boolean`. Existing `delivery: "local" | "remote"` project configurations remain readable and are normalized on the next save. When an Issue workspace is acquired, the Git provider snapshots the resolved remote name and display URL into its internal Issue workspace state so publication remains deterministic for that Issue.

## Provider inspection boundary

Remote discovery belongs to the Git workspace provider, not to the generic Project form. The workspace-provider boundary gains an optional read-only project inspection capability. The runtime asks installed providers to inspect the canonical project path and returns provider-specific availability and display metadata with Project inspection results.

The renderer treats this metadata as read-only evidence. It may render provider-specific status and disable invalid choices, but it never shells out to Git or infers remote URLs itself. The Git provider continues to own Git command execution and configuration validation.

## Error handling

- A directory that is not inside a Git repository makes Git Worktree unavailable and shows a provider-specific explanation.
- A repository without a resolvable remote still permits local Worktree delivery; only the remote-push switch is disabled.
- If a previously configured remote disappears before publication, publication fails with the existing recoverable delivery failure path and does not silently choose a different remote.
- Cancel confirmation failures leave the authorization dock visible and show the error beside its actions.
- Directory picker cancellation leaves the form unchanged.

## Accessibility and interaction

- The dock remains reachable in normal focus order after the Assessment content.
- The close confirmation dialog has an explicit title, consequence text, cancel action, and `确认关闭` action.
- The remote-push switch exposes its disabled reason in associated helper text.
- Read-only paths remain keyboard-selectable and use monospaced text.
- Buttons retain visible focus styles and coarse-pointer target sizing from the existing component system.

## Testing

Core and runtime tests cover cancellation from Assessment review, legacy Git delivery configuration normalization, provider remote resolution, unresolved/missing remotes, and remote snapshot behavior. Renderer tests cover the persistent dock structure, shortened/right-aligned actions, close confirmation, merged Project tab, read-only directory selection, disabled remote switch, and read-only remote URL display.

Electron acceptance coverage verifies directory reselection and an actual temporary Git repository with and without a remote. Browser visual verification covers the Issue detail at the reported narrow viewport and the Project form with Local and Git Worktree modes.

