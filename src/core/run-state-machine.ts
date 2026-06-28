/**
 * Finite-state run controller — PURE decision core (todo §5.AA(a)). Small local models shouldn't own the global process
 * transitions (the §5.Z e2e capstone showed a model "declare all steps done" after only the first tool call); the
 * HARNESS owns them. This is the explicit run state machine: a typed phase ladder + an evidence-driven transition that
 * decides the next phase **from evidence, never the model's self-report**, with the hard guards the spec calls for
 * (no repo mutation before localization; park on exhausted budget / unrecoverable repair; completion requires the
 * acceptance evidence, not a "done" message).
 *
 * Pure + deterministic so it is fully unit-testable; the runtime wiring (driving the SDK/chat loop through these phases,
 * selecting each phase's context + tool subset + budget, and recording every transition on the §5.AF ledger) layers on
 * top. ReAct stays a bounded inner loop *inside* a single phase — never the global driver.
 */

/** The run phases, in nominal forward order. `park` / `escalate` / `done` are terminal. */
export type RunPhase =
	| "intake"
	| "plan"
	| "validate_plan"
	| "localize"
	| "execute_step"
	| "observe"
	| "evaluate"
	| "repair"
	| "retry_or_split"
	| "review"
	| "merge_or_escalate"
	| "done"
	| "park"
	| "escalate";

/** Whether a phase is terminal (the run controller stops driving). */
export function isTerminalRunPhase(phase: RunPhase): boolean {
	return phase === "done" || phase === "park" || phase === "escalate";
}

/**
 * Evidence the controller decides from — all observed facts, never the model's narration. Every field is optional so a
 * caller supplies only what the current phase can observe; the transition treats missing evidence conservatively
 * (it does not advance on an unproven precondition).
 */
export interface RunEvidence {
	/** The plan/decomposition exists and is structurally valid (a coherent DAG / acceptance shape). */
	planValid?: boolean;
	/** The change site has been localized (files/symbols identified) — required before any repo mutation. */
	localized?: boolean;
	/** The just-executed step produced its intended, observable effect (e.g. the file/card/marker exists). */
	stepSucceeded?: boolean;
	/** Every required step's acceptance evidence is present (the run's real done-condition). */
	allStepsComplete?: boolean;
	/** A repair attempt for the failed step restored a workable state. */
	repairSucceeded?: boolean;
	/** The review/acceptance check passed (e.g. a planted-defect reviewer found nothing, tests green). */
	reviewPassed?: boolean;
	/** The phase's tool-call or wall-time budget is spent (controller-owned, not the model's call). */
	budgetExhausted?: boolean;
	/** Local repair can't restore coherence — a re-decompose/split is needed. */
	needsSplit?: boolean;
	/** Every recovery rung has been tried for this step (no untried strategy remains). */
	rungsExhausted?: boolean;
}

export interface RunPhaseDecision {
	next: RunPhase;
	/** Inspectable, evidence-based reason (for the §5.AF ledger transition record + §5.AG surface). */
	reason: string;
}

/**
 * Decide the next phase from the current phase + observed evidence. Conservative by construction: an unproven
 * precondition never advances (it re-runs the current phase or parks when the budget is spent), repo mutation
 * (`execute_step`) is unreachable until `localized`, and `done` requires `allStepsComplete` + `reviewPassed` evidence —
 * a model claiming completion without it does NOT finish the run.
 */
export function decideNextPhase(current: RunPhase, evidence: RunEvidence): RunPhaseDecision {
	// Budget exhaustion always wins over forward progress (except from terminal phases) — park for review/escalation.
	if (!isTerminalRunPhase(current) && evidence.budgetExhausted) {
		return { next: "park", reason: `Phase "${current}" budget exhausted — parking for review/escalation.` };
	}

	switch (current) {
		case "intake":
			return { next: "plan", reason: "Intake complete — proceed to planning." };
		case "plan":
			return { next: "validate_plan", reason: "Plan drafted — validate it before acting." };
		case "validate_plan":
			return evidence.planValid
				? { next: "localize", reason: "Plan is valid — localize the change site before mutating." }
				: { next: "plan", reason: "Plan invalid — replan (no acting on an invalid plan)." };
		case "localize":
			// HARD GUARD: never enter execute_step (repo mutation) before localization is proven.
			return evidence.localized
				? { next: "execute_step", reason: "Change site localized — safe to execute the step." }
				: { next: "localize", reason: "Not yet localized — repo mutation is forbidden until it is." };
		case "execute_step":
			return { next: "observe", reason: "Step executed — observe its actual effect." };
		case "observe":
			return { next: "evaluate", reason: "Effect observed — evaluate against acceptance evidence." };
		case "evaluate":
			if (evidence.allStepsComplete) {
				return { next: "review", reason: "All required steps have acceptance evidence — proceed to review." };
			}
			if (evidence.stepSucceeded) {
				// This step is done but more remain — drive the NEXT step (evidence-based, not a model "done" claim).
				return {
					next: "execute_step",
					reason: "Step succeeded but the run is incomplete — execute the next step.",
				};
			}
			return { next: "repair", reason: "Step did not produce its intended effect — attempt repair." };
		case "repair":
			return evidence.repairSucceeded
				? { next: "evaluate", reason: "Repair restored a workable state — re-evaluate." }
				: { next: "retry_or_split", reason: "Repair did not fix it — decide retry vs split." };
		case "retry_or_split":
			if (evidence.needsSplit) {
				return { next: "plan", reason: "Local repair can't restore coherence — re-decompose (split) and replan." };
			}
			if (evidence.rungsExhausted) {
				return { next: "escalate", reason: "Every recovery rung tried without success — escalate." };
			}
			return {
				next: "execute_step",
				reason: "Untried recovery rung remains — retry the step with the next strategy.",
			};
		case "review":
			return evidence.reviewPassed
				? { next: "merge_or_escalate", reason: "Review passed — proceed to merge/finish." }
				: { next: "repair", reason: "Review failed (e.g. a defect found) — repair before finishing." };
		case "merge_or_escalate":
			return { next: "done", reason: "Merged/finished — run complete." };
		default:
			// Terminal phases stay put.
			return { next: current, reason: `Phase "${current}" is terminal.` };
	}
}
