/**
 * `nklein dev diagnose` — turn a task's test results into a DIAGNOSIS, not just pass/fail (P20.2 / diagnostic-oracles).
 *
 * De-orphans the two verdict cores the orphan-core triage flagged as highest-leverage: hidden-split evaluation is
 * "exactly P20.2's visible/held-out gap measurement." Both are pure over injected results, so this command applies
 * them to captured test outcomes — the harness wires the real commands, but the DIAGNOSIS is checkable here.
 *
 * Two modes:
 *  --splits   {failToPass:[{id,passed}], passToPass:[{id,passed}]} JSON → which failure mode occurred
 *  --repeats  [{passed, terminalState?}] JSONL         → pass_all / pass_any / flaky / terminal states
 */

import { readFile } from "node:fs/promises";
import {
	evaluateHiddenSplits,
	type HiddenSplitResults,
	type RepeatRunResult,
	summarizeRepeatRuns,
} from "../core/diagnostic-oracles";

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
	json?: boolean;
}): Promise<void> {
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
			"       dev diagnose --repeats <file>  (one {passed,terminalState?} JSON per line)\n",
	);
	process.exitCode = 2;
}
