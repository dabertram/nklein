import { auditSkillFromPairedTrajectories } from "../core/procedural-skill-audit";
import { buildSkillTrajectoryPairs } from "../core/skill-trajectory-projection";
import { readAllAgentLedger } from "../state/agent-attempt-ledger-store";

/**
 * F12.30 — `nklein dev skill-audit`: read the attempt ledger, pair attempts per surfaced skill (the F12.29
 * stamp), and print the ground-truth-free promote/revise/retire verdicts. READ-ONLY: applying a verdict to the
 * skill store is the lifecycle sweep's job (deliberately separate so the operator sees the evidence first).
 */
export async function runDevSkillAuditCommand(options: { json?: boolean }): Promise<void> {
	const events = await readAllAgentLedger();
	const attempts = events.filter((event) => event.kind === "attempt");
	const pairs = buildSkillTrajectoryPairs(attempts);
	const verdicts = pairs.map((pair) => ({
		skillId: pair.skillId,
		...auditSkillFromPairedTrajectories(pair.withSkill, pair.withoutSkill),
	}));
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ attempts: attempts.length, verdicts }, null, 2)}\n`);
		return;
	}
	if (verdicts.length === 0) {
		process.stdout.write(
			`No surfaced-skill attempts in the ledger (${attempts.length} attempt(s) scanned) — the F12.29 stamp fills this as skill-assisted cards run.\n`,
		);
		return;
	}
	process.stdout.write(`Skill audit (F12.30) over ${attempts.length} attempt(s):\n\n`);
	for (const verdict of verdicts) {
		process.stdout.write(
			`  ${verdict.skillId}: ${verdict.action.toUpperCase()} — ${verdict.reason} (with ${verdict.withSamples} / without ${verdict.withoutSamples})\n`,
		);
	}
}
