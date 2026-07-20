/**
 * `nklein dev experiment-design` — can a proposed A/B answer its question, BEFORE the fleet hours are spent?
 *
 * Three checks that are usually made after a run, if at all, and are only useful before one:
 *  - **Is it powered?** (P20.6) — what is the smallest effect this task count could detect?
 *  - **Are the configurations comparable?** (P20.8) — harness variance ran 7.8× model variance in the literature
 *  - **Is the ORDER safe?** (P20.7) — a laptop throttles, so sequential arms manufacture a difference
 *
 * Each failure mode produces a result. That is what makes them expensive: an underpowered comparison does not
 * error, it returns `unresolved` after hours and reads like bad luck; a confounded pair returns a clean number
 * measuring the scaffold; a sequential schedule returns a p-value on the thermal curve. **All three are cheaper
 * to catch here than to discover in the output, and none of them is visible in the output at all.**
 *
 * Built as a wiring pass over three cores that had no consumer, rather than as a fourth core. The three belong
 * together because they are the questions asked at one moment — when an experiment is being designed — and an
 * operator who checks one usually wants all three.
 */

import { buildAbbaSchedule } from "../core/ab-trial-ordering";
import { assessCardCompleteness, assessComparability, type HarnessCard } from "../core/harness-card";
import { assessPreRegistration } from "../core/minimum-detectable-effect";

export async function runDevExperimentDesignCommand(options: {
	tasks?: string;
	repeats?: string;
	effect?: string;
	json?: boolean;
}): Promise<void> {
	const taskCount = Number.parseInt(options.tasks ?? "50", 10);
	const repeats = Number.parseInt(options.repeats ?? "1", 10);
	const declaredMdePoints = Number.parseFloat(options.effect ?? "10");

	const power = assessPreRegistration({ declaredMdePoints, design: { taskCount, repeats } });

	// Two identical cards: the BASELINE case an operator should start from. Any real comparison substitutes its
	// own, and the point of showing the identical pair is that `comparable` is the only clean starting state —
	// every difference from here is one the operator chose and must report.
	const baseCard: HarnessCard = {
		id: "arm-a",
		execution: "docker, per-task sandbox",
		tool: "default tool set",
		context: "effective window, compaction at the operational default",
		scheduling: "sequential, cap 1",
		observability: "ledger + self-observations",
		verification: "acceptance command",
		governance: "egress fence on",
		retryBudget: 2,
	};
	const comparability = assessComparability(baseCard, { ...baseCard, id: "arm-b" });
	const completeness = assessCardCompleteness(baseCard);
	const schedule = buildAbbaSchedule(Math.max(1, Math.ceil(taskCount / 4)));

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ power, comparability, completeness, schedule }, null, 2)}\n`);
		return;
	}

	process.stdout.write(
		`POWER (P20.6) — ${taskCount} task(s) × ${repeats} repeat(s), looking for ≥${declaredMdePoints} pp\n`,
	);
	process.stdout.write(`  ${power.verdict.toUpperCase()}: ${power.reason}\n\n`);

	process.stdout.write("COMPARABILITY (P20.8)\n");
	process.stdout.write(`  ${comparability.verdict.toUpperCase()}: ${comparability.reason}\n`);
	if (!completeness.complete) {
		process.stdout.write(`  ⚠️ card incomplete — missing: ${completeness.missing.join(", ")}\n`);
	}
	process.stdout.write(
		"  Substitute the two real cards before trusting this line; identical cards are the clean starting state,\n" +
			"  not a finding.\n\n",
	);

	process.stdout.write(`ORDERING (P20.7) — first 12 slots of an ABBA schedule for ${taskCount} task(s)\n`);
	process.stdout.write(`  ${schedule.slice(0, 12).join(" ")}${schedule.length > 12 ? " …" : ""}\n`);
	process.stdout.write(
		"  Sequential arms (A,A,…,B,B) give A the cool slots and B the hot ones on a throttling machine, which\n" +
			"  manufactures a difference. ABBA gives both arms the same average time-penalty.\n\n",
	);

	if (power.verdict === "underpowered_by_construction") {
		process.stdout.write(
			"VERDICT: do NOT run this design. It cannot detect the effect it is looking for, and it will spend the\n" +
				"hours anyway before reporting 'unresolved' — which reads like bad luck rather than like arithmetic.\n",
		);
		process.exitCode = 1;
		return;
	}
	process.stdout.write("VERDICT: the design can answer its question, given comparable cards and this ordering.\n");
}
