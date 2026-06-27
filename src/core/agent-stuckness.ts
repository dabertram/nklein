// §5.AB bigger-model rescue — the pure "is this agent making progress, or genuinely stuck?" detector.
//
// The crux of the small-LLM hard-limit path (§5.AK direction 2): an agent that keeps FAILING is not necessarily
// stuck. Two very different situations look similar from outside:
//   • TRANSIENT — the model malformed its output (no tool call / narrated call / bad JSON). It can usually GET
//     THERE on a retry or via parse-recovery; this is the AGENTS.md "parse-and-recover, don't re-prompt" class.
//   • HARD-STUCK — a genuine capability/complexity limit: it loops without progress, or the same capability-class
//     failure repeats across multiple distinct approaches with the retry budget burned. A weak model left to
//     thrash here will grind into an unrecoverable hole — this is the case that should escalate to a bigger model
//     for ANALYSIS + remediation guidance (NOT just another retry).
//
// Pure + dependency-free (mirrors `classifyOperatorTaskState`): a normalized signal set in, a verdict out. The
// mapping from the §5.AF ledger's attempt stream to these signals is a separate concern (a later mapper), so this
// classifier stays deterministic and unit-testable.
import type { ModelOutcomeKind } from "./model-behavior-profile";

/** The progress verdict for an agent at a single stuck-point. `hard_stuck` is the bigger-model-rescue trigger. */
export type AgentStuckness = "progressing" | "transient" | "hard_stuck";

/**
 * Failure outcomes that usually reflect a fixable OUTPUT-FORMAT slip — the model can likely get there on a retry or
 * via parse-recovery, so they must NEVER on their own escalate to a bigger model. Everything else
 * (`loop` / `timeout` / `other_failure`) is "capability/limit" class: repeated instances signal a real ceiling.
 */
export const TRANSIENT_OUTCOME_KINDS: readonly ModelOutcomeKind[] = ["no_tool_call", "narrated", "malformed"];

export interface AgentStucknessSignals {
	/**
	 * Recent attempt outcomes for THIS stuck-point, oldest → newest, across approaches/models (from the §5.AF
	 * ledger). A `success` anywhere in the trailing run breaks the stuck-streak.
	 */
	recentOutcomes: readonly ModelOutcomeKind[];
	/** Distinct §5.AA approaches already tried here (endpoint / tool-set / prompt / decoding variations). */
	distinctApproachesTried: number;
	/** A loop was detected AND the salvager could not clear it — a strong capability-limit signal on its own. */
	loopUncleared: boolean;
	/** The learned per-model retry budget is exhausted for the current failure class. */
	retryBudgetExhausted: boolean;
	/** ANY forward progress (a diff / advance / passing check) was observed since this stuck-point began. */
	hadProgressSinceStuck: boolean;
}

export interface AgentStucknessThresholds {
	/** Minimum trailing consecutive non-`success` outcomes before `transient` can become `hard_stuck`. */
	minFailures: number;
	/** Minimum distinct approaches that must have been tried before declaring a capability limit. */
	minApproaches: number;
}

/** Conservative defaults: ride out a couple of stochastic failures and try at least two approaches before escalating. */
export const DEFAULT_AGENT_STUCKNESS_THRESHOLDS: AgentStucknessThresholds = {
	minFailures: 3,
	minApproaches: 2,
};

/** Count the trailing run of consecutive non-`success` outcomes (a recent success → 0). */
function trailingFailureRun(outcomes: readonly ModelOutcomeKind[]): number {
	let run = 0;
	for (let i = outcomes.length - 1; i >= 0; i--) {
		if (outcomes[i] === "success") {
			break;
		}
		run++;
	}
	return run;
}

/**
 * Classify an agent's progress at a stuck-point. Priority: real progress wins (`progressing`); otherwise a genuine
 * capability limit (`hard_stuck`) only when capability-class failures persist across enough distinct approaches AND
 * either a loop is uncleared or the retry budget is burned; everything else still-failing is `transient` (keep
 * recovering — more approaches/retries remain, or the failures are format-only slips).
 */
export function classifyAgentStuckness(
	signals: AgentStucknessSignals,
	thresholds: AgentStucknessThresholds = DEFAULT_AGENT_STUCKNESS_THRESHOLDS,
): AgentStuckness {
	const consecutiveFailures = trailingFailureRun(signals.recentOutcomes);

	// Forward progress, or no current failure streak → not stuck.
	if (signals.hadProgressSinceStuck || consecutiveFailures === 0) {
		return "progressing";
	}

	const hasCapabilityFailure = signals.recentOutcomes.some(
		(outcome) => outcome !== "success" && !TRANSIENT_OUTCOME_KINDS.includes(outcome),
	);
	const enoughFailures = consecutiveFailures >= thresholds.minFailures;
	const enoughApproaches = signals.distinctApproachesTried >= thresholds.minApproaches;
	const exhaustedRecovery = signals.loopUncleared || signals.retryBudgetExhausted;

	// A genuine capability/complexity ceiling — escalate. Format-only slips (no capability failure) never reach here.
	if (hasCapabilityFailure && enoughFailures && enoughApproaches && exhaustedRecovery) {
		return "hard_stuck";
	}

	// Still failing, but plausibly recoverable: format slips, or more approaches/retries remain.
	return "transient";
}

/**
 * §5.AB escalation trigger: a `hard_stuck` verdict means the AUTOMATIC recovery ladder — all §5.AA approaches across
 * ALL available loaded models, best-fit first, with NO user intervention — is exhausted. The caller then escalates to
 * the USER with the "get through the wall" suggestions (`buildEscalationSuggestions`), of which making a more capable
 * model available is only one. There is no automatic mid-pipeline bigger-model tier — loading a bigger model needs the
 * user. (Generic by design: this classifies the attempt stream; the caller owns the ladder/orchestration.)
 */
export function isHardStuck(
	signals: AgentStucknessSignals,
	thresholds: AgentStucknessThresholds = DEFAULT_AGENT_STUCKNESS_THRESHOLDS,
): boolean {
	return classifyAgentStuckness(signals, thresholds) === "hard_stuck";
}

/** The next move for a possibly-stuck task — the §5.AB escalation ladder's decision (pure; the caller effects it). */
export type EscalationAction =
	/** Not (yet) hard-stuck — keep going on the current automatic recovery (approaches/retries). */
	| { kind: "continue" }
	/** Hard-stuck here, but an untried loaded model remains — switch to it automatically (Layer 1, NO user). */
	| { kind: "retry_other_model"; modelId: string }
	/** Hard-stuck AND every loaded model has been tried — escalate to the USER with suggestions (Layer 2). */
	| { kind: "escalate_to_user" };

export interface EscalationDecisionInput {
	signals: AgentStucknessSignals;
	/** Models already attempted for this task (e.g. the §5.AG report's `modelsTried`). */
	triedModelIds: readonly string[];
	/** Currently available/loaded models in best-fit-first order (the next untried one is picked). */
	availableModelIds: readonly string[];
	thresholds?: AgentStucknessThresholds;
}

/**
 * Decide the next escalation move for a task. The corrected ladder (user, 2026-06-27): while not hard-stuck → keep
 * going; once hard-stuck → if a loaded model has NOT been tried yet, switch to the best untried one **automatically**
 * (Layer 1, no user); only when every loaded model has been tried does it escalate to the **user** (Layer 2). Pure —
 * the caller performs the switch / surfaces the escalation.
 */
export function decideEscalationAction(input: EscalationDecisionInput): EscalationAction {
	if (!isHardStuck(input.signals, input.thresholds)) {
		return { kind: "continue" };
	}
	const tried = new Set(input.triedModelIds);
	const nextUntried = input.availableModelIds.find((modelId) => !tried.has(modelId));
	if (nextUntried !== undefined) {
		return { kind: "retry_other_model", modelId: nextUntried };
	}
	return { kind: "escalate_to_user" };
}
