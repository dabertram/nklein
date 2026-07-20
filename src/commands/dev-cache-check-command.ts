/**
 * `nklein dev cache-check` — is this llama.cpp build ACTUALLY reusing the prompt cache? (P19.4)
 *
 * The verification core shipped with no consumer. Its point is that a runtime accepting `--cache-reuse` is not
 * evidence it caches anything (llama.cpp #15082), and on Apple Silicon a silent cache miss is 24–36× the
 * generation cost — so "the flag is set" must never stand in for "the prefill got faster". This command supplies
 * the only thing that settles it: two real prefill timings, cold and warm, over the same prefix.
 *
 * It reads llama.cpp server/CLI output — the same logs a run already produces — rather than issuing requests
 * itself, so it needs no live endpoint and works against a captured log.
 */

import { readFile } from "node:fs/promises";
import {
	assessCacheEffectiveness,
	type PromptEvalTiming,
	parsePromptEvalTiming,
} from "../core/prompt-cache-verification";

/**
 * The LAST prompt-eval line in a log, since a warm run's file may contain the cold run too. Returns null when
 * none parses — a missing timing is a harness gap the core reports as `indeterminate`, never as success.
 */
function lastPromptEvalTiming(text: string): PromptEvalTiming | null {
	let latest: PromptEvalTiming | null = null;
	for (const line of text.split("\n")) {
		const parsed = parsePromptEvalTiming(line);
		if (parsed) {
			latest = parsed;
		}
	}
	return latest;
}

export async function runDevCacheCheckCommand(options: {
	cold?: string;
	warm?: string;
	json?: boolean;
}): Promise<void> {
	if (!options.cold || !options.warm) {
		process.stdout.write(
			"usage: dev cache-check --cold <log> --warm <log>\n" +
				"  Each file is llama.cpp output containing a `prompt eval time = … ms / … tokens` line.\n" +
				"  The two runs must share the SAME prefix, or the speed-up measures the prompts, not the cache.\n",
		);
		process.exitCode = 2;
		return;
	}

	const coldText = await readFile(options.cold, "utf8").catch(() => null);
	const warmText = await readFile(options.warm, "utf8").catch(() => null);
	if (coldText === null || warmText === null) {
		process.stdout.write(`Could not read ${coldText === null ? options.cold : options.warm}.\n`);
		process.exitCode = 1;
		return;
	}

	const cold = lastPromptEvalTiming(coldText);
	const warm = lastPromptEvalTiming(warmText);
	const assessment = assessCacheEffectiveness({ cold, warm });

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ cold, warm, assessment }, null, 2)}\n`);
		// Only a definite "not_working" is a failure exit — `indeterminate` is a harness gap, not a caching defect,
		// and must not fail a script that would then "fix" a cache that was never shown broken.
		process.exitCode = assessment.verdict === "not_working" ? 1 : 0;
		return;
	}

	process.stdout.write(`PROMPT CACHE CHECK: ${assessment.verdict.toUpperCase()}\n`);
	if (cold) {
		process.stdout.write(`  cold: ${cold.milliseconds.toFixed(1)} ms / ${cold.tokens} tokens\n`);
	}
	if (warm) {
		process.stdout.write(`  warm: ${warm.milliseconds.toFixed(1)} ms / ${warm.tokens} tokens\n`);
	}
	if (assessment.speedup !== null) {
		process.stdout.write(
			`  speed-up: ${Number.isFinite(assessment.speedup) ? `${assessment.speedup.toFixed(2)}×` : "∞"}\n`,
		);
	}
	process.stdout.write(`\n${assessment.reason}\n`);
	process.exitCode = assessment.verdict === "not_working" ? 1 : 0;
}
