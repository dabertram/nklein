import { recordProceduralSkillExecutionOutcome } from "../core/procedural-skill-record";
import { readAgentLedger } from "../state/agent-attempt-ledger-store";
import { getCurrentProceduralSkills, upsertProceduralSkill } from "../state/procedural-skill-store";
import { hashWorkspacePathForLedger } from "./nklein-ledger-attempt";

/**
 * F12.29 execution-outcome recorder — the acceptance-seam bridge that turns a sandbox acceptance verdict into
 * execution-level skill evidence: for every procedural skill SURFACED into the task's session (the ledger's
 * `surfacedSkillIds` stamp), record validated (acceptance GREEN) or refuted (RED) on the skill record. This is
 * the F12.29 promotion gate's data source — stronger than helped/hurt judgment tallies because the verifier ran.
 * Best-effort by contract: any failure resolves silently (the review flow must never block on skill bookkeeping).
 */
export async function recordExecutionOutcomeForTaskSkills(input: {
	taskId: string;
	workspacePath: string | null;
	passed: boolean;
}): Promise<void> {
	try {
		const events = await readAgentLedger({
			workspacePathHash: hashWorkspacePathForLedger(input.workspacePath),
		});
		const attempts = events.filter((event) => event.kind === "attempt" && event.taskId === input.taskId);
		const latest = attempts.at(-1);
		const surfacedSkillIds = latest && "surfacedSkillIds" in latest ? (latest.surfacedSkillIds ?? []) : [];
		if (surfacedSkillIds.length === 0) {
			return;
		}
		const skills = await getCurrentProceduralSkills();
		const byId = new Map(skills.map((skill) => [skill.id, skill] as const));
		for (const skillId of surfacedSkillIds) {
			const skill = byId.get(skillId);
			if (!skill) {
				continue;
			}
			await upsertProceduralSkill(recordProceduralSkillExecutionOutcome(skill, input.passed, Date.now()));
		}
	} catch {
		// Best-effort only — skill bookkeeping never disturbs the review flow.
	}
}
