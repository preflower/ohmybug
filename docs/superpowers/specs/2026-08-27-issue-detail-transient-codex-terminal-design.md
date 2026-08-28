# Issue Detail with Transient Codex Terminal

Date: 2026-08-27

## Goal

Refine the Oh My Bug ?! Issue detail design by preserving the current Assessment presentation, removing the persistent Execution card, and showing a transient read-only Codex Terminal only while the Agent is actively executing. Keep Evidence and Delivery concise and eliminate duplicated workflow-state information.

## Product model

The page distinguishes persistent review artifacts from transient process output:

- Assessment is a persistent decision artifact.
- Codex Terminal is transient live execution output.
- Evidence is a persistent verification artifact.
- Delivery is a persistent publication artifact.

The outer application remains the only workflow-state source. The Issue detail does not add progress indicators, stage numbers, completion labels, pending labels, or state chips.

## Page structure

The main column uses this order:

1. Issue header
2. Current Assessment card
3. Transient Codex Terminal, only during active Agent execution
4. Evidence card, when evidence exists
5. Delivery card, when delivery exists

The narrow metadata rail remains on the right and the action bar remains fixed at the bottom. The global application sidebar and Issue list are outside the concept-image scope.

## Issue header

Show only the Issue ID, title, and concise problem description. Do not add workflow state, progress, status banner, stage count, or summary statistics.

## Assessment card

Preserve the current project Assessment style rather than applying the newer simplified row treatment.

Keep:

- Current `review-section assessment-review` card structure
- Heading “评估结果 · Assessment”
- Verdict block with existing icon, verdict, and reasoning
- Bug root-cause block with existing search icon
- Solution block with existing wrench icon
- Current dividers, spacing, typography, and alignment

Do not add new status chips, revision metadata, completion labels, or stage numbering.

## Transient Codex Terminal

### Visibility

- Do not render the panel before the first current-session execution event arrives.
- Render it only while the Agent is actively executing the Issue.
- Remove it immediately when execution ends; do not retain an empty card, completed summary, collapsed history row, or “view execution record” entry.
- Evidence moves up naturally when the Terminal is removed.

### Data source

Reuse the current Agent activity event stream and current session ID. The panel is a read-only presentation of:

- Codex messages
- Commands
- Command output
- Running, failed, interrupted, or canceled command state where that state is part of the event output

Do not create a new PTY or command-input channel. The current runtime provides an external `openAgentTerminal` action, not an embeddable interactive PTY.

When the Agent session changes or is rebuilt, clear output from the previous session and begin with the new current session.

### Visual treatment

- Title: “Codex Terminal” only.
- Right-side action: “在 Terminal 中打开”.
- No “executing”, “running”, or other workflow-state label in the panel header.
- Use a dark terminal surface within the current light UI, with the existing card radius and subtle border.
- Use no glow, gradient, glass effect, oversized chrome, fake traffic-light controls, or decorative terminal branding.
- Commands and output use the existing monospace style; normal Codex messages use the current body type.
- Failed output may use the existing danger color. Successful output does not tint the full row green.
- Long commands and output support horizontal scrolling.
- The panel has a bounded maximum height and internal vertical scrolling so logs do not grow the whole Issue page indefinitely.

### Scroll behavior

- Follow the latest output while the user is at the bottom.
- Pause automatic following when the user scrolls upward.
- Show a lightweight “回到最新” action only while automatic following is paused.
- Resume following when the user selects “回到最新” or scrolls back to the bottom.

## Evidence card

Show:

- One direct verification conclusion
- Screenshots or recordings immediately beneath it

Do not show evidence count, “验证结果”, success label, acceptance state, or a nested gallery card. Individual media thumbnails may retain thin borders and short captions.

## Delivery card

Show:

- Concise delivery description
- Target branch
- Issue commit or commit summary

Do not show workflow state, evidence statistics, execution summary, pending text, or completion label.

## Metadata rail

Keep:

- Project
- Branch and Worktree
- Source
- Agent session
- Created time
- Updated time

Keep “在 Terminal 中打开” beside the Agent session only when the transient Terminal is absent. While the transient Terminal is visible, place the action in the Terminal header instead so the same action is not shown twice.

Remove:

- Issue status field
- Agent activity section; current execution output is represented by the transient Terminal instead

The Agent session remains a cross-stage workspace control. The Terminal panel provides current execution output only.

## Fixed action bar

Display only actions that are currently available. Do not add helper text, stage descriptions, or state labels. The Terminal does not create new bottom-bar actions.

## Responsive and boundary behavior

- Keep the existing main document and right-rail proportions on desktop.
- At narrower widths, move the metadata rail below the main document using the existing responsive pattern.
- The Terminal retains bounded height and internal scrolling at every width.
- If the external Terminal action is unavailable, disable or hide only that action according to the existing availability behavior; keep the read-only activity output visible.
- If command output is missing, render the command without fabricating output.

## Image deliverables

Generate two 1440×960 high-fidelity concept images with the same Issue content:

1. `issue-detail-transient-terminal-active.png`: Agent executing, Codex Terminal visible, Evidence and Delivery not yet present.
2. `issue-detail-transient-terminal-result.png`: execution finished, Terminal absent, Assessment plus concise Evidence and Delivery visible.

The two images demonstrate the intended state transition without adding workflow-state labels inside the detail page.

## Acceptance criteria

- Assessment visibly matches the current project Assessment style.
- The active-state image shows a single read-only Codex Terminal below Assessment.
- The result-state image contains no Execution card or Terminal residue.
- The Terminal header contains only its title and external Terminal action.
- The Terminal has bounded height, internal scrolling, and no command input.
- Evidence contains one conclusion followed directly by media.
- Delivery contains only description, branch, and commit.
- No workflow-state source is introduced inside the Issue detail.
- The right rail omits Issue status and duplicated Agent activity.
- Existing bottom actions remain available without helper copy.
- Both images remain recognizable as the current Oh My Bug ?! product.
