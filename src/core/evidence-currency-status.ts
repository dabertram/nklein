/**
 * F4.3 — "is this current?" evidence-currency status (pure). Surfaces the DATE / CONFLICT / SUPPORT status of retrieved
 * evidence in agent output so a reader can judge whether an answer rests on fresh, corroborated sources — WITHOUT
 * leaking raw untrusted retrieved text (which could carry prompt injection). The annotation is sanitized BY
 * CONSTRUCTION: it emits only counts, ages, trust tiers, and a status word — never the evidence body.
 *
 * Pure + deterministic (clock injected). Composes over what the retrieval layer already records (source dates, trust,
 * support, conflicts); the caller renders the returned annotation next to the answer.
 */

export type EvidenceTrust = "high" | "medium" | "low" | "unknown";

export interface CurrencyEvidence {
	readonly id: string;
	/** Publication/evidence date (ms epoch), or null when undated. */
	readonly sourceDateMs: number | null;
	readonly trust: EvidenceTrust;
	/** Whether this evidence SUPPORTS the claim (false = neutral/contradicting context). */
	readonly supports: boolean;
	/** Ids of other evidence this one conflicts with (non-empty ⇒ a currency conflict). */
	readonly conflictsWithIds: readonly string[];
}

export type EvidenceCurrencyStatus = "current" | "aging" | "stale" | "conflicted" | "unsupported" | "unknown";

export interface EvidenceCurrencyConfig {
	/** Newest supporting source younger than this ⇒ current. Default 30 days. */
	readonly freshWindowMs: number;
	/** Newest supporting source younger than this (but ≥ fresh) ⇒ aging; older ⇒ stale. Default 180 days. */
	readonly agingWindowMs: number;
}

export const DEFAULT_EVIDENCE_CURRENCY_CONFIG: EvidenceCurrencyConfig = {
	freshWindowMs: 30 * 24 * 60 * 60 * 1000,
	agingWindowMs: 180 * 24 * 60 * 60 * 1000,
};

export interface EvidenceCurrencySummary {
	readonly status: EvidenceCurrencyStatus;
	/** Newest supporting-source date (ms), or null when none/undated. */
	readonly newestSupportingDateMs: number | null;
	readonly supportCount: number;
	readonly conflictCount: number;
	readonly highTrustSupportCount: number;
	/** A sanitized, injection-safe one-line annotation (counts/ages/status only — never raw evidence text). */
	readonly annotation: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function summarizeEvidenceCurrency(
	evidence: readonly CurrencyEvidence[],
	now: number,
	config: EvidenceCurrencyConfig = DEFAULT_EVIDENCE_CURRENCY_CONFIG,
): EvidenceCurrencySummary {
	const supporting = evidence.filter((e) => e.supports);
	const conflictPairs = new Set<string>();
	for (const e of evidence) {
		for (const otherId of e.conflictsWithIds) {
			conflictPairs.add([e.id, otherId].sort().join("::"));
		}
	}
	const conflictCount = conflictPairs.size;
	const highTrustSupportCount = supporting.filter((e) => e.trust === "high").length;
	const supportDates = supporting.map((e) => e.sourceDateMs).filter((d): d is number => d !== null);
	const newestSupportingDateMs = supportDates.length > 0 ? Math.max(...supportDates) : null;

	let status: EvidenceCurrencyStatus;
	if (conflictCount > 0) {
		status = "conflicted";
	} else if (supporting.length === 0) {
		status = "unsupported";
	} else if (newestSupportingDateMs === null) {
		status = "unknown";
	} else {
		const ageMs = Math.max(0, now - newestSupportingDateMs);
		status = ageMs <= config.freshWindowMs ? "current" : ageMs <= config.agingWindowMs ? "aging" : "stale";
	}

	const agePhrase =
		newestSupportingDateMs !== null
			? `newest ${Math.floor((now - newestSupportingDateMs) / MS_PER_DAY)}d old`
			: "undated";
	const annotation =
		`Evidence: ${supporting.length} supporting (${highTrustSupportCount} high-trust), ${agePhrase}, ` +
		`${conflictCount} conflict${conflictCount === 1 ? "" : "s"} — ${status}.`;

	return {
		status,
		newestSupportingDateMs,
		supportCount: supporting.length,
		conflictCount,
		highTrustSupportCount,
		annotation,
	};
}
