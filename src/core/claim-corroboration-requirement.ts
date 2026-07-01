/**
 * Per-claim CORROBORATION-requirement gate — the "does this claim have enough INDEPENDENT backing to assert?" half of
 * the "knows today" lighthouse's synthesis path (todo §5.AC).
 *
 * WHY. §5.AC's `retrieval-source-trust.ts` already answers "how trustable is WHERE ONE source came from?" — it scores a
 * single origin into a tier and exposes {@link isCitableWithoutCorroboration}, a per-tier boolean. But that predicate
 * only says whether ONE source clears the bar; its own guidance rails repeatedly say to "corroborate a load-bearing
 * claim" / "corroborate before relying on it" for `reputable`/`community` origins, yet NOTHING evaluates a CLAIM against
 * the SET of sources cited for it. A load-bearing claim resting on three posts that are all the same forum thread is
 * NOT corroborated (one origin, echoed); the same claim resting on two independent community sites, or one authoritative
 * source, IS. That "count the INDEPENDENT origins behind a claim and decide if the corroboration bar is met" decision is
 * the gap this module fills — the claim-level counterpart to the source-level trust scorer.
 *
 * WHAT. {@link resolveCorroborationRequirement} takes ONE claim carrying the sources cited for it (each either a
 * pre-scored `tier` OR a URL/kind this module scores via `scoreSourceTrust`) plus whether the claim is `loadBearing`,
 * and returns a discriminated verdict:
 *   - `assertable`          — the corroboration bar is met (≥1 citable-alone source, OR enough independent origins).
 *   - `needs_corroboration` — some usable backing exists but not enough independent origins for a load-bearing claim.
 *   - `unsupported`         — no usable source at all (empty, or only `low`/unplaceable origins with nothing citable).
 * plus `distinctOrigins` (independent-origin count), `bestTier`, the `requiredIndependentSources` bar applied, and a
 * plain-language `reason` rail. {@link checkClaimsCorroboration} sweeps a batch order-preserving into per-status index
 * buckets + a `hasUncorroborated` flag (mirroring `temporal-claim-consistency.ts`'s batch shape).
 *
 * INDEPENDENCE model. Two sources are INDEPENDENT when they resolve to different registrable HOSTS — the same host
 * (whatever the path) is one origin, so re-citing three pages of one site counts ONCE (echo, not corroboration). A
 * source with no placeable host (an IP literal / non-http scheme / `doc`/`repo`/`mcp` with no URL) cannot be proven
 * independent by host, so it is deliberately NOT counted toward the independent-origin floor (it may still make the
 * claim `needs_corroboration` rather than `unsupported`, but it can never, alone, satisfy the multi-origin bar) — fails
 * SAFE toward demanding real, placeable corroboration. A caller may supply an explicit `originKey` to declare
 * independence directly (e.g. a curated doc corpus where each doc is a distinct origin).
 *
 * BOUNDARY (distinct from siblings — grep-verified no dup). `retrieval-source-trust.ts` scores ONE origin's authority;
 * this counts the INDEPENDENT origins behind a CLAIM and applies the corroboration floor (it IMPORTS the trust scorer +
 * `isCitableWithoutCorroboration` + `SourceTrustTier`; it re-implements/edits neither). `retrieval-sufficiency.ts`'s
 * `minSources` is a LOOP-level STOP gate (a RAW count over the whole retrieval, "should we search again?") — this is a
 * per-CLAIM ADMISSION gate over that claim's OWN cited sources, counting DISTINCT origins and weighing trust tiers, a
 * different question with a different unit. `retrieved-evidence.ts`'s `verifyCitations` checks GROUNDING (does the cited
 * evidence exist and contribute an extraction span?) — orthogonal to whether the backing is INDEPENDENT enough; a claim
 * can be grounded yet single-sourced. The concurrently-built `citation-conflict-recency.ts` resolves which of several
 * MUTUALLY-CONFLICTING claims wins by RECENCY (dated) — this neither detects conflict nor uses dates; it judges a single
 * claim's corroboration by INDEPENDENT-source count + trust tier.
 *
 * PRIME DIRECTIVE #1: DECIDES only — NO retrieval/egress/I/O/model/UI/fs, and no clock (corroboration is a structural
 * property of the cited set, independent of time). Every input (each source's tier or URL/kind, the load-bearing flag,
 * the required-origin bar) is INJECTED as a plain value. Pure + deterministic → fully unit-testable.
 */

import { isCitableWithoutCorroboration, type SourceTrustTier, scoreSourceTrust } from "./retrieval-source-trust";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The declared kind of a cited source — mirrors `retrieval-source-trust.ts`'s `SourceKind` / the evidence envelope. */
export type CorroborationSourceKind = "web" | "repo" | "doc" | "mcp";

/**
 * One source cited in support of a claim. Provide EITHER a pre-scored `tier` (e.g. from an earlier `scoreSourceTrust`
 * pass on the evidence envelope) OR a `url` (+ optional `sourceType`) for this module to score — when both are present
 * the explicit `tier` wins (the caller has already decided). Independence is keyed off the source's registrable HOST
 * (parsed from `url` by the trust scorer) unless an explicit `originKey` is supplied to declare it directly.
 */
export interface CitedSourceRef {
	/** Stable id for this citation (used to identify the source; NOT used for independence unless it is the origin key). */
	id?: string;
	/** The source URL — scored via `scoreSourceTrust` when no explicit `tier` is given; also the independence host key. */
	url?: string;
	/** The declared source kind, threaded into `scoreSourceTrust` as a prior for hostless sources. */
	sourceType?: CorroborationSourceKind;
	/** A pre-computed trust tier; when present it OVERRIDES scoring from `url` (the caller has already scored it). */
	tier?: SourceTrustTier;
	/**
	 * Explicit independence key: when set, TWO sources with the same key count as ONE origin (and differing keys as
	 * distinct origins), overriding host-based independence. Use for corpora where the URL host is not the true origin
	 * (e.g. a doc corpus where each document is its own origin, or several mirrors of one upstream that must count once).
	 */
	originKey?: string;
}

/** A claim plus the sources cited for it, and whether it carries enough weight to demand corroboration. */
export interface CorroborationClaim {
	/** Stable claim identifier (echoed in the verdict / batch buckets). */
	id: string;
	/** The sources cited in support of this claim. */
	sources: readonly CitedSourceRef[];
	/**
	 * Whether this is a LOAD-BEARING claim (a material factual assertion) vs. incidental colour. A load-bearing claim
	 * backed only by `community`/`unknown` origins must clear the independent-origin floor; a non-load-bearing claim is
	 * held to a looser bar (any single usable source suffices). Defaults to `true` — fail SAFE toward demanding backing.
	 */
	loadBearing?: boolean;
}

/** Tuning knobs. All optional; every value is INJECTED. */
export interface CorroborationOptions {
	/**
	 * How many INDEPENDENT origins a LOAD-BEARING claim needs when it has NO citable-alone (`authoritative`/`reputable`)
	 * source — i.e. when it rests on `community`/`unknown` origins. Default 2 (a single community post is one person's
	 * word; two independent ones corroborate). Values ≤ 1 are clamped to 1 (a claim always needs at least one source).
	 */
	requiredIndependentSources?: number;
	/** Options forwarded to `scoreSourceTrust` for sources given by `url` without an explicit `tier` (e.g. extra rules). */
	scoreOptions?: Parameters<typeof scoreSourceTrust>[1];
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/**
 * The corroboration verdict for one claim:
 *   - `assertable`          — safe to assert: a citable-alone source backs it, OR it clears the independent-origin bar.
 *   - `needs_corroboration` — usable backing exists but is insufficient (a load-bearing claim short of independent
 *                             origins) — search for another INDEPENDENT source before asserting.
 *   - `unsupported`         — no usable backing at all (no sources, or only `low`/unplaceable ones with nothing citable).
 */
export type CorroborationStatus = "assertable" | "needs_corroboration" | "unsupported";

/** The full, transparent result of judging one claim's corroboration. */
export interface CorroborationVerdict {
	/** The claim id this verdict is for. */
	claimId: string;
	/** The admission decision. */
	status: CorroborationStatus;
	/**
	 * The count of INDEPENDENT origins backing the claim: distinct registrable hosts (or explicit `originKey`s) among the
	 * cited sources, EXCLUDING unplaceable sources (which cannot be proven independent). This is what the floor compares.
	 */
	distinctOrigins: number;
	/**
	 * The number of cited sources that could NOT be placed to an independent origin (no host / IP literal / non-http /
	 * hostless kind with no `originKey`). They contribute usability but never the multi-origin floor.
	 */
	unplaceableSources: number;
	/** The MOST-authoritative trust tier among the cited sources, or `null` when the claim cites nothing. */
	bestTier: SourceTrustTier | null;
	/** Whether ≥1 cited source is citable ALONE (`authoritative`/`reputable`), which satisfies the bar by itself. */
	hasCitableAloneSource: boolean;
	/** The independent-origin bar actually applied to this claim (after load-bearing + clamping). */
	requiredIndependentSources: number;
	/** A plain-language rationale for the status. */
	reason: string;
}

// ---------------------------------------------------------------------------
// Tier helpers
// ---------------------------------------------------------------------------

/** Ordering authoritative(0) … low(4) — a private mirror so "more authoritative" is a numeric min (matches the scorer). */
const TIER_ORDER: readonly SourceTrustTier[] = ["authoritative", "reputable", "community", "unknown", "low"];

/** Rank of a tier (0 = most authoritative); an unrecognised tier sorts last, defensively. */
function tierRank(tier: SourceTrustTier): number {
	const rank = TIER_ORDER.indexOf(tier);
	return rank === -1 ? TIER_ORDER.length : rank;
}

/**
 * A source counts toward the INDEPENDENT-origin floor only when its tier is at least `community` — a KNOWN-`low` origin
 * (a flagged content-farm) is not corroboration however many distinct farms echo it, and `unknown` is excluded because
 * an origin we cannot place is not a trustworthy independent voice. (Note: a placeable open site with no positive signal
 * is scored `community`, NOT `unknown`, by the trust scorer — so ordinary corroborating sites still count.)
 */
function tierCanCorroborate(tier: SourceTrustTier): boolean {
	return tier === "authoritative" || tier === "reputable" || tier === "community";
}

// ---------------------------------------------------------------------------
// Per-source resolution
// ---------------------------------------------------------------------------

/** One cited source resolved to the two facts the gate needs: its trust tier and its independence key (host), if any. */
interface ResolvedSource {
	tier: SourceTrustTier;
	/** The origin key used for independence (explicit `originKey`, else the scored host), or `null` when unplaceable. */
	originKey: string | null;
}

/** Resolve a cited source to its tier + independence key, scoring the URL only when no explicit tier is supplied. */
function resolveSource(ref: CitedSourceRef, scoreOptions: CorroborationOptions["scoreOptions"]): ResolvedSource {
	// Score once from the URL when we need either the tier or the host (or both); reuse the single result.
	const scored =
		ref.tier === undefined || ref.originKey === undefined
			? scoreSourceTrust(ref.url ?? "", { sourceType: ref.sourceType, ...scoreOptions })
			: null;
	const tier: SourceTrustTier = ref.tier ?? scored?.tier ?? "unknown";
	const originKey = ref.originKey ?? scored?.host ?? null;
	return { tier, originKey };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Judge whether ONE claim has enough INDEPENDENT, trustworthy backing to be asserted (pure).
 *
 * Decision, in order:
 *   1. No sources at all ⇒ `unsupported`.
 *   2. Any cited source is citable ALONE (`authoritative`/`reputable`, via `isCitableWithoutCorroboration`) ⇒ the bar is
 *      met on its own ⇒ `assertable` (a primary/reputable source needs no corroboration).
 *   3. Otherwise count DISTINCT corroborating origins (registrable host / `originKey`, tier ≥ `community`, unplaceable
 *      excluded):
 *        • a NON-load-bearing claim needs ≥1 usable origin ⇒ `assertable` with one, else `needs_corroboration`;
 *        • a LOAD-BEARING claim needs ≥ `requiredIndependentSources` (default 2) distinct origins ⇒ `assertable`, else
 *          `needs_corroboration` when it has SOME usable backing (a placeable/usable source or an unplaceable one), else
 *          `unsupported` (only `low`/genuinely-unusable citations).
 *
 * Deterministic and total: the same input always yields the same verdict; no exception escapes and nothing is fetched.
 */
export function resolveCorroborationRequirement(
	claim: CorroborationClaim,
	options: CorroborationOptions = {},
): CorroborationVerdict {
	const loadBearing = claim.loadBearing ?? true;
	const requiredIndependentSources = Math.max(1, Math.trunc(options.requiredIndependentSources ?? 2));

	const resolved = claim.sources.map((ref) => resolveSource(ref, options.scoreOptions));

	// No citations at all.
	if (resolved.length === 0) {
		return {
			claimId: claim.id,
			status: "unsupported",
			distinctOrigins: 0,
			unplaceableSources: 0,
			bestTier: null,
			hasCitableAloneSource: false,
			requiredIndependentSources,
			reason: "No sources cited — nothing to assert on.",
		};
	}

	// Best (most authoritative) tier + whether any single source is citable alone.
	let bestTier: SourceTrustTier = resolved[0].tier;
	let hasCitableAloneSource = false;
	for (const src of resolved) {
		if (tierRank(src.tier) < tierRank(bestTier)) {
			bestTier = src.tier;
		}
		if (isCitableWithoutCorroboration(src.tier)) {
			hasCitableAloneSource = true;
		}
	}

	// Distinct corroborating origins (tier ≥ community, placeable), and how many sources were unplaceable.
	const corroboratingOrigins = new Set<string>();
	let unplaceableSources = 0;
	for (const src of resolved) {
		if (src.originKey === null) {
			unplaceableSources += 1;
			continue;
		}
		if (tierCanCorroborate(src.tier)) {
			corroboratingOrigins.add(src.originKey);
		}
	}
	const distinctOrigins = corroboratingOrigins.size;

	const base = {
		claimId: claim.id,
		distinctOrigins,
		unplaceableSources,
		bestTier,
		hasCitableAloneSource,
		requiredIndependentSources,
	} as const;

	// A citable-alone source clears the bar regardless of origin count.
	if (hasCitableAloneSource) {
		return {
			...base,
			status: "assertable",
			reason: `Backed by a ${bestTier} source that is citable without corroboration.`,
		};
	}

	if (!loadBearing) {
		// Incidental claim: any single usable (placeable) origin suffices.
		if (distinctOrigins >= 1) {
			return {
				...base,
				status: "assertable",
				reason: `Non-load-bearing claim backed by ${distinctOrigins} usable source(s) (${bestTier}).`,
			};
		}
		return {
			...base,
			status: unplaceableSources > 0 ? "needs_corroboration" : "unsupported",
			reason:
				unplaceableSources > 0
					? "Only unplaceable source(s) — cannot confirm an independent origin; corroborate with a placeable source."
					: `Only ${bestTier} citation(s) with no usable origin — unsupported.`,
		};
	}

	// Load-bearing claim: needs the independent-origin floor.
	if (distinctOrigins >= requiredIndependentSources) {
		return {
			...base,
			status: "assertable",
			reason: `Load-bearing claim corroborated by ${distinctOrigins} independent origin(s) (need ${requiredIndependentSources}).`,
		};
	}

	// Some usable backing but short of the floor ⇒ needs more; nothing usable at all ⇒ unsupported.
	const hasAnyUsableBacking = distinctOrigins > 0 || unplaceableSources > 0;
	if (hasAnyUsableBacking) {
		return {
			...base,
			status: "needs_corroboration",
			reason: `Load-bearing claim has ${distinctOrigins} independent origin(s)${
				unplaceableSources > 0 ? ` (+${unplaceableSources} unplaceable)` : ""
			}, needs ${requiredIndependentSources} — find another independent source.`,
		};
	}
	return {
		...base,
		status: "unsupported",
		reason: `Load-bearing claim rests only on ${bestTier} citation(s) with no usable origin — unsupported.`,
	};
}

// ---------------------------------------------------------------------------
// Batch sweep
// ---------------------------------------------------------------------------

/** Per-status index buckets over a batch of claims (indices into the input array), plus the overall summary flag. */
export interface CorroborationBatchResult {
	/** Every per-claim verdict, in input order. */
	verdicts: CorroborationVerdict[];
	/** Input indices of `assertable` claims. */
	assertable: number[];
	/** Input indices of `needs_corroboration` claims. */
	needsCorroboration: number[];
	/** Input indices of `unsupported` claims. */
	unsupported: number[];
	/** True when ANY claim is not `assertable` (i.e. at least one needs corroboration or is unsupported). */
	hasUncorroborated: boolean;
}

/**
 * Sweep a batch of claims through {@link resolveCorroborationRequirement}, order-preserving, into per-status index
 * buckets + a `hasUncorroborated` summary flag. Pure; inputs never mutated. (Mirrors `checkClaimsTemporalConsistency`.)
 */
export function checkClaimsCorroboration(
	claims: readonly CorroborationClaim[],
	options: CorroborationOptions = {},
): CorroborationBatchResult {
	const verdicts: CorroborationVerdict[] = [];
	const assertable: number[] = [];
	const needsCorroboration: number[] = [];
	const unsupported: number[] = [];

	claims.forEach((claim, index) => {
		const verdict = resolveCorroborationRequirement(claim, options);
		verdicts.push(verdict);
		switch (verdict.status) {
			case "assertable":
				assertable.push(index);
				break;
			case "needs_corroboration":
				needsCorroboration.push(index);
				break;
			case "unsupported":
				unsupported.push(index);
				break;
		}
	});

	return {
		verdicts,
		assertable,
		needsCorroboration,
		unsupported,
		hasUncorroborated: assertable.length < claims.length,
	};
}

/**
 * The synthesis gate: whether a claim's corroboration status permits asserting it to the user. Only `assertable` claims
 * pass; `needs_corroboration` and `unsupported` are held back (drop, flag, or trigger another search). The claim-level
 * analogue of `temporal-claim-consistency.ts`'s `isClaimAssertable`, for the corroboration axis.
 */
export function isClaimCorroborated(status: CorroborationStatus): boolean {
	return status === "assertable";
}
