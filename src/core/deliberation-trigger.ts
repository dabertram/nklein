/**
 * §5.AW deliberation TRIGGER gate (audit 2026-07-02 W4.1) — deliberation is ON by default but fires RARELY
 * (DECIDED 2026-07-02): only HIGH-STAKES × LOW-CONFIDENCE decisions earn a multi-agent debate; everything else is
 * compute waste (a trivial or confidently-decided choice gains nothing from a critic). Suppressed entirely when no
 * lineage-diverse capable critic is loaded — a same-family "debate" is correlated noise, so the caller degrades to
 * single-agent + a SURFACED `diversityWaived` flag instead of faking one (research: heterogeneous-team value only
 * materializes with genuinely uncorrelated participants). A per-run COUNT budget bounds total spend.
 */

export interface DeliberationTriggerInput {
	/** How costly a wrong decision is (irreversible/architectural = high; local/easily-changed = low). */
	stakes: "low" | "medium" | "high";
	/** How confident the deciding agent already is (a confident decision needs no debate). */
	confidence: "low" | "medium" | "high";
	/** Is a lineage-diverse, suitability-cleared critic loaded? (See applyDiversityPreference / assessModelSuitability.) */
	diverseCriticAvailable: boolean;
	/** Deliberations remaining in this run's COUNT budget (v1 budget unit — DECIDED 2026-07-02). */
	budgetRemaining: number;
}

export type DeliberationTriggerDecision =
	| { deliberate: true; reason: string }
	| { deliberate: false; reason: string; diversityWaived: boolean };

export function shouldDeliberate(input: DeliberationTriggerInput): DeliberationTriggerDecision {
	if (input.budgetRemaining <= 0) {
		return { deliberate: false, reason: "Deliberation budget for this run is exhausted.", diversityWaived: false };
	}
	if (input.stakes !== "high") {
		return {
			deliberate: false,
			reason: `Stakes are ${input.stakes} — a wrong call is cheap to fix; deliberation would be compute waste.`,
			diversityWaived: false,
		};
	}
	if (input.confidence === "high") {
		return {
			deliberate: false,
			reason: "The decider is already confident — a debate adds latency, not information.",
			diversityWaived: false,
		};
	}
	if (!input.diverseCriticAvailable) {
		return {
			deliberate: false,
			reason:
				"No lineage-diverse capable critic is loaded — a same-family debate is correlated noise; proceeding single-agent with the waiver surfaced.",
			diversityWaived: true,
		};
	}
	return {
		deliberate: true,
		reason: `High-stakes decision with ${input.confidence} confidence and a diverse critic available.`,
	};
}
