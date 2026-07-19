import type { SkillLifecycleStatus } from "./procedural-skill-lifecycle.js";

/**
 * F4.19 — the durable ProceduralSkill record + its pure mutations. A procedural skill is a learned procedure the swarm
 * can reuse: content + applicability + version/hash (change detection & TOFU) + accumulated helped/hurt outcomes +
 * supersession chain + provenance. This module owns the RECORD shape and the pure, deterministic operations over it
 * (create / record-outcome / supersede); persistence is `procedural-skill-store.ts`, lifecycle transitions are
 * `procedural-skill-lifecycle.ts`. PURE: every op returns a new record, never mutates; the `now` clock is injected.
 */

export interface ProceduralSkillOutcomes {
	/** Times applying this procedure demonstrably helped an attempt. */
	helped: number;
	/** Times it demonstrably hurt / misled. */
	hurt: number;
}

export interface ProceduralSkillProvenance {
	/** Where the procedure came from (a source id / URL / "learned"). */
	source: string;
	/** Trust label at capture time (mirrors skill-source-trust tiers). */
	trust: string;
	/** When it was first captured (ms epoch). */
	capturedAt: number;
}

export interface ProceduralSkillExecutionOutcomes {
	/** Attempts where the skill was applied AND the sandbox acceptance ran GREEN — execution-level validation. */
	validated: number;
	/** Attempts where the skill was applied and acceptance ran RED — execution-level refutation. */
	refuted: number;
}

export interface ProceduralSkill {
	id: string;
	title: string;
	/** The procedure body (steps / guidance). */
	content: string;
	status: SkillLifecycleStatus;
	/** Tags the procedure applies to (task kinds / domains), for retrieval matching. */
	applicabilityTags: string[];
	/** Monotonic version — bumped on every content change. */
	version: number;
	/** Hash of the canonical content (change detection + TOFU re-review). */
	contentHash: string;
	outcomes: ProceduralSkillOutcomes;
	/**
	 * F12.29 (Voyager): execution-level validation — stronger than helped/hurt tallies, which are judgment calls.
	 * Absent on legacy records (treated as zero/zero).
	 */
	execution?: ProceduralSkillExecutionOutcomes;
	/** F12.29: procedures this one depends on (apply those first); retrieval expands them dependency-first. */
	dependsOnSkillIds?: string[];
	/** The id of the record that superseded this one, or null while current. */
	supersededBy: string | null;
	provenance: ProceduralSkillProvenance;
	updatedAt: number;
}

export interface CreateProceduralSkillInput {
	id: string;
	title: string;
	content: string;
	contentHash: string;
	applicabilityTags?: readonly string[];
	provenance: ProceduralSkillProvenance;
	/** Starting lifecycle status; a freshly-imported procedure begins `quarantined`. Default `candidate`. */
	status?: SkillLifecycleStatus;
	now: number;
}

/** Create a fresh procedural-skill record (version 1, zero outcomes, not superseded). */
export function createProceduralSkill(input: CreateProceduralSkillInput): ProceduralSkill {
	return {
		id: input.id,
		title: input.title,
		content: input.content,
		status: input.status ?? "candidate",
		applicabilityTags: [...(input.applicabilityTags ?? [])],
		version: 1,
		contentHash: input.contentHash,
		outcomes: { helped: 0, hurt: 0 },
		supersededBy: null,
		provenance: input.provenance,
		updatedAt: input.now,
	};
}

/** Fold one applied-outcome into the record's helped/hurt tally. */
export function recordProceduralSkillOutcome(skill: ProceduralSkill, helped: boolean, now: number): ProceduralSkill {
	return {
		...skill,
		outcomes: {
			helped: skill.outcomes.helped + (helped ? 1 : 0),
			hurt: skill.outcomes.hurt + (helped ? 0 : 1),
		},
		updatedAt: now,
	};
}

/** Mark `skill` superseded by `replacementId` and deprecate it (the chain the store follows to the current version). */
export function supersedeProceduralSkill(skill: ProceduralSkill, replacementId: string, now: number): ProceduralSkill {
	return { ...skill, supersededBy: replacementId, status: "deprecated", updatedAt: now };
}

/** The empirical helped-rate (helped / (helped + hurt)); 0.5 neutral prior when there is no evidence. */
export function proceduralSkillHelpedRate(skill: ProceduralSkill): number {
	const total = skill.outcomes.helped + skill.outcomes.hurt;
	return total === 0 ? 0.5 : skill.outcomes.helped / total;
}

/** Record an execution-level outcome (F12.29): acceptance GREEN after applying the skill ⇒ validated, RED ⇒ refuted. */
export function recordProceduralSkillExecutionOutcome(
	skill: ProceduralSkill,
	validated: boolean,
	now: number,
): ProceduralSkill {
	const current = skill.execution ?? { validated: 0, refuted: 0 };
	return {
		...skill,
		execution: {
			validated: current.validated + (validated ? 1 : 0),
			refuted: current.refuted + (validated ? 0 : 1),
		},
		updatedAt: now,
	};
}

/**
 * F12.29 promotion gate: a candidate may promote to ACTIVE only when execution has validated it at least once and
 * validations outnumber refutations — "code validated by execution", not by vibes. Legacy records with no
 * execution data are NOT promotable under this gate (unmeasured ≠ validated).
 */
export function isExecutionValidatedForPromotion(skill: ProceduralSkill): boolean {
	const execution = skill.execution ?? { validated: 0, refuted: 0 };
	return execution.validated >= 1 && execution.validated > execution.refuted;
}
