---
name: brainstorming
description: Use when a requested feature or behavior has unresolved product, UX, architecture, or scope decisions that should be agreed before substantial implementation
---

# Brainstorming Ideas Into Designs

Turn an ambiguous idea into an agreed direction before substantial implementation. Scale the discussion to the decision instead of following a fixed ritual.

## When to Skip

Do not invoke this skill for a well-specified, localized, low-risk change; a direct bug fix with a known cause; copy or configuration edits; or work already covered by an approved design. Handle those directly and verify them proportionally.

## Checklist

Use only the steps the decision needs:

1. **Explore relevant context** — inspect only what informs the decision.
2. **Resolve material ambiguity** — ask questions whose answers would change the result.
3. **Compare real alternatives** — do not manufacture a fixed number of options.
4. **Recommend and describe** — cover the design at the level needed for agreement.
5. **Get approval when needed** — before choices that affect scope, user-visible behavior, architecture, compatibility, or meaningful risk.
6. **Document or plan conditionally** — only for substantial work, handoff, or an explicit user request.

## After the Design

**Documentation:**

- Write a design document only for substantial work, handoff, a durable decision record, or an explicit user request.
- Use `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` unless the user or repository specifies another location.
- Do not commit the design automatically.

**Spec Self-Review:**
After writing the spec document, look at it with fresh eyes:

1. **Placeholder scan:** Any "TBD", "TODO", incomplete sections, or vague requirements? Fix them.
2. **Internal consistency:** Do any sections contradict each other? Does the architecture match the feature descriptions?
3. **Scope check:** Is this focused enough for a single implementation plan, or does it need decomposition?
4. **Ambiguity check:** Could any requirement be interpreted two different ways? If so, pick one and make it explicit.

Fix any issues inline. No need to re-review — just fix and move on.

**User Review Gate:**
When a written spec is the implementation contract, ask the user to review it before proceeding:

> "Spec written to `<path>`. Please review it and let me know if you want changes before implementation."

Wait for the user's response. If they request changes, make them and re-run the spec review loop. Only proceed once the user approves.

**Implementation:**

- Use `writing-plans` only when implementation is genuinely multi-step or needs handoff.
- A concise approved design can transition directly to implementation when the work is straightforward.

## Key Principles

- **Ask for decision value** - Skip questions that do not change the outcome
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore real alternatives** - Do not invent options to satisfy a quota
- **Validate proportionally** - Match approval and documentation to consequence
- **Be flexible** - Go back and clarify when something doesn't make sense
