/**
 * F12.30 pairing projection — turn raw attempt-ledger events into the paired trajectory samples
 * `auditSkillFromPairedTrajectories` consumes.
 *
 * For each skill id that appears in any attempt's `surfacedSkillIds` (the F12.29 stamp), split comparable
 * attempts into WITH (the skill was surfaced) and WITHOUT (it was not) and map each attempt to a
 * {@link SkillTrajectorySample}. Comparability is by ROLE (a worker attempt only pairs against worker attempts —
 * reviewer/architect trajectories have different success shapes); difficulty refinement can narrow further when
 * enough samples exist. Success = the outcome taxonomy's success bucket; cost = duration when both timestamps
 * exist. Pure over the supplied events — the caller owns reading the ledger.
 */

import type { AgentAttemptEvent } from "./agent-attempt-ledger";
import type { SkillTrajectorySample } from "./procedural-skill-audit";

export interface SkillTrajectoryPair {
	skillId: string;
	withSkill: SkillTrajectorySample[];
	withoutSkill: SkillTrajectorySample[];
}

function toSample(event: AgentAttemptEvent): SkillTrajectorySample {
	const wallMs =
		event.startedAt !== null && event.completedAt !== null && event.completedAt > event.startedAt
			? event.completedAt - event.startedAt
			: undefined;
	return {
		succeeded: event.outcome === "success",
		...(wallMs !== undefined ? { wallMs } : {}),
	};
}

/**
 * Build the per-skill paired samples from attempt events. Only attempts whose role matches at least one
 * WITH-skill attempt's role are counted on the WITHOUT side (role-comparable pairing); attempts surfacing the
 * skill land on WITH regardless of what else was surfaced alongside (real usage is compound — the audit's
 * thresholds absorb the noise). Skills never surfaced produce no pair.
 */
export function buildSkillTrajectoryPairs(events: readonly AgentAttemptEvent[]): SkillTrajectoryPair[] {
	const attempts = events.filter((event) => event.kind === "attempt");
	const rolesBySkill = new Map<string, Set<string>>();
	for (const event of attempts) {
		for (const skillId of event.surfacedSkillIds ?? []) {
			const roles = rolesBySkill.get(skillId) ?? new Set<string>();
			roles.add(event.role ?? "worker");
			rolesBySkill.set(skillId, roles);
		}
	}
	const pairs: SkillTrajectoryPair[] = [];
	for (const [skillId, roles] of rolesBySkill) {
		const withSkill: SkillTrajectorySample[] = [];
		const withoutSkill: SkillTrajectorySample[] = [];
		for (const event of attempts) {
			if (!roles.has(event.role ?? "worker")) {
				continue;
			}
			if ((event.surfacedSkillIds ?? []).includes(skillId)) {
				withSkill.push(toSample(event));
			} else {
				withoutSkill.push(toSample(event));
			}
		}
		pairs.push({ skillId, withSkill, withoutSkill });
	}
	return pairs.sort((left, right) => (left.skillId < right.skillId ? -1 : 1));
}
