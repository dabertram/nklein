import { isLineageDiverse } from "./model-lineage";

/**
 * §5.AW hopelessness short-circuit (audit 2026-07-02, swarm-behavior rank 10). The retry ladder parks only when the
 * budget is spent or every rung is tried — so a card that fails IDENTICALLY across different models keeps grinding
 * the remaining rungs on the fleet's most expensive models. Reasoning-diversity gives us a stronger early signal:
 * TWO DIFFERENT lineages failing with the SAME failure signature is uncorrelated evidence the CARD is the problem
 * (mis-scoped, impossible, or environment-broken) — park it early with an escalate-to-human / re-decompose verdict
 * instead of exhausting the budget. Same-lineage or unknown-lineage repeats prove nothing (correlated blind spots /
 * unprovable), so they never trip the short-circuit.
 */

export interface HopelessnessAttempt {
	/** The REAL model id (lineage-resolvable — not a per-machine alias). */
	modelId: string;
	/** The stable failure-signature kind from `classifyFailureSignature`. */
	signature: string;
}

export type HopelessnessVerdict =
	| { hopeless: true; signature: string; reason: string }
	| { hopeless: false; reason: string };

/** Assess the recent attempt history (oldest→newest) for the cross-lineage identical-failure pattern. Pure. */
export function assessHopelessness(attempts: readonly HopelessnessAttempt[]): HopelessnessVerdict {
	if (attempts.length < 2) {
		return { hopeless: false, reason: "Fewer than two failed attempts — keep the ladder running." };
	}
	const bySignature = new Map<string, HopelessnessAttempt[]>();
	for (const attempt of attempts) {
		const list = bySignature.get(attempt.signature) ?? [];
		list.push(attempt);
		bySignature.set(attempt.signature, list);
	}
	for (const [signature, list] of bySignature) {
		for (let i = 0; i < list.length; i += 1) {
			for (let j = i + 1; j < list.length; j += 1) {
				if (isLineageDiverse(list[i].modelId, list[j].modelId)) {
					return {
						hopeless: true,
						signature,
						reason:
							`Two different model lineages failed identically (${signature}: ${list[i].modelId} and ` +
							`${list[j].modelId}) — uncorrelated evidence the card itself is the problem; park early for ` +
							"human review / re-decomposition instead of burning the remaining ladder.",
					};
				}
			}
		}
	}
	return {
		hopeless: false,
		reason: "No identical failure across diverse lineages — the failures may still be model-specific; keep trying.",
	};
}
