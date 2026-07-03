/**
 * §5.AC CLAIM-ADMISSIBILITY gate — the AND of the two independent "may we assert this?" axes the lighthouse defines:
 * CORROBORATION (is there enough INDEPENDENT backing?) and TEMPORAL consistency (is it dated consistently with today?).
 *
 * WHY. §5.AC already ships two orthogonal per-claim gates, but each answers only HALF the admission question and neither
 * knows about the other:
 *   • `claim-corroboration-requirement.ts` → is the claim backed by enough INDEPENDENT, trustworthy origins?
 *   • `temporal-claim-consistency.ts`      → is the claim's asserted date consistent with the authoritative "now"?
 * A synthesis step must clear BOTH before presenting a claim as an established current fact — and crucially the two are
 * INDEPENDENT: strong corroboration does NOT rescue a temporally-broken claim, and a perfectly-current date does NOT
 * excuse single-sourcing. The adversarial case that motivates this module: a future-dated ("anachronistic") claim backed
 * by two impeccable authoritative sources. The local model's stale training prior makes the future date look already-past,
 * so it treats the well-cited claim as fact — but a temporally-grounded agent MUST NOT, because the state has not
 * happened yet. Two good sources cannot rescue a not-yet claim. No single existing core enforces that conjunction; this
 * one does, by composing both gates BY IMPORT and admitting only when BOTH pass.
 *
 * WHAT. {@link resolveClaimAdmissibility} takes ONE claim carrying BOTH gates' inputs (its cited `sources` +
 * `loadBearing` flag for corroboration; its `asOf`/`validUntil` for temporal), plus the injected `now`, runs both gates,
 * and returns `{ corroboration, temporal, admissible, reason }`:
 *   • `corroboration` — the full {@link CorroborationVerdict} from `resolveCorroborationRequirement`.
 *   • `temporal`      — the full {@link ClaimTemporalConsistency} from `checkClaimTemporalConsistency`.
 *   • `admissible`    — `isClaimCorroborated(corroboration.status) && isClaimAssertable(temporal.status)` — the AND.
 *   • `reason`        — names WHICH gate(s) failed (or that both passed), so a synthesis/telemetry step can act.
 *
 * BOUNDARY. This module DECIDES nothing new on its own — it neither scores sources, counts origins, nor parses dates; it
 * DELEGATES entirely to the two composed cores and only combines their booleans + composes a reason. It re-implements
 * neither gate and edits neither source file (it imports the public verdict/status types + the `isClaim*` predicates).
 *
 * PRIME DIRECTIVE #1: DECIDES only — NO retrieval/egress/I/O/model/UI/fs, and NO ambient clock: the temporal gate's `now`
 * is INJECTED (the corroboration gate is inherently clock-free). Every input is a plain value; pure + deterministic →
 * fully unit-testable. The same claim + same `now` always yields the same admissibility verdict.
 */

import {
	type CorroborationClaim,
	type CorroborationOptions,
	type CorroborationVerdict,
	isClaimCorroborated,
	resolveCorroborationRequirement,
} from "./claim-corroboration-requirement";
import {
	type ClaimTemporalConsistency,
	type ClaimTemporalConsistencyOptions,
	checkClaimTemporalConsistency,
	type DatedClaim,
	isClaimAssertable,
} from "./temporal-claim-consistency";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * A claim carrying BOTH gates' inputs. It IS a {@link CorroborationClaim} (id + cited `sources` + `loadBearing`) AND a
 * {@link DatedClaim} (optional `asOf` / `validUntil`) — the two input surfaces are disjoint, so one flat shape carries
 * both without overlap. The composed gates read only their own fields.
 */
export interface AdmissibleClaim extends CorroborationClaim, DatedClaim {}

/** Tuning knobs for the two composed gates, each forwarded verbatim (both optional; every value is INJECTED). */
export interface ClaimAdmissibilityOptions {
	/** Options forwarded to `resolveCorroborationRequirement` (independent-origin floor, scorer options). */
	corroboration?: CorroborationOptions;
	/** Options forwarded to `checkClaimTemporalConsistency` (the forward-tolerance `graceDays`). */
	temporal?: ClaimTemporalConsistencyOptions;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/** The combined admissibility verdict: both sub-verdicts in full, the AND'd decision, and a gate-naming reason. */
export interface ClaimAdmissibility {
	/** The full corroboration sub-verdict (delegated, unmodified). */
	corroboration: CorroborationVerdict;
	/** The full temporal-consistency sub-verdict (delegated, unmodified). */
	temporal: ClaimTemporalConsistency;
	/** `true` ONLY when BOTH gates pass — corroborated AND temporally assertable. Neither axis can rescue the other. */
	admissible: boolean;
	/** Plain-language rationale naming which gate(s) failed (or confirming both passed). */
	reason: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Judge whether ONE claim is admissible as an established current fact by running BOTH §5.AC gates and AND-ing them
 * (pure; `now` injected for the temporal axis).
 *
 * A claim is `admissible` iff `isClaimCorroborated(corroboration.status) && isClaimAssertable(temporal.status)`. The two
 * axes are INDEPENDENT and neither rescues the other: a future-dated (anachronistic) or expired (stale) claim is
 * inadmissible however well it is corroborated, and a single-sourced/uncorroborated claim is inadmissible however current
 * its date. The `reason` names the failing gate(s) so a synthesis/telemetry step can drop, flag, or re-search.
 *
 * Deterministic and total: it delegates to the two composed gates (each itself total), combines their booleans, and never
 * fetches, mutates, or reads an ambient clock.
 */
export function resolveClaimAdmissibility(
	claim: AdmissibleClaim,
	now: Date,
	options: ClaimAdmissibilityOptions = {},
): ClaimAdmissibility {
	const corroboration = resolveCorroborationRequirement(claim, options.corroboration);
	const temporal = checkClaimTemporalConsistency(claim, now, options.temporal);

	const corroborated = isClaimCorroborated(corroboration.status);
	const assertable = isClaimAssertable(temporal.status);
	const admissible = corroborated && assertable;

	return { corroboration, temporal, admissible, reason: reasonFor(corroborated, assertable, corroboration, temporal) };
}

/**
 * Compose the gate-naming reason. Names the failing gate(s) — both, corroboration-only, or temporal-only — quoting each
 * sub-verdict's own status + rail so the caller sees WHY without re-deriving it; on full pass, confirms both cleared.
 */
function reasonFor(
	corroborated: boolean,
	assertable: boolean,
	corroboration: CorroborationVerdict,
	temporal: ClaimTemporalConsistency,
): string {
	if (corroborated && assertable) {
		return `Admissible — both gates pass: corroboration is "${corroboration.status}" and temporal is "${temporal.status}".`;
	}
	const failures: string[] = [];
	if (!corroborated) {
		failures.push(`CORROBORATION gate failed ("${corroboration.status}"): ${corroboration.reason}`);
	}
	if (!assertable) {
		failures.push(`TEMPORAL gate failed ("${temporal.status}"): ${temporal.reason}`);
	}
	return `Inadmissible — ${failures.join(" | ")}`;
}
