# Project Settings and Git Workspace Polish Design

## Goal

Make project configuration feel like one coherent engineering workflow: use one persistent save area, present Git Worktree choices as inspected repository facts, validate the selected base branch before it can fail during Issue execution, and use one failure-banner vocabulary across Issue states.

## Scope

This change covers five related improvements:

1. Reuse the existing Codex failure banner for evidence-capture failures.
2. Match the project-path picker button height to its read-only input.
3. Remove the duplicate project actions from the top view header and refine the existing right-column footer.
4. Redesign Git Worktree remote publication as a clear switch with read-only repository context.
5. Replace the free-form base-branch input with an asynchronous, searchable branch picker that supports local and remote-tracking branches.

It does not add, edit, or remove Git remotes. It does not automatically fetch when the project page opens. It does not move the project footer across the left settings tabs.

## Issue Failure Banner

Evidence failure currently renders through the generic `Alert` component while normal Codex failures use the dedicated `.error-banner` treatment. Evidence failure will use the same `.error-banner` structure, including the `CircleAlert` icon, danger color, border, background, spacing, and `role="alert"` semantics.

The evidence-specific message remains explicit:

> 证据采集失败；实现改动和工作目录已保留。

The separate recovery section remains below the banner. Its description explains that retrying only captures evidence again, and its action remains “重试证据”. The banner communicates state; the recovery section owns the action.

## Project Action Placement

The project configuration page will have one action area.

- Remove “返回项目列表” and “保存项目” from the top-right view header while editing a project.
- Keep the existing footer inside the right settings content column. Do not move it to the outer Tabs container and do not span it beneath the left navigation.
- Keep the footer fixed at the bottom of the right column while the form content scrolls.
- Keep one row: save state on the left, “取消” and “保存项目” on the right.
- Use the same surface as the right content region, one subtle top border, no shadow, and approximately 52 to 56 pixels of height.
- Reduce excess vertical padding so the footer reads as application chrome rather than a floating panel.
- Render persistence errors immediately above the footer in the right content column so errors do not increase the footer height.

The save status remains visible and polite: “所有更改已保存” after persistence succeeds and “有未保存的更改” after a field changes. The save button is disabled while saving, and its label changes to “保存中…”. Cancel returns to the project list through the existing form callback.

## Project Path Control

The local project path remains read-only after the directory has been selected or the project already exists. “重新选择目录” remains the only way to replace it.

The input and button will share a 32-pixel control height, the same border radius, and vertically aligned text. The button remains intrinsic width while the mono path input consumes the remaining row width. The local-persistence note remains below the combined control.

## Git Worktree Section

### Information hierarchy

The section keeps “工作目录方式” and “基线分支” as the primary configuration row. Remote publication becomes a distinct, full-width capability row below it.

When Git Worktree is selected:

- “工作目录方式” remains a provider select.
- “基线分支” becomes a searchable Combobox.
- “完成后推送到远程” becomes a switch, not a plain checkbox.
- The detected remote repository URL is displayed as read-only context within the publication row.
- The internal Git remote name may appear as muted supporting text, but it is never an editable input.

When no usable remote exists, the switch is disabled with “当前 Git 仓库未配置远程仓库”. No remote URL, remote branch group, or refresh action is shown.

### Effective remote

The base-branch Fetch remote and publication remote are related but not assumed to be identical.

For base-branch discovery, resolve the effective remote in this order:

1. The remote tracked by the repository's current local branch.
2. `origin`, when it exists.
3. The only configured remote, when exactly one exists.

If several remotes exist and none can be resolved by those rules, do not guess and do not add an editor to Oh My Bug ?!. Keep local branches usable and explain that an upstream must first be configured with Git.

For normal repositories, a local branch usually tracks `origin/main`, so the first rule still selects `origin`. The distinction matters for fork workflows where a base branch may track an upstream repository while completed Issue branches publish to the user's fork.

## Base Branch Combobox

### Opening and loading

Opening the Combobox performs two actions independently:

1. Show locally available branches immediately.
2. If an effective remote exists, start `git fetch --prune <remote>` and display a loading row under the remote group.

The network request never blocks selection of a local branch. When Fetch completes, remote-tracking branches are appended without closing the popup, resetting the search query, or clearing the current selection.

### Grouping and search

The list uses group headings as the only local-versus-remote distinction:

- “本地分支”, with options such as `main`.
- “远程分支”, with full options such as `origin/main`.

Do not add repetitive “本地” or “远程” tags to each option. Search matches the visible full ref name across both groups. The selected value stores the exact Git ref shown by the option.

### Failure and retry

If Fetch fails:

- Preserve and continue showing local branches.
- Preserve any previously known remote-tracking branches, clearly treating them as the local repository's cached refs.
- Replace the remote loading row with a concise failure message and “重试”.
- Do not change the saved base branch or enable remote publication implicitly.

Each closed-to-open transition starts a new Fetch when an effective remote exists. Existing local and cached remote-tracking results remain visible while that request runs. Repeated open events while one request is already active reuse the in-flight request. A user-triggered retry after failure starts a new Fetch.

## Data and Module Boundaries

Git commands remain inside the Git Workspace provider. React receives repository facts through Runtime operations and never shells out directly.

The workspace module API gains optional project-aware capabilities for:

- Listing local branch refs without network access.
- Refreshing the effective remote and returning local plus remote-tracking refs.
- Validating a project workspace configuration against the selected repository.

The Git provider implements these capabilities. The local-directory provider does not need them. The Workspace Registry exposes them through provider-neutral methods, and Runtime adds corresponding typed operations. Desktop IPC, preload, renderer transport, and the browser-development snapshot transport carry the same DTOs.

Branch-discovery output contains separate `localBranches` and `remoteBranches` arrays, the effective remote name and URL when available, a remote-availability reason when unavailable, and an optional refresh error. A branch name appears in only one group.

Project creation and update perform two validation layers:

1. Existing synchronous manifest validation checks required configuration shape.
2. Project-aware validation resolves `<baseBranch>^{commit}` in the selected repository before persistence.

This prevents a stale or manually migrated ref from surviving until Issue workspace acquisition. Acquisition retains its existing verification as a final safety check.

## Interaction and Accessibility

- The branch trigger and popup support keyboard navigation and visible focus.
- Search receives focus when the popup opens.
- Group headings are announced but are not selectable.
- Loading uses a polite status; Fetch failure is associated with the branch field without interrupting local selection.
- The switch exposes its disabled reason through `aria-describedby`.
- Long paths and branch refs use mono text and truncate in the closed control while retaining a full accessible value or title.
- All controls remain operable at 200 percent zoom and in the existing narrow project-settings layout.

## Testing

### Git provider

- Lists local branches without a remote.
- Resolves the current branch's tracking remote before `origin`.
- Falls back to `origin`, then to a sole remote.
- Fetches and returns remote-tracking branches.
- Preserves local results when Fetch fails.
- Rejects a base branch that cannot resolve to a commit.
- Accepts local and remote-tracking base refs that resolve to commits.

### Runtime and transports

- Registry delegates only to providers that expose branch capabilities.
- Runtime operations validate inputs and outputs.
- Desktop IPC, preload, renderer transport, and browser-development transport preserve grouped branch data and refresh errors.
- Project save awaits project-aware workspace validation before persistence.

### Renderer

- Evidence failure uses the same banner structure as normal Codex failure.
- The top project header no longer renders duplicate editing actions.
- The footer remains confined to the right settings column.
- Path input and directory button share a 32-pixel height.
- Branch Combobox shows local results immediately, searches both groups, appends remote results, and keeps local options usable after Fetch failure.
- Remote publication is a switch with a read-only repository URL and a visible disabled reason.

### Browser verification

- Confirm footer placement and single-row behavior at desktop and narrow widths.
- Confirm path control alignment.
- Confirm branch popup grouping, search, loading, retry, keyboard focus, and long-ref truncation.
- Confirm the evidence-failure banner visually matches other Codex failure banners.
