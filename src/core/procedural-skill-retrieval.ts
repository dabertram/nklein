/**
 * F4.19 — procedural-skill RETRIEVAL matching (pure). Given a task's context tags and the ProceduralSkillBank, return
 * the applicable procedures best-first, so an agent can be offered the distilled know-how that fits its current work.
 *
 * Only `active`, not-superseded skills are retrievable — a `candidate`/`quarantined` procedure is unvalidated and a
 * `deprecated` one is retired (the lifecycle keystone in `procedural-skill-lifecycle.ts` guards those transitions; this
 * retrieval side must never surface an unvalidated procedure). Ranking: applicability-tag overlap first (more relevant),
 * then the learned helped-rate (a procedure that has actually helped wins ties), then title for a stable order.
 * PURE + deterministic — no I/O, no clock.
 */

import type { ProceduralSkill } from "./procedural-skill-record.js";
import { proceduralSkillHelpedRate } from "./procedural-skill-record.js";

export interface ProceduralSkillMatch {
	readonly skill: ProceduralSkill;
	/** How many of the context tags overlap the skill's applicability tags (the relevance signal). */
	readonly overlap: number;
	/** The skill's learned helped-rate (0..1), the ranking tiebreak. */
	readonly helpedRate: number;
}

export interface MatchProceduralSkillsOptions {
	/** Minimum tag overlap to be considered applicable (default 1 — at least one shared tag). */
	readonly minOverlap?: number;
	/** Cap the returned matches (default 3 — a lean offer, not a dump). Omit/≤0 ⇒ no cap. */
	readonly limit?: number;
}

const norm = (tag: string): string => tag.trim().toLowerCase();

/**
 * Derive the context tags to match procedures against from a session's role + task text: the role plus the significant
 * lowercase tokens of the task (≥ 4 chars, dedup). A procedure's `applicabilityTags` (task kinds / domains) match these
 * — e.g. a task mentioning "migration" surfaces a migration procedure. Pure; caps the token count so a huge prompt can't
 * balloon the match set.
 */
export function deriveProceduralContextTags(
	role: string | null | undefined,
	taskText: string,
	maxTokens = 40,
): string[] {
	const tags = new Set<string>();
	if (role && role.trim().length > 0) {
		tags.add(role.trim().toLowerCase());
	}
	for (const token of (taskText ?? "").toLowerCase().match(/[a-z][a-z0-9+#.-]{3,}/g) ?? []) {
		if (tags.size >= maxTokens) {
			break;
		}
		tags.add(token);
	}
	return [...tags];
}

/** True when a skill may be surfaced to an agent: validated (`active`) and not superseded by a newer record. */
export function isRetrievableProceduralSkill(skill: ProceduralSkill): boolean {
	return skill.status === "active" && skill.supersededBy === null;
}

/**
 * Match the retrievable procedures against the task's context tags, best-first. Non-active/superseded skills and
 * below-`minOverlap` skills are excluded. Never mutates its inputs.
 */
export function matchProceduralSkills(
	skills: readonly ProceduralSkill[],
	contextTags: readonly string[],
	options: MatchProceduralSkillsOptions = {},
): ProceduralSkillMatch[] {
	const minOverlap = options.minOverlap ?? 1;
	const wanted = new Set(contextTags.map(norm).filter((t) => t.length > 0));
	if (wanted.size === 0) {
		return [];
	}
	const matches: ProceduralSkillMatch[] = [];
	for (const skill of skills) {
		if (!isRetrievableProceduralSkill(skill)) {
			continue;
		}
		const skillTags = new Set(skill.applicabilityTags.map(norm));
		let overlap = 0;
		for (const tag of wanted) {
			if (skillTags.has(tag)) {
				overlap += 1;
			}
		}
		if (overlap < minOverlap) {
			continue;
		}
		matches.push({ skill, overlap, helpedRate: proceduralSkillHelpedRate(skill) });
	}
	matches.sort(
		(a, b) => b.overlap - a.overlap || b.helpedRate - a.helpedRate || a.skill.title.localeCompare(b.skill.title),
	);
	const limit = options.limit ?? 3;
	return limit > 0 ? matches.slice(0, limit) : matches;
}

/**
 * F12.29 dependency-aware retrieval: expand matched skills with their declared dependencies, DEPENDENCIES FIRST
 * (a procedure's prerequisites render before it), deduplicated, cycle-safe (a visited id never re-expands), and
 * missing/superseded/inactive dependencies silently skipped (retrieval never surfaces what the store would not).
 */
export function expandSkillsWithDependencies(
	matched: readonly ProceduralSkill[],
	all: readonly ProceduralSkill[],
): ProceduralSkill[] {
	const byId = new Map(all.map((skill) => [skill.id, skill] as const));
	const ordered: ProceduralSkill[] = [];
	const visited = new Set<string>();
	const visit = (skill: ProceduralSkill): void => {
		if (visited.has(skill.id)) {
			return;
		}
		visited.add(skill.id);
		for (const depId of skill.dependsOnSkillIds ?? []) {
			const dep = byId.get(depId);
			if (dep && isRetrievableProceduralSkill(dep)) {
				visit(dep);
			}
		}
		ordered.push(skill);
	};
	for (const skill of matched) {
		visit(skill);
	}
	return ordered;
}
