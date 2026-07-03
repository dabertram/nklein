/**
 * ADMISSIBILITY-gated cited synthesis — the guard that stands in FRONT of `assembleCitedAnswer` in the §5.AC "knows
 * today" retrieval loop's synthesize→CITE step. It lets ONLY claims that clear BOTH admission gates reach the rendered
 * answer, and reports every rejected claim (with a plain reason) so the loop can drop / re-search / surface it.
 *
 * WHY. `assembleCitedAnswer` (cited-synthesis.ts) renders drafted claims into `[n]`-cited text, but it is deliberately
 * NAIVE about whether a claim SHOULD be asserted at all: it will faithfully render an anachronistic ("as of WWDC 2026…"
 * from a stale training prior) or single-sourced-forum-echo claim just as readily as a well-grounded one. Two sibling
 * cores already DECIDE admissibility per axis — `isClaimCorroborated` (claim-corroboration-requirement.ts) gates the
 * INDEPENDENT-backing axis, `isClaimAssertable` (temporal-claim-consistency.ts) gates the TEMPORAL/anachronism axis —
 * but nothing composes them into the synthesis seam so the inadmissible claims are actually EXCLUDED from the final
 * answer. This module is that composition: partition by "corroborated AND temporally-assertable", pass only the
 * survivors to `assembleCitedAnswer`, and hand back the drops with reasons. It ADDS no policy — it merely wires the two
 * existing boolean gates to the existing renderer.
 *
 * DECOUPLING / PURITY. Both gates operate on a PRE-COMPUTED status enum (`CorroborationStatus` / `ClaimTemporalStatus`),
 * not on raw sources or dates — so this module takes each claim already carrying those two statuses and never scores a
 * source, never parses a date, and never reads a clock. That keeps it PURE + deterministic (PRIME DIRECTIVE #1: no I/O,
 * no model, no fs, no ambient `Date.now()`): the caller runs `resolveCorroborationRequirement` /
 * `checkClaimTemporalConsistency` (which own the clock + scoring) upstream and threads the resulting statuses in here.
 * Admissible claims are forwarded to `assembleCitedAnswer` in their ORIGINAL relative order, so the rendered answer is
 * byte-identical to a raw `assembleCitedAnswer` over just the surviving claims.
 *
 * BOUNDARY. This does NOT duplicate `claim-admissibility.ts` (a parallel build) — it inlines the two boolean gate calls
 * directly and depends only on the two gate modules + the renderer.
 */

import type { CitedAnswer, SynthesisClaim, SynthesisEvidenceRef } from "./cited-synthesis";
import { assembleCitedAnswer } from "./cited-synthesis";
import { type CorroborationStatus, isClaimCorroborated } from "./claim-corroboration-requirement";
import { type ClaimTemporalStatus, isClaimAssertable } from "./temporal-claim-consistency";

/**
 * A drafted synthesis claim paired with the two PRE-COMPUTED admission statuses the upstream gates produced for it. The
 * `claim` is exactly what `assembleCitedAnswer` consumes (its text + cited evidence ids); the two statuses are the
 * verdicts from `resolveCorroborationRequirement` and `checkClaimTemporalConsistency`, injected so this module stays
 * pure (it decides admission from the enums alone — it never re-derives them).
 */
export interface AdmissibilityCandidate {
	/** The drafted claim as `assembleCitedAnswer` consumes it. */
	claim: SynthesisClaim;
	/** The corroboration verdict for this claim (from `resolveCorroborationRequirement`). */
	corroborationStatus: CorroborationStatus;
	/** The temporal-consistency verdict for this claim (from `checkClaimTemporalConsistency`). */
	temporalStatus: ClaimTemporalStatus;
}

/** One claim rejected before synthesis, with a plain-language reason naming which axis (or both) it failed. */
export interface DroppedClaim {
	/** The rejected claim's text (mirrors how `assembleCitedAnswer` refers to claims). */
	text: string;
	/** Why it was excluded — the failing admission axis/axes, human-readable for logs/UI. */
	reason: string;
}

/** The result of admissibility-gated synthesis: the cited answer over survivors + every rejected claim with a reason. */
export interface AdmissibleCitedAnswerResult {
	/** The rendered cited answer over ONLY the admissible claims (identical to a raw `assembleCitedAnswer` over them). */
	answer: CitedAnswer;
	/** The claims excluded before synthesis, in input order, each with the reason it was dropped. */
	droppedClaims: DroppedClaim[];
}

/**
 * Build the plain-language drop reason from the two failing axes. Corroboration and temporal failures are reported
 * independently and joined, so a claim failing BOTH is fully explained (never silently attributed to one axis).
 */
function dropReason(corroborationStatus: CorroborationStatus, temporalStatus: ClaimTemporalStatus): string {
	const reasons: string[] = [];
	if (!isClaimCorroborated(corroborationStatus)) {
		reasons.push(`insufficient corroboration (status: ${corroborationStatus})`);
	}
	if (!isClaimAssertable(temporalStatus)) {
		reasons.push(`temporally inadmissible (status: ${temporalStatus})`);
	}
	return `Excluded from answer — ${reasons.join(" and ")}.`;
}

/**
 * Partition candidate claims by admissibility, synthesize a cited answer over ONLY the admissible ones, and report the
 * rest as drops with reasons (§5.AC synthesize→CITE guard). A claim is ADMISSIBLE iff it is BOTH corroborated
 * (`isClaimCorroborated`) AND temporally assertable (`isClaimAssertable`) — a fail on EITHER axis excludes it.
 *
 * Guarantees:
 *   - Admissible claims reach `assembleCitedAnswer` in their ORIGINAL relative order (so the answer is byte-identical to
 *     a raw `assembleCitedAnswer` over just those claims — evidence, marker assignment, and uncited handling are the
 *     renderer's job, unchanged).
 *   - Every inadmissible claim appears in `droppedClaims` (input order) with a reason naming the failing axis/axes.
 *   - All admissible ⇒ the answer equals a raw `assembleCitedAnswer` over the same claims and `droppedClaims` is empty.
 *   - All inadmissible ⇒ a no-claims answer (empty rendered text, no sources, no uncited) and every claim in
 *     `droppedClaims`.
 *
 * PURE + deterministic: the same input always yields the same result; no clock, no I/O. Inputs are never mutated.
 */
export function assembleAdmissibleCitedAnswer(input: {
	candidates: readonly AdmissibilityCandidate[];
	evidence: readonly SynthesisEvidenceRef[];
}): AdmissibleCitedAnswerResult {
	const admissibleClaims: SynthesisClaim[] = [];
	const droppedClaims: DroppedClaim[] = [];

	for (const candidate of input.candidates) {
		const corroborated = isClaimCorroborated(candidate.corroborationStatus);
		const assertable = isClaimAssertable(candidate.temporalStatus);
		if (corroborated && assertable) {
			admissibleClaims.push(candidate.claim);
			continue;
		}
		droppedClaims.push({
			text: candidate.claim.text,
			reason: dropReason(candidate.corroborationStatus, candidate.temporalStatus),
		});
	}

	const answer = assembleCitedAnswer({ claims: admissibleClaims, evidence: input.evidence });
	return { answer, droppedClaims };
}
