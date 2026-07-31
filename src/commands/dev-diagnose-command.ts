/**
 * `nklein dev diagnose` — turn a task's test results into a DIAGNOSIS, not just pass/fail (P20.2 / diagnostic-oracles).
 *
 * De-orphans the two verdict cores the orphan-core triage flagged as highest-leverage: hidden-split evaluation is
 * "exactly P20.2's visible/held-out gap measurement." Both are pure over injected results, so this command applies
 * them to captured test outcomes — the harness wires the real commands, but the DIAGNOSIS is checkable here.
 *
 * Three modes:
 *  --splits   {failToPass:[{id,passed}], passToPass:[{id,passed}]} JSON → which failure mode occurred
 *  --repeats  [{passed, terminalState?}] JSONL         → pass_all / pass_any / flaky / terminal states
 *  --oracle   an oracle plan JSON                      → is it HELD OUT at all, and what is the visible gap
 *
 * `--oracle` runs BEFORE a task, not after: it answers "can this oracle grade anything?" — the question that has
 * to be settled before the other two modes' numbers mean anything. An oracle the agent can edit produces
 * confident-looking splits that measure nothing.
 */

import { readFile } from "node:fs/promises";
import {
	evaluateHiddenSplits,
	type HiddenSplitResults,
	type RepeatRunResult,
	summarizeRepeatRuns,
} from "../core/diagnostic-oracles";
import { assessOracleIndependence, type HeldOutProbe, measureVisibleHeldOutGap } from "../core/held-out-oracle";

/** The on-disk oracle plan. Scores are optional: an oracle can be VALIDATED long before it is ever run. */
interface OraclePlanFile {
	probes?: readonly HeldOutProbe[];
	agentWritableRoots?: readonly string[];
	runner?: readonly string[];
	projectAcceptanceCommand?: string;
	visibleScore?: number;
	heldOutScore?: number | null;
	linesOfCode?: number | null;
}

async function readJson(path: string): Promise<unknown> {
	const text = await readFile(path, "utf8");
	return JSON.parse(text);
}

function parseRepeatRuns(text: string): RepeatRunResult[] {
	const out: RepeatRunResult[] = [];
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (!t) {
			continue;
		}
		try {
			const p = JSON.parse(t) as { passed?: unknown; terminalState?: unknown };
			if (typeof p.passed === "boolean") {
				out.push({
					passed: p.passed,
					...(typeof p.terminalState === "string" ? { terminalState: p.terminalState } : {}),
				});
			}
		} catch {
			// skip
		}
	}
	return out;
}

export async function runDevDiagnoseCommand(options: {
	splits?: string;
	repeats?: string;
	oracle?: string;
	json?: boolean;
}): Promise<void> {
	if (options.oracle) {
		const plan = (await readJson(options.oracle).catch(() => null)) as OraclePlanFile | null;
		if (!plan || typeof plan !== "object") {
			process.stdout.write(`Could not read an oracle plan object from ${options.oracle}.\n`);
			process.exitCode = 1;
			return;
		}
		const independence = assessOracleIndependence({
			probes: plan.probes ?? [],
			agentWritableRoots: plan.agentWritableRoots ?? [],
			runner: plan.runner ?? [],
			projectAcceptanceCommand: plan.projectAcceptanceCommand ?? "",
		});
		// The gap is only reported when a visible score exists. Validating a plan before any run is the normal
		// case, and printing a "no held-out measurement" verdict for it would read as a failure rather than as
		// "you have not run it yet".
		const gap =
			typeof plan.visibleScore === "number"
				? measureVisibleHeldOutGap({
						visibleScore: plan.visibleScore,
						heldOutScore: plan.heldOutScore ?? null,
						linesOfCode: plan.linesOfCode ?? null,
					})
				: null;
		if (options.json) {
			process.stdout.write(`${JSON.stringify({ independence, gap }, null, 2)}\n`);
		} else {
			process.stdout.write(`ORACLE INDEPENDENCE: ${independence.independent ? "HELD OUT" : "NOT INDEPENDENT"}\n`);
			process.stdout.write(`  ${independence.reason}\n`);
			for (const finding of independence.findings) {
				process.stdout.write(`  - ${finding.code}: ${finding.detail}\n`);
			}
			if (gap) {
				process.stdout.write(`VISIBLE/HELD-OUT GAP: ${gap.verdict}\n  ${gap.reason}\n`);
			}
		}
		// Exit tracks the two questions independently: a plan with no scores is judged only on independence, so
		// "validate before running" does not always fail and train an operator to ignore the exit code.
		process.exitCode =
			independence.independent && (gap === null || gap.verdict === "gap_within_worst_case_envelope") ? 0 : 1;
		return;
	}

	if (options.splits) {
		const results = (await readJson(options.splits).catch(() => null)) as HiddenSplitResults | null;
		if (!results || !Array.isArray(results.failToPass) || !Array.isArray(results.passToPass)) {
			process.stdout.write(`Could not read a {failToPass,passToPass} object from ${options.splits}.\n`);
			process.exitCode = 1;
			return;
		}
		const verdict = evaluateHiddenSplits(results);
		if (options.json) {
			process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
		} else {
			process.stdout.write(`HIDDEN-SPLIT DIAGNOSIS: ${verdict.outcome}\n`);
			if (verdict.failToPassFailures.length > 0) {
				process.stdout.write(`  behavior NOT delivered: ${verdict.failToPassFailures.join(", ")}\n`);
			}
			if (verdict.passToPassFailures.length > 0) {
				process.stdout.write(`  regressions introduced: ${verdict.passToPassFailures.join(", ")}\n`);
			}
		}
		// Only the unambiguous success is exit 0; every failure mode AND the inconclusive-no-fail-to-pass labelling
		// bug fail a script — inconclusive is not a pass, exactly as the core insists.
		process.exitCode = verdict.outcome === "behavior_delivered_no_regressions" ? 0 : 1;
		return;
	}

	if (options.repeats) {
		const text = await readFile(options.repeats, "utf8").catch(() => null);
		if (text === null) {
			process.stdout.write(`Could not read ${options.repeats}.\n`);
			process.exitCode = 1;
			return;
		}
		const summary = summarizeRepeatRuns(parseRepeatRuns(text));
		if (options.json) {
			process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
		} else {
			process.stdout.write(
				`REPEAT-RUN SUMMARY: ${summary.passes}/${summary.runs} passed (${Math.round(summary.passRate * 100)}%)` +
					`${summary.flaky ? " — FLAKY (repeats disagree)" : summary.passAll ? " — reliable pass" : summary.passes === 0 ? " — reliable fail" : ""}\n`,
			);
			if (summary.terminalFailureStates.length > 0) {
				process.stdout.write(`  failures died in: ${summary.terminalFailureStates.join(", ")}\n`);
			}
		}
		return;
	}

	process.stdout.write(
		"usage: dev diagnose --splits <file>   ({failToPass,passToPass} of {id,passed})\n" +
			"       dev diagnose --repeats <file>  (one {passed,terminalState?} JSON per line)\n" +
			"       dev diagnose --oracle <file>   (oracle plan: is it held out, and what is the gap)\n",
	);
	process.exitCode = 2;
}
