/**
 * `nklein dev interventions` — how often did a human have to step in, and how bad was it?
 *
 * P20.10's argument: the genuinely informative moment is not a crash (already logged, easy to see) but the one
 * where a HUMAN steps in. Those are the harness's blind spots — the cases where it believed it was fine and a
 * person disagreed.
 *
 * ── THIS COMMAND PRINTS ITS OWN COVERAGE, PROMINENTLY ──
 * All four current severities have product emission sites. Coverage still prints because a future taxonomy change
 * must not turn an uninstrumented severity's zero into flattering evidence — the California disengagement-report
 * mistake P20.10 exists to avoid.
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { extractInterventionEvents } from "../core/intervention-observation";
import { computeInterventionMetrics, rankInterventionsForReport } from "../core/operator-intervention";

async function readTelemetry(home: string): Promise<string> {
	const dir = join(home, ".nklein", "nklein", "telemetry");
	const files = await readdir(dir).catch(() => [] as string[]);
	const parts = await Promise.all(
		files.filter((name) => name.endsWith(".jsonl")).map((name) => readFile(join(dir, name), "utf8").catch(() => "")),
	);
	return parts.join("\n");
}

export async function runDevInterventionsCommand(options: { home?: string; json?: boolean }): Promise<void> {
	const home = options.home ?? homedir();
	const telemetry = await readTelemetry(home);
	const extraction = extractInterventionEvents(telemetry);

	// The denominator is the tasks that were intervened on, in first-seen order. That is NOT the full completed
	// set — this command reads telemetry, which records interventions rather than completions — so the streak and
	// any ratio are computed over a set this command can actually see, and the limit is stated below rather than
	// papered over with a plausible-looking total.
	const taskOrder: string[] = [];
	for (const event of extraction.events) {
		if (!taskOrder.includes(event.taskId)) {
			taskOrder.push(event.taskId);
		}
	}

	const metrics = computeInterventionMetrics({
		events: extraction.events,
		completedTaskIdsInOrder: taskOrder,
	});

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ metrics, coverage: extraction }, null, 2)}\n`);
		return;
	}

	process.stdout.write(`OPERATOR INTERVENTIONS (from ${home})\n\n`);
	process.stdout.write(`${metrics.summary}\n\n`);
	for (const severity of ["nudge", "correction", "takeover", "abort"] as const) {
		const instrumented = extraction.instrumentedSeverities.includes(severity);
		process.stdout.write(
			`  ${severity.padEnd(11)} ${String(metrics.bySeverity[severity]).padStart(4)}${instrumented ? "" : "   (NOT INSTRUMENTED — this 0 means unmeasured)"}\n`,
		);
	}

	const worst = rankInterventionsForReport(extraction.events).slice(0, 5);
	if (worst.length > 0) {
		process.stdout.write(`\nMost severe first:\n`);
		for (const event of worst) {
			process.stdout.write(`  ${event.severity.padEnd(11)} ${event.taskId}\n`);
		}
	}

	process.stdout.write(`\n${extraction.coverageNote}\n`);
	process.stdout.write(
		"DENOMINATOR: computed over tasks that appear in intervention telemetry, NOT over all completed tasks —\n" +
			"so treat these as counts, not as a per-task rate. A rate needs the completion set, which this source\n" +
			"does not carry.\n",
	);
	if (extraction.unparseableLines > 0) {
		process.stdout.write(`${extraction.unparseableLines} telemetry line(s) were unreadable and DROPPED.\n`);
	}
}
