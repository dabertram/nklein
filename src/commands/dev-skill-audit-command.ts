import { runSkillAuditSweep } from "../core/procedural-skill-audit-sweep";
import { readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { getCurrentProceduralSkills, upsertProceduralSkill } from "../state/procedural-skill-store";

/**
 * F12.30 — `nklein dev skill-audit`: pair ledger attempts per surfaced skill (the F12.29 stamp) and print the
 * ground-truth-free promote/revise/retire verdicts. Read-only by default; `--apply` runs the lifecycle sweep,
 * which promotes ONLY through the double gate (audit verdict AND F12.29 execution validation) and deprecates on
 * retire.
 */
export async function runDevSkillAuditCommand(options: { json?: boolean; apply?: boolean }): Promise<void> {
	const result = await runSkillAuditSweep({
		readAttempts: async () => (await readAllAgentLedger()).filter((event) => event.kind === "attempt"),
		loadSkills: () => getCurrentProceduralSkills(),
		saveSkill: (skill) => upsertProceduralSkill(skill),
		now: () => Date.now(),
		apply: options.apply === true,
	});
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	if (result.verdicts.length === 0) {
		process.stdout.write(
			"No surfaced-skill attempts in the ledger — the F12.29 stamp fills this as skill-assisted cards run.\n",
		);
		return;
	}
	process.stdout.write(`Skill audit (F12.30)${options.apply ? " — APPLYING" : " — report-only"}:\n\n`);
	for (const verdict of result.verdicts) {
		process.stdout.write(
			`  ${verdict.skillId}: ${verdict.action.toUpperCase()} — ${verdict.reason} (with ${verdict.withSamples} / without ${verdict.withoutSamples})\n`,
		);
	}
	for (const transition of result.applied) {
		process.stdout.write(
			`  APPLIED ${transition.skillId}: ${transition.from} → ${transition.to} (${transition.reason})\n`,
		);
	}
	for (const blocked of result.blockedByExecutionGate) {
		process.stdout.write(`  BLOCKED ${blocked}: audit says promote but no execution validation yet (F12.29 gate).\n`);
	}
}
