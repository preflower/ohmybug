# Collapsed Project Initial Design

## Goal

Keep project shortcuts identifiable when the application sidebar collapses at the narrow breakpoint.

## Behavior

- Expanded sidebar: preserve the current project dot and full project name.
- Collapsed sidebar: replace the hidden dot and name with the first visible character of the project name. Fall back to the project key when the name is unavailable.
- Latin initials are uppercase. CJK and other scripts remain unchanged.
- The button retains the complete project name as its accessible label and native hover title.
- The empty-project shortcut keeps its existing behavior and does not invent a project initial.

## Visual treatment

The initial sits directly in the existing 30px navigation button. It is a compact 24px neutral project marker with a 6px radius, muted text, and the existing selected-row treatment. It adds no outer card, border, animation, or new accent color.

## Scope

Only the sidebar project shortcuts and their narrow responsive rules change. Navigation, project state, routing, and desktop sidebar presentation remain unchanged.

