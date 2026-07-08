/**
 * §5.AE ProceduralSkillBank — the SAFETY KEYSTONE: the skill lifecycle state machine. A skill distilled from the §5.AF
 * ledger is NEVER trusted on faith; it walks a gated pipeline `candidate → quarantined → active → deprecated` and this
 * pure decider encodes the promotion rules that keep a generated procedure from ever silently steering a run:
 *
 *   - **NEVER auto-activate** a generated skill: a `candidate` can only enter `quarantined` (eval), never jump to
 *     `active`. Activation requires the quarantine to have PASSED deterministic validation AND shown a positive
 *     effectiveness delta vs the no-skill baseline AND a low false-activation (negative-transfer) rate.
 *   - **Track negative transfer aggressively**: an `active` skill whose false-activation rate climbs or whose delta
 *     goes non-positive is DEPRECATED immediately (a skill that started helping can start hurting on new task shapes).
 *   - **`deprecated` is terminal**: a retired skill is not silently resurrected (a fresh candidate is a new record).
 *
 * Pure + total + deterministic — the effectful pipeline (distillation, running the validation suite, measuring the
 * delta) feeds these signals in; this only classifies the next status. Mirrors the §5.AF M4 quarantine posture.
 */

export type SkillLifecycleStatus = "candidate" | "quarantined" | "active" | "deprecated";

export interface SkillLifecycleSignals {
	status: SkillLifecycleStatus;
	/** Did the deterministic replay / dev-test / protected-test validation suite PASS? null = not yet run. */
	validationPassed: boolean | null;
	/** Effectiveness delta vs the no-skill baseline (>0 = the skill helped; ≤0 = neutral/harmful). null = unmeasured. */
	deltaVsBaseline: number | null;
	/** False-activation (negative-transfer) rate in [0,1] — how often the skill fired where it shouldn't have. null = unmeasured. */
	falseActivationRate: number | null;
}

export interface SkillLifecycleThresholds {
	/** Minimum effectiveness delta to promote / stay active (default 0 — must be STRICTLY positive to help). */
	minDelta?: number;
	/** Maximum tolerated false-activation rate before promotion is blocked / an active skill is deprecated (default 0.1). */
	maxFalseActivationRate?: number;
}

export interface SkillLifecycleDecision {
	nextStatus: SkillLifecycleStatus;
	/** True when the status actually changed (convenience for the caller's persist/audit). */
	changed: boolean;
	reason: string;
}

function meetsActivationBar(signals: SkillLifecycleSignals, minDelta: number, maxFalseActivation: number): boolean {
	return (
		signals.validationPassed === true &&
		signals.deltaVsBaseline !== null &&
		signals.deltaVsBaseline > minDelta &&
		signals.falseActivationRate !== null &&
		signals.falseActivationRate <= maxFalseActivation
	);
}

/**
 * Decide the next lifecycle status from the current status + the measured signals. Encodes the "never auto-activate,
 * validate-then-promote, catch negative transfer, deprecation-is-terminal" rules. Pure + total.
 */
export function decideSkillLifecycleTransition(
	signals: SkillLifecycleSignals,
	thresholds: SkillLifecycleThresholds = {},
): SkillLifecycleDecision {
	const minDelta = thresholds.minDelta ?? 0;
	const maxFalseActivation = thresholds.maxFalseActivationRate ?? 0.1;
	const decide = (nextStatus: SkillLifecycleStatus, reason: string): SkillLifecycleDecision => ({
		nextStatus,
		changed: nextStatus !== signals.status,
		reason,
	});

	switch (signals.status) {
		case "candidate":
			// A fresh candidate ALWAYS enters quarantine for eval — it can never jump straight to active.
			return decide(
				"quarantined",
				"New candidate skill enters quarantine for validation — generated skills are never auto-activated.",
			);

		case "quarantined": {
			// Failed validation or a non-positive delta ⇒ deprecate (don't keep a proven-useless skill around).
			if (signals.validationPassed === false) {
				return decide("deprecated", "Quarantined skill FAILED deterministic validation — deprecated.");
			}
			if (signals.deltaVsBaseline !== null && signals.deltaVsBaseline <= minDelta) {
				return decide(
					"deprecated",
					`Quarantined skill showed no positive effectiveness delta (${signals.deltaVsBaseline} ≤ ${minDelta}) — deprecated.`,
				);
			}
			if (meetsActivationBar(signals, minDelta, maxFalseActivation)) {
				return decide(
					"active",
					"Quarantined skill passed validation with a positive delta and low false-activation — promoted to active.",
				);
			}
			return decide(
				"quarantined",
				"Quarantined skill lacks the full activation evidence yet (validation/delta/false-activation) — staying quarantined.",
			);
		}

		case "active": {
			// Negative-transfer watch: a climbing false-activation rate or a delta that went non-positive retires it.
			if (signals.falseActivationRate !== null && signals.falseActivationRate > maxFalseActivation) {
				return decide(
					"deprecated",
					`Active skill's false-activation rate (${signals.falseActivationRate}) exceeded the ${maxFalseActivation} ceiling — deprecated for negative transfer.`,
				);
			}
			if (signals.deltaVsBaseline !== null && signals.deltaVsBaseline <= minDelta) {
				return decide(
					"deprecated",
					`Active skill's effectiveness delta went non-positive (${signals.deltaVsBaseline} ≤ ${minDelta}) — deprecated.`,
				);
			}
			return decide(
				"active",
				"Active skill still validates positively with acceptable false-activation — kept active.",
			);
		}

		case "deprecated":
			// Terminal — a retired skill is not silently resurrected; a re-distillation is a fresh candidate record.
			return decide("deprecated", "Deprecated is terminal — a re-learned procedure enters as a new candidate.");
	}
}
