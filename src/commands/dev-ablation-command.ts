/**
 * `nklein dev ablation` — did stubbing the artifact actually break anything? (P20.3)
 *
 * The ablation core shipped with no consumer. Its finding is uncomfortable and worth having wired: a production
 * agent once scored 222/222 on a hidden oracle while the library it was asked to build sat inert — the tests
 * were not lying about their results, they were lying about what produced them. The check is to stub the
 * artifact, re-run the suite, and see if anyone notices.
 *
 * This command is the ASSESSOR half: it reads a baseline test run and an ablated one (the artifact stubbed) and
 * returns the verdict. It deliberately does NOT perform the stub-and-run itself — that mutates source and runs a
 * whole suite, which belongs in the nightly/harness, not in a command a person points at a working tree. Given
 * the two captured runs, though, the judgement is pure and settled here.
 */

import { readFile } from "node:fs/promises";
import { assessNoOpAblation, type TestOutcome } from "../core/no-op-ablation";

function parseOutcomes(text: string): TestOutcome[] {
	const outcomes: TestOutcome[] = [];
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}
		try {
			const parsed = JSON.parse(line) as { testId?: unknown; passed?: unknown };
			if (typeof parsed.testId === "string" && typeof parsed.passed === "boolean") {
				outcomes.push({ testId: parsed.testId, passed: parsed.passed });
			}
		} catch {
			// A malformed line is skipped; the assessor's inconclusive guards cover a resulting empty set.
		}
	}
	return outcomes;
}

export async function runDevAblationCommand(options: {
	baseline?: string;
	ablated?: string;
	json?: boolean;
}): Promise<void> {
	if (!options.baseline || !options.ablated) {
		process.stdout.write(
			"usage: dev ablation --baseline <file> --ablated <file>\n" +
				"  Each file is one {testId,passed} JSON per line.\n" +
				"  baseline = the suite as-is; ablated = the SAME suite with the artifact stubbed out.\n",
		);
		process.exitCode = 2;
		return;
	}

	const baselineText = await readFile(options.baseline, "utf8").catch(() => null);
	const ablatedText = await readFile(options.ablated, "utf8").catch(() => null);
	if (baselineText === null || ablatedText === null) {
		process.stdout.write(`Could not read ${baselineText === null ? options.baseline : options.ablated}.\n`);
		process.exitCode = 1;
		return;
	}

	const assessment = assessNoOpAblation({
		baseline: parseOutcomes(baselineText),
		ablated: parseOutcomes(ablatedText),
	});

	if (options.json) {
		process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
		// `decorative` is the alarming verdict — the artifact does nothing the suite measures — so it fails a
		// script. `inconclusive` does NOT: missing evidence is a harness gap, and failing on it would be the exact
		// "convert missing evidence into a clean bill of health" move inverted into a false alarm.
		process.exitCode = assessment.verdict === "decorative" ? 1 : 0;
		return;
	}

	process.stdout.write(`NO-OP ABLATION: ${assessment.verdict.toUpperCase()}\n`);
	if (assessment.brokenByStub.length > 0) {
		process.stdout.write(
			`  broke when stubbed (${assessment.brokenByStub.length}): ${assessment.brokenByStub.slice(0, 8).join(", ")}\n`,
		);
	}
	if (assessment.indifferentTests.length > 0) {
		process.stdout.write(
			`  passed WITH AND WITHOUT the artifact (${assessment.indifferentTests.length}) — each never measured it: ${assessment.indifferentTests.slice(0, 8).join(", ")}\n`,
		);
	}
	process.stdout.write(`\n${assessment.reason}\n`);
	if (assessment.verdict === "decorative") {
		process.stdout.write(
			"⚠️ A perfect green suite over a decorative artifact should LOWER confidence, not raise it — the failure " +
				"mode looks better than honest work.\n",
		);
	}
	process.exitCode = assessment.verdict === "decorative" ? 1 : 0;
}
