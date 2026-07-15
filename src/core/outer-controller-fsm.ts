/**
 * F3.12 — the outer-controller finite state machine (pure). The controller drives a task through
 * orient → plan → act → verify → repair → finish; this core owns the TRANSITION decision (given the current phase and
 * the phase's outcome, what's next?) as a pure, total, deterministic state machine, so the effectful driver (which
 * actually runs each phase against models/tools) stays a thin loop over {@link advanceController}. Bounded by a repair
 * cap so a task that can't pass verification lands in `failed` instead of cycling forever.
 */

export type ControllerPhase = "orient" | "plan" | "act" | "verify" | "repair" | "finish" | "failed";

/** The result a phase reports back: it advanced cleanly, it needs a repair loop, or it hit a hard block. */
export type PhaseOutcome = "ok" | "needs_repair" | "blocked";

export interface ControllerState {
	readonly phase: ControllerPhase;
	/** How many repair→act cycles have run (bounds the loop). */
	readonly repairCount: number;
}

export interface ControllerFsmConfig {
	/** Max repair cycles before the task fails out instead of retrying act. Default 3. */
	readonly maxRepairCycles: number;
}

export const DEFAULT_CONTROLLER_FSM_CONFIG: ControllerFsmConfig = { maxRepairCycles: 3 };

export const INITIAL_CONTROLLER_STATE: ControllerState = { phase: "orient", repairCount: 0 };

/** Terminal phases have no outgoing transition. */
export function isTerminalPhase(phase: ControllerPhase): boolean {
	return phase === "finish" || phase === "failed";
}

/**
 * The transition function: given the current state + the phase outcome, return the next state. Pure + total.
 *  - Any `blocked` outcome fails the task immediately (a hard block is not repairable here).
 *  - `orient/plan/act` advance on `ok`; `act` needing repair routes to `repair`.
 *  - `verify` on `ok` finishes; on `needs_repair` routes to `repair`.
 *  - `repair` on `ok` loops back to `act` (incrementing the cycle count) UNLESS the cap is hit ⇒ `failed`.
 *  - Terminal states are absorbing (return unchanged).
 */
export function advanceController(
	state: ControllerState,
	outcome: PhaseOutcome,
	config: ControllerFsmConfig = DEFAULT_CONTROLLER_FSM_CONFIG,
): ControllerState {
	if (isTerminalPhase(state.phase)) {
		return state;
	}
	if (outcome === "blocked") {
		return { phase: "failed", repairCount: state.repairCount };
	}
	switch (state.phase) {
		case "orient":
			return { phase: "plan", repairCount: state.repairCount };
		case "plan":
			return { phase: "act", repairCount: state.repairCount };
		case "act":
			return outcome === "needs_repair"
				? { phase: "repair", repairCount: state.repairCount }
				: { phase: "verify", repairCount: state.repairCount };
		case "verify":
			return outcome === "needs_repair"
				? { phase: "repair", repairCount: state.repairCount }
				: { phase: "finish", repairCount: state.repairCount };
		case "repair": {
			const nextRepairCount = state.repairCount + 1;
			return nextRepairCount > config.maxRepairCycles
				? { phase: "failed", repairCount: nextRepairCount }
				: { phase: "act", repairCount: nextRepairCount };
		}
		default:
			return state;
	}
}

/**
 * Project a real card-lifecycle transition (`to` value) onto the controller's phase vocabulary — an observability
 * mapping so a card's actual trajectory can be read in orient→plan→act→verify→repair→finish terms (validates the FSM
 * vocabulary covers real lifecycles). Returns null for transitions that don't correspond to a controller phase.
 */
export function classifyLifecyclePhase(transitionTo: string): ControllerPhase | null {
	const to = transitionTo.toLowerCase();
	if (to === "wf:planning" || to === "wf:idle" || to === "idle") {
		return "plan";
	}
	if (to === "running" || to === "wf:implementing" || to.startsWith("focus:in_progress")) {
		return "act";
	}
	if (to === "awaiting_review" || to === "wf:awaiting_review" || to === "wf:awaiting_acceptance") {
		return "verify";
	}
	if (to === "delivery_merge" || to === "completed") {
		return "finish";
	}
	if (
		to === "review_changes_requested" ||
		to === "delivery_open_pr" ||
		to === "delivery_commit" ||
		to.startsWith("trouble_") ||
		to.startsWith("remediation_")
	) {
		return "repair";
	}
	if (to === "failed" || to === "wf:failed" || to === "interrupted") {
		return "failed";
	}
	return null;
}

/** The sequence of controller phases a card actually passed through (dedup consecutive repeats), from its transitions. */
export function projectCardControllerTrace(transitionTos: readonly string[]): ControllerPhase[] {
	const trace: ControllerPhase[] = [];
	for (const to of transitionTos) {
		const phase = classifyLifecyclePhase(to);
		if (phase !== null && trace[trace.length - 1] !== phase) {
			trace.push(phase);
		}
	}
	return trace;
}

/** Convenience: run a full outcome sequence from the initial state (for tests / dry-runs). Pure. */
export function runControllerSequence(
	outcomes: readonly PhaseOutcome[],
	config: ControllerFsmConfig = DEFAULT_CONTROLLER_FSM_CONFIG,
): ControllerState {
	let state = INITIAL_CONTROLLER_STATE;
	for (const outcome of outcomes) {
		if (isTerminalPhase(state.phase)) {
			break;
		}
		state = advanceController(state, outcome, config);
	}
	return state;
}
