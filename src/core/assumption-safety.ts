/**
 * Assumption-safety decider (todo.md §5.S) — the pure "clarify vs. assume-and-log" gate.
 *
 * §5.S makes a blocking clarifying question first-class: when a task hits an under-specified fork, it can PAUSE and
 * ask the user. But asking has a cost (it stalls the run and interrupts the user), so an agent should only stop when
 * guessing would actually be dangerous. The two neighbouring modules cover different steps:
 *   - `clarification-need.ts` scores *how ambiguous the raw request is* (should a question exist at all?);
 *   - `auto-clarify.ts` runs the architect↔reviewer loop *once a question exists*, and, when it stalls, "gives up
 *     with an assumption" so planning never blocks.
 * Neither decides the orthogonal, decision-theoretic question this module owns: for a *specific* default assumption
 * the agent is about to make, is it SAFE to make it silently? That depends not on ambiguity strength but on the cost
 * of being wrong — the assumption's **reversibility** (how cheaply a wrong guess can be undone), the agent's
 * **confidence** it guessed right, and the **impact** / blast-radius if it did not. An irreversible, low-confidence,
 * high-impact default should stop and ASK even under high autonomy; a trivially-reversible, high-confidence default
 * should just proceed. In between, the agent can proceed but FLAG the assumption for review.
 *
 * Pure + deterministic + NO model call: the reversibility / confidence / impact estimates are *injected* (the wiring
 * or a model turn supplies them upstream), and the same inputs always yield the same verdict — so this belongs in the
 * lower `core` layer and is fully unit-testable. It composes with the neighbours by import (see `clarifyOrAssume`),
 * without editing them: `assessClarificationNeed` decides *whether to open a question*; this decides, for a default
 * the agent would otherwise adopt, *whether that default is safe to adopt silently or must become a blocking ask*.
 */

import { assessClarificationNeed, type ClarificationMode } from "./clarification-need";

/**
 * How autonomously to treat a candidate assumption. Mirrors `ClarificationMode` (§5.S shares one operator setting):
 * higher autonomy tolerates a riskier silent guess before it insists on stopping to ask.
 */
export type AssumptionMode = ClarificationMode;

/**
 * How cheaply a wrong assumption can be undone. This is the dominant safety axis: a reversible guess is low-stakes
 * (proceed, correct later), an irreversible one is high-stakes (a wrong guess cannot be taken back).
 */
export type Reversibility =
	/** Trivially undone with no lasting effect (an in-memory default, a re-runnable choice). */
	| "reversible"
	/** Undoable, but only at real cost (rework, a migration, re-review). */
	| "costly"
	/** Cannot be undone (a destructive action, an external side effect, a committed irreversible decision). */
	| "irreversible";

/** A candidate default the agent is considering adopting instead of pausing to ask (§5.S). */
export interface CandidateAssumption {
	/** How hard a wrong guess is to undo — the dominant safety axis. */
	reversibility: Reversibility;
	/**
	 * The agent's confidence, in [0, 1], that this default is what the user would have chosen. Injected (a model /
	 * heuristic estimate upstream); clamped defensively. Higher confidence lowers the expected cost of guessing.
	 */
	confidence: number;
	/**
	 * The blast-radius if the guess is wrong, in [0, 1] — 0 = cosmetic/local, 1 = broad, hard-to-contain damage.
	 * Injected; clamped defensively. Higher impact raises the expected cost of guessing.
	 */
	impact: number;
	/** Optional short human-readable note about the assumption — surfaced verbatim in the verdict rationale. */
	summary?: string;
}

/** What to do with a candidate assumption. Ordered from most autonomous (`assume_and_log`) to safest (`ask`). */
export type AssumptionAction =
	/** Safe to adopt silently — proceed and record it in the decision log (still overridable later). */
	| "assume_and_log"
	/** Adopt to keep moving, but surface it for review (a soft flag) because it carries some residual risk. */
	| "assume_but_flag"
	/** Too risky to guess — stop and raise a blocking clarifying question to the user (the §5.S pause). */
	| "ask";

/** The decision plus the risk figures that produced it (all deterministic — safe to log / display). */
export interface AssumptionDecision {
	action: AssumptionAction;
	/**
	 * Expected cost of adopting the assumption silently, in [0, 1]: `(1 - confidence) * impact * reversibilityWeight`.
	 * Higher = riskier to guess. This is the scalar the mode thresholds gate on.
	 */
	risk: number;
	/** The mode the decision was computed for. */
	mode: AssumptionMode;
	/** Why this action was chosen — safe to surface in a "why we're asking / why we assumed" explanation. */
	reason: string;
}

/**
 * How much each reversibility level amplifies the expected cost of a wrong silent guess. Reversible guesses are
 * cheap even when wrong; irreversible ones are maximally penalised (a wrong irreversible guess is the worst case).
 */
export const REVERSIBILITY_WEIGHTS: Readonly<Record<Reversibility, number>> = {
	reversible: 0.25,
	costly: 0.6,
	irreversible: 1,
};

/**
 * Per-mode risk thresholds. A candidate is escalated one step (`assume_and_log` → `assume_but_flag` → `ask`) as its
 * risk crosses these gates. Lower gates = escalates sooner = asks more (cautious); higher gates = tolerates more
 * silent risk (autonomous). `flag` must be ≤ `ask` within each mode (checked by a unit test).
 */
export const MODE_RISK_GATES: Readonly<Record<AssumptionMode, { flag: number; ask: number }>> = {
	cautious: { flag: 0.1, ask: 0.3 },
	balanced: { flag: 0.25, ask: 0.55 },
	autonomous: { flag: 0.45, ask: 0.8 },
};

/** Clamp a possibly-dirty injected number into [0, 1]; non-finite / missing collapses to the safe extreme `fallback`. */
function clamp01(value: number, fallback: number): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(1, Math.max(0, value));
}

/**
 * Expected cost, in [0, 1], of adopting `candidate` silently when it might be wrong:
 *   `(1 - confidence) * impact * reversibilityWeight`.
 * Pure + deterministic. Missing/NaN confidence is treated as 0 (worst case — assume we might be wrong) and missing
 * impact as 1 (worst case — assume broad damage), so dirty inputs fail safe toward asking.
 */
export function assumptionRisk(candidate: CandidateAssumption): number {
	const confidence = clamp01(candidate.confidence, 0);
	const impact = clamp01(candidate.impact, 1);
	const weight = REVERSIBILITY_WEIGHTS[candidate.reversibility] ?? REVERSIBILITY_WEIGHTS.irreversible;
	return (1 - confidence) * impact * weight;
}

/**
 * Decide whether a candidate default is safe to adopt silently, adopt-but-flag, or must become a blocking ask (§5.S).
 * Pure: same candidate + mode → same verdict. An irreversible assumption is never allowed to slip through as a silent
 * `assume_and_log`, regardless of how low its computed risk is — a wrong irreversible guess is the one outcome §5.S
 * exists to prevent, so it is floored to at least `assume_but_flag`.
 */
export function decideAssumptionSafety(
	candidate: CandidateAssumption,
	mode: AssumptionMode = "balanced",
): AssumptionDecision {
	const risk = assumptionRisk(candidate);
	const gates = MODE_RISK_GATES[mode];
	const note = candidate.summary?.trim() ? ` (${candidate.summary.trim()})` : "";

	let action: AssumptionAction;
	let reason: string;
	if (risk >= gates.ask) {
		action = "ask";
		reason = `Risk ${risk.toFixed(2)} ≥ the ${mode} ask gate ${gates.ask.toFixed(2)} — too risky to guess; ask${note}.`;
	} else if (risk >= gates.flag) {
		action = "assume_but_flag";
		reason = `Risk ${risk.toFixed(2)} ≥ the ${mode} flag gate ${gates.flag.toFixed(2)} — proceed on the assumption but flag it for review${note}.`;
	} else {
		action = "assume_and_log";
		reason = `Risk ${risk.toFixed(2)} < the ${mode} flag gate ${gates.flag.toFixed(2)} — safe to assume and log${note}.`;
	}

	// Safety floor: an irreversible guess must never be adopted *silently*. Even at low computed risk, surface it.
	if (candidate.reversibility === "irreversible" && action === "assume_and_log") {
		action = "assume_but_flag";
		reason = `Irreversible assumption — never adopted silently; proceed but flag it for review${note}.`;
	}

	return { action, risk, mode, reason };
}

/** The combined verdict: the ambiguity gate's take and the assumption-safety take, plus the resolved action. */
export interface ClarifyOrAssumeDecision extends AssumptionDecision {
	/** True when `clarification-need` judged the request ambiguous enough to warrant a question in this mode. */
	requestNeedsClarification: boolean;
}

/**
 * Compose the two §5.S gates for the common flow (proceed by importing the neighbour, not editing it): first ask
 * `clarification-need` whether the *request itself* is ambiguous enough to warrant a question; then, if it is, weigh
 * the *specific default* the agent would otherwise adopt via `decideAssumptionSafety`. If the request is not ambiguous,
 * there is nothing to clarify and the default stands (`assume_and_log`). If it is ambiguous but the default is safe
 * (reversible, confident, low-impact), the agent may still proceed on it rather than stopping — only a genuinely risky
 * default forces the §5.S pause. Pure + deterministic.
 */
export function clarifyOrAssume(
	request: string | null | undefined,
	candidate: CandidateAssumption,
	mode: AssumptionMode = "balanced",
): ClarifyOrAssumeDecision {
	const requestNeedsClarification = assessClarificationNeed(request, mode).needsClarification;
	if (!requestNeedsClarification) {
		const risk = assumptionRisk(candidate);
		return {
			action: "assume_and_log",
			risk,
			mode,
			requestNeedsClarification: false,
			reason: "The request is not ambiguous in this mode — proceed on the default; nothing to clarify.",
		};
	}
	const decision = decideAssumptionSafety(candidate, mode);
	return { ...decision, requestNeedsClarification: true };
}
