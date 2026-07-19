/**
 * F12.22 forced-replan routing — the Magentic-One progress-ledger consequence for a `stalled` verdict: one
 * synthetic end-of-context message that BREAKS the loop by demanding self-reflection + plan revision before the
 * next action. Injected at most once per session (the stall flag itself fires once), gated by
 * NKLEIN_STALL_REPLAN at the wire (default OFF = record-only stays byte-identical). Pure builder so the message
 * content is unit-testable; the context-focus extension owns the injection.
 */

/** Metadata kind stamped on the injected message so transcript tooling can detect/skip it. */
export const STALL_REPLAN_MESSAGE_KIND = "kanban-stall-replan";

export interface StallReplanMessage {
	id: string;
	role: "user";
	content: [{ type: "text"; text: string }];
	createdAt: number;
	metadata: { kind: typeof STALL_REPLAN_MESSAGE_KIND };
}

/** Build the forced-replan message for a stalled session. `now` injected for determinism. */
export function buildStallReplanMessage(input: {
	reason: string;
	focusStep: string | null;
	now: number;
}): StallReplanMessage {
	const lines = [
		"<system-reminder>",
		`Progress check: your recent tool calls are circling without producing new work (${input.reason.trim()}).`,
		...(input.focusStep?.trim() ? [`Current step on your plan: ${input.focusStep.trim()}`] : []),
		"STOP repeating the current approach. Before your next action:",
		"1. State in one or two sentences what you were trying and why it has not worked.",
		"2. Revise your plan — update your focus chain (update_focus_chain) with a concrete DIFFERENT next step.",
		"3. Then take that different action. Do not re-issue the same tool call with the same arguments.",
		"If the task is actually complete or impossible with the available tools, say so and finish per the workflow instead of looping.",
		"</system-reminder>",
	];
	return {
		id: `kanban-stall-replan-${input.now}`,
		role: "user",
		content: [{ type: "text", text: lines.join("\n") }],
		createdAt: input.now,
		metadata: { kind: STALL_REPLAN_MESSAGE_KIND },
	};
}
