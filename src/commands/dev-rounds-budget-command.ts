/**
 * `nklein dev rounds-budget` — how many reasoning rounds is a loop worth, and when should it stop? (rounds-budget.ts)
 *
 * De-orphans the learned rounds-budget core (orphan-core triage: worth wiring). An enforced-reasoning loop
 * (self-consistency / debate / stronger-peer carry) helps up to a point then plateaus, burning tokens for no
 * gain. Both decisions are pure over injected numbers, so this makes them checkable without a live loop:
 *  --learn <csv>   per-round marginal improvements → the budget the plateau justifies
 *  --decide ...     one round's state → stop or keep iterating, and why
 *
 * The PRODUCTION wire — calling decideStopIterating each round inside the enforced-reasoning EXECUTION loop — is
 * model-gated (that loop runs a model per round); the gate sets the budget up front, the loop consumes the
 * early-stop. This command exercises the decision the loop will make.
 */

import { decideStopIterating, learnRoundsBudget } from "../core/rounds-budget";

export function runDevRoundsBudgetCommand(options: {
	learn?: string;
	decide?: boolean;
	roundsDone?: string;
	maxRounds?: string;
	lastImprovement?: string;
	minImprovement?: string;
	converged?: boolean;
	cap?: string;
	json?: boolean;
}): void {
	if (options.learn !== undefined) {
		const improvements = options.learn
			.split(",")
			.map((token) => Number.parseFloat(token.trim()))
			.filter((value) => Number.isFinite(value));
		const minImprovement = Number.parseFloat(options.minImprovement ?? "0.02");
		const cap = Number.parseInt(options.cap ?? "5", 10) || 5;
		const budget = learnRoundsBudget(improvements, minImprovement, cap);
		if (options.json) {
			process.stdout.write(`${JSON.stringify({ improvements, minImprovement, cap, budget }, null, 2)}\n`);
			return;
		}
		process.stdout.write(
			`LEARNED ROUNDS BUDGET: ${budget}\n  from ${improvements.length} observed improvement(s), min-worth ${minImprovement}, cap ${cap}.\n` +
				`  (leading rounds whose gain cleared the floor before the plateau)\n`,
		);
		return;
	}

	if (options.decide) {
		const decision = decideStopIterating({
			roundsDone: Number.parseInt(options.roundsDone ?? "0", 10) || 0,
			maxRounds: Number.parseInt(options.maxRounds ?? "3", 10) || 3,
			lastImprovement: Number.parseFloat(options.lastImprovement ?? "0"),
			minImprovement: Number.parseFloat(options.minImprovement ?? "0.02"),
			...(options.converged ? { converged: true } : {}),
		});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
		} else {
			process.stdout.write(`${decision.stop ? "STOP" : "CONTINUE"}: ${decision.reason}\n`);
		}
		// A script can gate on it: stop = 0 (done), continue = 1 (more work).
		process.exitCode = decision.stop ? 0 : 1;
		return;
	}

	process.stdout.write(
		"usage: dev rounds-budget --learn <csv of per-round improvements> [--min-improvement <f>] [--cap <n>]\n" +
			"       dev rounds-budget --decide --rounds-done <n> --max-rounds <n> --last-improvement <f> [--min-improvement <f>] [--converged]\n",
	);
	process.exitCode = 2;
}
