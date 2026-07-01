/**
 * The §5.AE skill-set COMPATIBILITY checker — a pure diagnostic over a PROPOSED active skill set that flags CONFLICTS
 * (skills whose declared behaviour pulls in opposite directions) and REDUNDANCIES (a skill that contributes nothing the
 * set doesn't already carry). It is the missing *quality gate* alongside the §5.AE composer path: `resolveActiveSkills`
 * blindly UNIONS every relevant skill (`fragmentsForSkills`/`toolsForSkills` dedup, `resolveApiProfileForSkills` merges
 * by "strongest need wins") — which is the right runtime behaviour, but it SILENTLY resolves real tensions (a fast
 * `/no_think` skill and a deliberate `high`-reasoning skill collapse to `high`, hiding the trade-off) and silently keeps
 * a skill that is fully subsumed by another (a wasted relevance slot). This module makes those two facts INSPECTABLE for
 * the §5.AG "what was assembled / why" surface, for authoring-time registry checks, and as an optional pre-flight the
 * resolver/UI can consult before committing a set.
 *
 * WHY separate from the resolver (and why it does NOT mutate): the resolver must always emit a usable set at runtime
 * (never drop a skill mid-turn on a heuristic), so conflict/redundancy handling is a REPORT, not an edit — the caller
 * decides (surface a warning, prefer the deliberate skill, or drop a redundant one at author time). Pure + deterministic
 * so it composes directly with the §5.AE registry types by import (no registry edit) and is trivially unit-testable.
 *
 * Conflicts are derived ENTIRELY from data already declared on each `Skill` (`apiProfile` — the §5.AE/§5.AN levers), so
 * no new registry field is required to get value today; new conflict axes can be added here as the levers grow.
 */

import type { Skill, SkillApiProfile, SkillId } from "./skill-registry";

/** The kind of incompatibility between two skills in a proposed set. */
export type SkillConflictKind =
	/** One skill wants reasoning OFF (`/no_think`, fast) while another wants it ON — the merge silently forces ON. */
	| "reasoning_opposed"
	/** One skill pins structured (JSON) output while another proactively forces a free tool call — output shapes fight. */
	| "output_shape_opposed"
	/** Both skills pin a `temperature`, and the two values differ — the merge silently takes the lower (most deterministic). */
	| "temperature_divergent";

/** A single detected conflict between exactly two active skills (order-normalised: `a` is the lower skill id). */
export interface SkillConflict {
	kind: SkillConflictKind;
	/** The two conflicting skills, id-sorted so a pair is reported once and deterministically. */
	a: SkillId;
	b: SkillId;
	/** How the runtime `resolveApiProfileForSkills` merge silently RESOLVES this tension (so the surface can show the loss). */
	mergedTo: string;
	/** Human-readable explanation for the §5.AG surface / author. */
	detail: string;
}

/** A skill that is fully SUBSUMED by another active skill — it adds no fragment and no tool the set doesn't already have. */
export interface SkillRedundancy {
	/** The skill that contributes nothing new (candidate to drop at author time / lower its relevance). */
	redundant: SkillId;
	/** An active skill that already provides a SUPERSET of `redundant`'s fragments AND tools. */
	subsumedBy: SkillId;
	detail: string;
}

export interface SkillCompatReport {
	/** Every conflicting pair (deterministically ordered). Empty ⇒ no behavioural tension in the set. */
	conflicts: SkillConflict[];
	/** Every fully-subsumed skill. Empty ⇒ every skill pulls its weight (contributes ≥1 unique fragment or tool). */
	redundancies: SkillRedundancy[];
	/** True iff there are no conflicts AND no redundancies — the set is clean. */
	ok: boolean;
	/** One-line summary for logs / the §5.AG surface. */
	reason: string;
}

/** Rank a reasoning intensity for opposition testing. `inherit`/absent carry no opinion, so they never conflict. */
const REASONING_RANK: Record<"off" | "low" | "high", number> = { off: 0, low: 1, high: 2 };

/** The explicit reasoning intensity a skill declares, or `null` when it has no opinion (`inherit`/absent ⇒ never conflicts). */
function explicitReasoning(profile: SkillApiProfile | undefined): "off" | "low" | "high" | null {
	const r = profile?.reasoning;
	if (!r || r === "inherit") {
		return null;
	}
	return r;
}

/**
 * Whether two explicit reasoning intents are OPPOSED — one wants it OFF and the other wants it clearly ON (`high`). `off`
 * vs `low` is a mild difference (the merge to `low` loses little), so only `off` vs `high` — the fast-vs-deliberate
 * trade-off the §5.AN sweep cares about — counts as a conflict worth surfacing.
 */
function reasoningOpposed(x: "off" | "low" | "high", y: "off" | "low" | "high"): boolean {
	const lo = Math.min(REASONING_RANK[x], REASONING_RANK[y]);
	const hi = Math.max(REASONING_RANK[x], REASONING_RANK[y]);
	return lo === REASONING_RANK.off && hi === REASONING_RANK.high;
}

/** Detect the pairwise conflicts between two skills' declared `apiProfile`s (returns the kinds that apply). */
function conflictsBetween(left: Skill, right: Skill): SkillConflict[] {
	const [a, b] = left.id <= right.id ? [left, right] : [right, left];
	const pa = a.apiProfile;
	const pb = b.apiProfile;
	const out: SkillConflict[] = [];

	const ra = explicitReasoning(pa);
	const rb = explicitReasoning(pb);
	if (ra !== null && rb !== null && reasoningOpposed(ra, rb)) {
		out.push({
			kind: "reasoning_opposed",
			a: a.id,
			b: b.id,
			// resolveApiProfileForSkills takes the HIGHEST intensity — so the "off" (fast) intent is silently dropped.
			mergedTo: "high",
			detail: `"${a.id}" wants reasoning ${ra} but "${b.id}" wants ${rb}; the merge forces "high" (the fast intent is lost).`,
		});
	}

	// A skill pinning structured JSON output and a skill forcing a free tool call want DIFFERENT response shapes; the
	// merge sets BOTH flags, so the call seam must choose (a §5.AN tension worth surfacing rather than silently OR-ing).
	if ((pa?.structuredOutput && pb?.forceToolCall) || (pb?.structuredOutput && pa?.forceToolCall)) {
		out.push({
			kind: "output_shape_opposed",
			a: a.id,
			b: b.id,
			mergedTo: "structuredOutput+forceToolCall both set",
			detail: `"${a.id}"/"${b.id}" ask for opposed output shapes (structured JSON vs. a forced free tool call); the call seam must pick one.`,
		});
	}

	// Two DIFFERENT pinned temperatures — the merge silently takes the lower (most deterministic); surface the divergence.
	if (
		typeof pa?.temperature === "number" &&
		typeof pb?.temperature === "number" &&
		pa.temperature !== pb.temperature
	) {
		const merged = Math.min(pa.temperature, pb.temperature);
		out.push({
			kind: "temperature_divergent",
			a: a.id,
			b: b.id,
			mergedTo: `temperature=${merged}`,
			detail: `"${a.id}" pins temperature ${a.apiProfile?.temperature} but "${b.id}" pins ${b.apiProfile?.temperature}; the merge takes the lower (${merged}).`,
		});
	}

	return out;
}

/** True iff every element of `subset` is present in `superset` (used to test fragment/tool containment). */
function isSubsetOf(subset: readonly string[], superset: ReadonlySet<string>): boolean {
	for (const item of subset) {
		if (!superset.has(item)) {
			return false;
		}
	}
	return true;
}

/**
 * Whether `candidate` is fully SUBSUMED by `other` — `other` provides every fragment AND every tool `candidate` does (a
 * superset of both). Two skills with identical fragment+tool sets subsume each other; the caller resolves that tie by
 * only ever reporting the LATER skill as redundant (registry/selection order), so a pair is flagged exactly once.
 */
function subsumes(other: Skill, candidate: Skill): boolean {
	const otherFragments = new Set<string>(other.contextFragments);
	const otherTools = new Set<string>(other.tools);
	return isSubsetOf(candidate.contextFragments, otherFragments) && isSubsetOf(candidate.tools, otherTools);
}

/**
 * Check a PROPOSED active skill set for conflicts + redundancies (pure; never mutates the input).
 *
 * - **Conflicts** are every unordered PAIR whose declared `apiProfile`s pull in opposite directions (reasoning off↔high,
 *   structured-output↔forced-tool-call, or divergent pinned temperatures), each annotated with how the runtime merge
 *   silently resolves it — so the §5.AG surface can show what the "strongest need wins" merge quietly dropped.
 * - **Redundancies** are every skill fully SUBSUMED by an EARLIER skill in the set (its fragments and tools are both
 *   already covered) — a wasted relevance slot. Using "earlier" as the tie-breaker means two identical skills flag the
 *   second one exactly once, and the report is order-deterministic.
 *
 * Duplicate skill ids in the input are treated as one skill (deduped by first occurrence) so a caller that accidentally
 * passes a skill twice gets a stable report rather than spurious self-conflicts/self-redundancies.
 */
export function checkSkillSetCompat(skills: readonly Skill[]): SkillCompatReport {
	// Dedupe by id (first occurrence wins) so a doubled input never self-conflicts / self-subsumes.
	const seen = new Set<SkillId>();
	const unique: Skill[] = [];
	for (const skill of skills) {
		if (!seen.has(skill.id)) {
			seen.add(skill.id);
			unique.push(skill);
		}
	}

	const conflicts: SkillConflict[] = [];
	for (let i = 0; i < unique.length; i += 1) {
		for (let j = i + 1; j < unique.length; j += 1) {
			conflicts.push(...conflictsBetween(unique[i], unique[j]));
		}
	}

	const redundancies: SkillRedundancy[] = [];
	for (let i = 0; i < unique.length; i += 1) {
		const candidate = unique[i];
		// A skill with no fragments AND no tools is vacuously subsumed by anything — only redundant if the set has ≥2 skills.
		for (let j = 0; j < i; j += 1) {
			const earlier = unique[j];
			if (subsumes(earlier, candidate)) {
				redundancies.push({
					redundant: candidate.id,
					subsumedBy: earlier.id,
					detail: `"${candidate.id}" adds no fragment or tool beyond "${earlier.id}" — it contributes nothing to this set.`,
				});
				break; // report each redundant skill once, against its first subsumer
			}
		}
	}

	const ok = conflicts.length === 0 && redundancies.length === 0;
	const reason = ok
		? `Skill set is clean (${unique.length} skill(s), no conflicts or redundancies).`
		: `${conflicts.length} conflict(s), ${redundancies.length} redundancy(ies) across ${unique.length} skill(s).`;

	return { conflicts, redundancies, ok, reason };
}
