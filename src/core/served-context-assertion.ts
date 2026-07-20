/**
 * P21.3 — ASSERT the served context length; never assume it. PURE core (the decision; the probe is effectful).
 *
 * Ollama's 2k default "silently discards context that exceeds the window" — Aider: "especially dangerous because
 * many users don't even realize most of their data is being discarded." An endpoint advertises 32k, serves 2k,
 * and every routing decision built on the advertised number is quietly wrong. Prime directive #3 currently
 * trusts what the endpoint advertises; this refuses to.
 *
 * ── THE SAFETY DEFAULT IS THE POINT: UNVERIFIED IS NOT ROUTABLE ──
 * A model whose served context was never probed resolves to `unverified` and `routable: false`. That is
 * deliberately the same direction as the CodeAct gate and the residency recommender: absent evidence resolves to
 * "no", because the failure this guards is SILENT — a routed model that discards half its prompt produces a
 * confidently-wrong answer with no error, and the only way to never ship that is to not route on a number nobody
 * checked. A false "unverified" costs a probe; a false "verified" costs a silent truncation in production.
 *
 * ── WHY A TOLERANCE, AND WHY IT IS BELOW NOT ABOVE ──
 * A probe rarely lands on the exact advertised figure (chat-template tokens, BOS/EOS, rounding). So "served ≥
 * advertised × (1 − tolerance)" counts as verified. The tolerance is one-sided BELOW: serving MORE than advertised
 * is fine, serving materially less is the lie. A symmetric band would forgive exactly the shortfall that matters.
 */

export type ServedContextVerdict = "verified" | "silently_truncated" | "unverified";

export interface ServedContextInput {
	/** Context window the endpoint ADVERTISES (config / model card). */
	readonly advertisedContextTokens: number;
	/** Context the endpoint actually SERVED in a probe — null when not probed. */
	readonly probedServedContextTokens: number | null;
	/** Fraction below advertised still counted as verified (template/BOS slack). Default 0.1. */
	readonly tolerance?: number;
}

export interface ServedContextAssessment {
	readonly verdict: ServedContextVerdict;
	/** Whether it is safe to ROUTE at the advertised context. Only a `verified` probe permits it. */
	readonly routable: boolean;
	/** The context length safe to actually USE — the probed served value when known, else 0 (never the advertised guess). */
	readonly safeContextTokens: number;
	readonly reason: string;
}

export function assessServedContext(input: ServedContextInput): ServedContextAssessment {
	const advertised = Math.max(0, Math.trunc(input.advertisedContextTokens));
	const tolerance = input.tolerance ?? 0.1;

	if (input.probedServedContextTokens === null || !Number.isFinite(input.probedServedContextTokens)) {
		return {
			verdict: "unverified",
			routable: false,
			// NOT the advertised value: routing on an unprobed advertised number is the exact mistake this exists to
			// prevent, so the safe-to-use figure is 0 until a probe says otherwise.
			safeContextTokens: 0,
			reason:
				"served context was NOT probed — routing on the advertised value is what P21.3 forbids, because an endpoint that serves less discards the overflow SILENTLY. Probe it, or do not route on this length.",
		};
	}

	const served = Math.max(0, Math.trunc(input.probedServedContextTokens));
	const floor = Math.floor(advertised * (1 - tolerance));

	if (served >= floor) {
		return {
			verdict: "verified",
			routable: true,
			safeContextTokens: served,
			reason: `probe served ${served} token(s) against an advertised ${advertised} (≥ ${floor} floor) — the endpoint honours its window, safe to route`,
		};
	}

	return {
		verdict: "silently_truncated",
		routable: false,
		// The served value IS usable — it is what the endpoint really gives — but routing at the advertised length is not.
		safeContextTokens: served,
		reason: `probe served only ${served} of an advertised ${advertised} token(s) (below the ${floor} floor) — the endpoint SILENTLY discards the overflow. Route at ${served}, never at ${advertised}; the advertised figure is a lie for this endpoint (the Ollama-2k-default trap)`,
	};
}
