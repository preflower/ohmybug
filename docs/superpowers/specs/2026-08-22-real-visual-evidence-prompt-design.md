# Real Visual Evidence Prompt Contract

## Problem

The Repair prompt requires a screenshot or recording but does not define what makes visual evidence trustworthy. An Agent can therefore submit a generated or reconstructed image that illustrates expected behavior without capturing a real verification run.

## Scope

Strengthen only the Codex Repair prompt. Do not change the Repair output schema, evidence storage, media inspection, workflow state machine, or UI.

## Prompt Contract

Add this instruction to every Repair turn:

> Visual evidence must directly capture a real acceptance run that proves the change, such as the running application, an actual API request and response, or an executed benchmark. Never submit generated, reconstructed, mocked, or illustrative visuals.

The instruction is intentionally technology-neutral:

- UI changes can be proven by capturing the running application and relevant interaction.
- API changes can be proven by capturing an actual request and response.
- Performance changes can be proven by capturing an executed benchmark, profiler, or performance panel.
- CLI and background-process changes can be proven by capturing the real command or process output.

Generated comparison boards, recreated interfaces, mocked responses, diagrams, and illustrative renderings are not acceptable substitutes.

## Failure Behavior

When a real acceptance run cannot be captured, the Agent must continue troubleshooting or fail the Repair turn. It must not manufacture replacement evidence merely to satisfy the structured output schema.

## Testing

Add a Codex Repair adapter test that inspects the prompt sent to the Codex thread and verifies that it:

- requires a direct capture of a real acceptance run;
- covers running applications, actual API requests and responses, and executed benchmarks;
- explicitly rejects generated, reconstructed, mocked, and illustrative visuals.

Existing Repair result parsing and evidence media tests remain unchanged because this design adds a behavioral instruction, not machine-verifiable provenance.
