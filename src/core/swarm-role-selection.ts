/**
 * W2.5 role auto-assignment (todo §5.0.5, decided 2026-07-02: auto is the DEFAULT) — the PIN-vs-AUTO layer for a
 * swarm role's model. Callers pass `pinned` ONLY for an explicit user pin (for role config, that means
 * `modelSelectionMode:"pinned"`). Unpinned role models remain auto-selection candidates/pool members, not hard pins.
 * A pin that is not loaded/feasible is reported as an unmatched pin in the rationale. This pure core still returns the
 * auto pick so optional/legacy seams can decide locally, but runtime task starts must treat explicit user pins as
 * fail-closed unless the caller intentionally implements a different opt-in fallback.
 *
 * Composition contract (the shipped W0.4/§5.AQ pattern, uniform across seams):
 *  1. **Pin first, absolutely.** A pin that matches a candidate (caller-tagged `isPinned` or identity match) WINS —
 *     the user chose it. Diversity is NOT applied over a pin, but a correlated pin is REPORTED (`diversityWaived`),
 *     never silently monocultural. A configured-but-unmatched pin is reported with a surfaced reason; callers decide
 *     whether that is a hard block (runtime task starts) or an optional fallback seam.
 *  2. **Diversity second (DECISION roles only).** reviewer/critic/merge judge other models' work, so
 *     `applyDiversityPreference` re-ranks toward an uncorrelated lineage (margin-bounded HARD preference);
 *     generation roles (architect/worker) keep pure fit ranking (Self-MoA — forced diversity does not help
 *     generation).
 *  3. **Warmth last, margin-bounded, within what diversity allows.** `applyWarmthPreference` may only re-order the
 *     diversity-allowed set (a diverse decision turn is a legitimate cache miss) — the same "diversity
 *     authoritative, warmth margin-bounded" contract as `pickDiverseReviewerModel`.
 *
 * Relationship to the neighbouring cores: `role-model-swarm-pick.ts` `selectSwarmRoleModel` is the CLASS-gate →
 * instance-feasibility stage (what is the right KIND of model, used by the pool route); this core is the ASSIGNMENT
 * stage on an already blended/gated/ranked candidate list (whose model actually gets the role, pin honored or not).
 * The caller passes candidates best-first and this core never re-sorts by score — like the preference cores it
 * composes, it only ever promotes within a bounded margin.
 *
 * NOTE on critic/merge pins: `effectiveModelRoles` is an open record, but the live producers/UI only carry
 * architect/worker/reviewer today and the session service (where the critique/merge picks run) has no runtime-config
 * access — so those roles currently always take the auto path. When config plumbing reaches them, route their
 * pin-vs-auto through this same core; do not hand-roll another pin check.
 */

import type { PromptSessionKind, PromptWarmthLedgerEntry } from "./cache-warmth";
import { applyWarmthPreference } from "./cache-warmth";
import { applyDiversityPreference } from "./model-diversity";
import type { ModelLineage } from "./model-lineage";
import { resolveLineage } from "./model-lineage";
import type { SwarmRole } from "./role-model-class";

/** The assignable swarm roles: the configured trio plus the decision-only session kinds (critic/merge). */
export type SwarmAssignmentRole = SwarmRole | "critic" | "merge";

/** Decision roles judge other models' work — they get the §5.AB diversity preference; generation roles don't. */
export const SWARM_DECISION_ROLES: ReadonlySet<SwarmAssignmentRole> = new Set(["reviewer", "critic", "merge"]);

/** The configured pin identity (an `effectiveModelRoles` entry's primary model). */
export interface SwarmRolePinnedModel {
	providerId?: string | null;
	modelId?: string | null;
}

export interface SwarmRoleSelectionCandidate {
	/** The routing key the caller launches with (registry key / served runtime id) — opaque here, must be unique. */
	modelKey: string;
	/** The LAUNCH/served model id — the id the §5.AQ warmth ledger is keyed by. */
	modelId: string;
	/** The REAL publisher key for lineage resolution (never a per-machine alias); defaults to `modelId`. */
	realModelId?: string;
	/** Fit score, higher is better (blended capability points) — margin math only, never re-sorted on. */
	score: number;
	/**
	 * Caller-resolved pin membership: true when this candidate IS (or belongs to the pool of) the configured pin
	 * for this role. Lets seams whose candidate identity differs from the config identity (role-tagged guard
	 * candidates, resolved provider defaults, `additionalModels` pools) match without string heuristics.
	 */
	isPinned?: boolean;
}

/** Warmth inputs, passed through to {@link applyWarmthPreference} (omitted ⇒ no warmth pass). */
export interface SwarmRoleWarmthInputs {
	sessionKind: PromptSessionKind;
	workspacePath: string;
	lastShellKeyByModel: ReadonlyMap<string, PromptWarmthLedgerEntry>;
	/** Injected clock (epoch ms) — the core stays pure. */
	now: number;
	marginPoints?: number;
	staleAfterMs?: number;
}

export interface ResolveSwarmRoleModelInput<T extends SwarmRoleSelectionCandidate> {
	role: SwarmAssignmentRole;
	/** The configured pin for this role, or null when the role is unconfigured (auto is the default). */
	pinned: SwarmRolePinnedModel | null;
	/**
	 * Fit-ranked candidates, best-first — already blended (registry × ledger × verdict), suitability-gated, and
	 * residency-filtered by the caller (candidates ARE the loaded/feasible set; when the caller cannot know the
	 * loaded set it must stay lenient itself instead of fabricating candidates).
	 */
	candidates: readonly T[];
	/** Lineages correlated with the work under review (author/architect). Decision roles only; ignored otherwise. */
	diversityAvoidLineages?: readonly ModelLineage[];
	/** Cache-warmth preference inputs — composed AFTER diversity, margin-bounded. */
	warmth?: SwarmRoleWarmthInputs;
}

export interface SwarmRoleModelPick<T extends SwarmRoleSelectionCandidate> {
	/** The assigned candidate, or null when no candidate exists at all. */
	pick: T | null;
	/** "pinned" = the configured pin was matched and honored; "auto" = automatic selection (incl. waived pins). */
	source: "pinned" | "auto";
	/** True when the pick's lineage is known and outside the avoid set (vacuously true for generation roles). */
	diversityAchieved: boolean;
	/** Non-null when diversity was wanted but not achieved — the SURFACED waiver (ledger/operator), never silent. */
	diversityWaived: string | null;
	/** Non-null when warmth re-ordered the ranking (for the caller's observation line). */
	warmthReason: string | null;
	/** Ordered rationale lines; empty for the plain unconfigured auto path (nothing noteworthy happened). */
	reasons: string[];
}

function describePin(pinned: SwarmRolePinnedModel): string {
	const provider = pinned.providerId?.trim();
	const model = pinned.modelId?.trim();
	if (provider && model) {
		return `${provider}/${model}`;
	}
	return model || provider || "(unspecified)";
}

/** Does this candidate satisfy the pin? Caller tag first, then identity on any of the candidate's ids. */
function matchesPin(candidate: SwarmRoleSelectionCandidate, pinned: SwarmRolePinnedModel): boolean {
	if (candidate.isPinned === true) {
		return true;
	}
	const pinnedModelId = pinned.modelId?.trim();
	if (!pinnedModelId) {
		return false;
	}
	return (
		candidate.modelKey === pinnedModelId ||
		candidate.modelId === pinnedModelId ||
		(candidate.realModelId ?? candidate.modelId) === pinnedModelId
	);
}

/** Is the candidate a guaranteed-diverse pick against the avoid set (KNOWN lineage outside it)? */
function isDiverseCandidate(candidate: SwarmRoleSelectionCandidate, avoid: ReadonlySet<ModelLineage>): boolean {
	const lineage = resolveLineage(candidate.realModelId ?? candidate.modelId);
	return lineage !== "unknown" && !avoid.has(lineage);
}

/**
 * Pure: resolve a swarm role's model — configured pin honored when it matches a candidate, otherwise automatic
 * selection with decision-role diversity first and margin-bounded warmth after, all reasons surfaced. See the
 * module doc for the full contract.
 */
export function resolveSwarmRoleModel<T extends SwarmRoleSelectionCandidate>(
	input: ResolveSwarmRoleModelInput<T>,
): SwarmRoleModelPick<T> {
	const reasons: string[] = [];
	const isDecisionRole = SWARM_DECISION_ROLES.has(input.role);
	// `unknown` carries no information — drop it so it can't block everything (mirrors applyDiversityPreference).
	const avoid = new Set((input.diversityAvoidLineages ?? []).filter((lineage) => lineage !== "unknown"));
	const diversityWanted = isDecisionRole && input.diversityAvoidLineages !== undefined;

	// 1. Pin first, absolutely — first match in the caller's order (primary-then-pool for role pools).
	const pinned = input.pinned;
	if (pinned) {
		const pinnedPick = input.candidates.find((candidate) => matchesPin(candidate, pinned));
		if (pinnedPick) {
			reasons.push(`Pinned ${input.role} model ${describePin(pinned)} is available — honoring the configured pin.`);
			let diversityAchieved = true;
			let diversityWaived: string | null = null;
			if (diversityWanted) {
				diversityAchieved = isDiverseCandidate(pinnedPick, avoid);
				if (!diversityAchieved) {
					diversityWaived =
						`pinned ${input.role} model ${pinnedPick.modelId} ` +
						`(${resolveLineage(pinnedPick.realModelId ?? pinnedPick.modelId)}) is not lineage-diverse from the ` +
						`work under review — pin honored, diversity waived by configuration`;
					reasons.push(`Diversity waived: ${diversityWaived}.`);
				}
			}
			return { pick: pinnedPick, source: "pinned", diversityAchieved, diversityWaived, warmthReason: null, reasons };
		}
		reasons.push(
			`Pinned ${input.role} model ${describePin(pinned)} is not loaded/runnable — ` +
				`falling back to automatic selection (pin waived, the start is not blocked).`,
		);
	}

	// 2. Automatic selection.
	if (input.candidates.length === 0) {
		reasons.push(`No candidates available for the ${input.role} role.`);
		return {
			pick: null,
			source: "auto",
			diversityAchieved: false,
			diversityWaived: null,
			warmthReason: null,
			reasons,
		};
	}

	let ranked: readonly T[] = input.candidates;
	// Generation roles are vacuously "achieved" (diversity is not a goal there — Self-MoA).
	let diversityAchieved = true;
	let diversityWaived: string | null = null;
	if (diversityWanted) {
		const byKey = new Map(input.candidates.map((candidate) => [candidate.modelKey, candidate]));
		const preference = applyDiversityPreference({
			ranked: input.candidates.map((candidate) => ({
				modelKey: candidate.modelKey,
				modelId: candidate.realModelId ?? candidate.modelId,
				score: candidate.score,
			})),
			avoidLineages: input.diversityAvoidLineages ?? [],
		});
		ranked = preference.ranked.flatMap((entry) => {
			const candidate = byKey.get(entry.modelKey);
			return candidate ? [candidate] : [];
		});
		diversityAchieved = preference.diversityAchieved;
		diversityWaived = preference.diversityWaivedReason;
		reasons.push(preference.rationale);
	}

	// 3. Warmth last, only within what diversity allows (a waived list stands as-is and warms as a whole).
	let warmthReason: string | null = null;
	if (input.warmth && ranked.length > 0) {
		const warmthPool =
			diversityWanted && diversityAchieved
				? ranked.filter((candidate) => isDiverseCandidate(candidate, avoid))
				: ranked;
		const warmth = applyWarmthPreference({
			ranked: warmthPool.map((candidate) => ({
				modelKey: candidate.modelKey,
				modelId: candidate.modelId,
				score: candidate.score,
			})),
			sessionKind: input.warmth.sessionKind,
			workspacePath: input.warmth.workspacePath,
			lastShellKeyByModel: input.warmth.lastShellKeyByModel,
			now: input.warmth.now,
			...(input.warmth.marginPoints !== undefined ? { marginPoints: input.warmth.marginPoints } : {}),
			...(input.warmth.staleAfterMs !== undefined ? { staleAfterMs: input.warmth.staleAfterMs } : {}),
		});
		const promotedKey = warmth.warmthApplied ? warmth.ranked[0]?.modelKey : undefined;
		const promoted = promotedKey ? ranked.find((candidate) => candidate.modelKey === promotedKey) : undefined;
		if (promoted && warmth.warmthReason) {
			ranked = [promoted, ...ranked.filter((candidate) => candidate !== promoted)];
			warmthReason = warmth.warmthReason;
			reasons.push(`Cache-warmth preference (after diversity): ${warmth.warmthReason}.`);
		}
	}

	return {
		pick: ranked[0] ?? null,
		source: "auto",
		diversityAchieved,
		diversityWaived,
		warmthReason,
		reasons,
	};
}
