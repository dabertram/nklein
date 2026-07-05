/**
 * §5.M / §5.N — the focus-chain NUDGE decision (pure core). A focus chain (an agent's ordered task checklist) keeps a
 * small model on-task, but only matters for MULTI-STEP work. This decides whether a running task that has NOT drafted a
 * chain should get an optional re-prompt to draft one first: nudge a non-trivial, tools-offered task with no chain; stay
 * quiet for a task that already has one, a trivial single-step task, or a no-tool (pure-answer) turn where a checklist
 * is overhead. The effectful re-prompt (emitting the nudge message) is the caller's; this is the policy. Pure + total.
 */

export interface FocusChainNudgeInput {
	/** Whether the task/session already has a focus chain drafted. */
	hasFocusChain: boolean;
	/** How many tools are offered this turn — multi-tool work benefits from a plan; a no-tool answer turn doesn't. */
	toolsOffered: number;
	/** True for a trivial / single-step task where a checklist is pure overhead. */
	trivial?: boolean;
}

export interface FocusChainNudgeDecision {
	nudge: boolean;
	reason: string;
}

/** Decide whether to nudge a chain-less task to draft one first (pure). */
export function decideFocusChainNudge(input: FocusChainNudgeInput): FocusChainNudgeDecision {
	if (input.hasFocusChain) {
		return { nudge: false, reason: "A focus chain is already drafted." };
	}
	if (input.trivial === true) {
		return { nudge: false, reason: "Trivial / single-step task — a checklist is overhead." };
	}
	if (input.toolsOffered <= 0) {
		return { nudge: false, reason: "No tools offered — no multi-step work to chain." };
	}
	return { nudge: true, reason: "Multi-step task with no focus chain — nudge to draft one first." };
}
