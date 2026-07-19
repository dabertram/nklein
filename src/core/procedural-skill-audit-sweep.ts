/**
 * F12.30 lifecycle sweep — apply paired-trajectory audit verdicts to the procedural-skill bank.
 *
 * Promotion is DOUBLE-GATED: the population-level audit must say `promote` AND the skill must be
 * execution-validated (F12.29 — at least one acceptance-green application, validations > refutations). Either
 * gate alone is insufficient: the audit can ride confounds, and a single validated run proves nothing about the
 * population. `retire` deprecates from any non-deprecated status (deprecation is terminal per the lifecycle
 * rules); `revise`/`unmeasured` change nothing — they are operator evidence, not actions. Pure over injected
 * IO so the sweep is unit-testable and the CLI/auto-sweep share one implementation.
 */

import type { AgentAttemptEvent } from "./agent-attempt-ledger";
import { auditSkillFromPairedTrajectories, type SkillAuditVerdict } from "./procedural-skill-audit";
import { isExecutionValidatedForPromotion, type ProceduralSkill } from "./procedural-skill-record";
import { buildSkillTrajectoryPairs } from "./skill-trajectory-projection";

export interface SkillAuditSweepTransition {
	skillId: string;
	from: ProceduralSkill["status"];
	to: ProceduralSkill["status"];
	verdict: SkillAuditVerdict["action"];
	reason: string;
}

export interface SkillAuditSweepResult {
	verdicts: Array<{ skillId: string } & SkillAuditVerdict>;
	applied: SkillAuditSweepTransition[];
	/** Promote verdicts blocked by the F12.29 execution gate (audit said yes, execution evidence said not yet). */
	blockedByExecutionGate: string[];
}

export async function runSkillAuditSweep(deps: {
	readAttempts: () => Promise<readonly AgentAttemptEvent[]>;
	loadSkills: () => Promise<readonly ProceduralSkill[]>;
	saveSkill: (skill: ProceduralSkill) => Promise<void>;
	now: () => number;
	/** False = report-only (verdicts computed, nothing persisted). */
	apply: boolean;
}): Promise<SkillAuditSweepResult> {
	const attempts = await deps.readAttempts();
	const pairs = buildSkillTrajectoryPairs(attempts);
	const verdicts = pairs.map((pair) => ({
		skillId: pair.skillId,
		...auditSkillFromPairedTrajectories(pair.withSkill, pair.withoutSkill),
	}));
	const applied: SkillAuditSweepTransition[] = [];
	const blockedByExecutionGate: string[] = [];
	if (!deps.apply) {
		return { verdicts, applied, blockedByExecutionGate };
	}
	const skills = await deps.loadSkills();
	const byId = new Map(skills.map((skill) => [skill.id, skill] as const));
	for (const verdict of verdicts) {
		const skill = byId.get(verdict.skillId);
		if (!skill) {
			continue;
		}
		if (verdict.action === "promote") {
			if (skill.status !== "candidate") {
				continue; // already active/terminal — nothing to promote
			}
			if (!isExecutionValidatedForPromotion(skill)) {
				blockedByExecutionGate.push(skill.id);
				continue;
			}
			const promoted: ProceduralSkill = { ...skill, status: "active", updatedAt: deps.now() };
			await deps.saveSkill(promoted);
			applied.push({
				skillId: skill.id,
				from: skill.status,
				to: "active",
				verdict: verdict.action,
				reason: `${verdict.reason}; execution-validated`,
			});
		} else if (verdict.action === "retire" && skill.status !== "deprecated") {
			const retired: ProceduralSkill = { ...skill, status: "deprecated", updatedAt: deps.now() };
			await deps.saveSkill(retired);
			applied.push({
				skillId: skill.id,
				from: skill.status,
				to: "deprecated",
				verdict: verdict.action,
				reason: verdict.reason,
			});
		}
	}
	return { verdicts, applied, blockedByExecutionGate };
}
