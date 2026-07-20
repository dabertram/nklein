/**
 * `nklein dev evidence` — what does this project actually KNOW, and how well?
 *
 * Three questions that are usually answered separately and are really one question:
 *  - **Are our numbers thresholds or measurements?** (P18.5)
 *  - **Can our grader be forged?** (P20.1) — if it can, every other number here is void
 *  - **Which benchmarks can even produce a signal for a local fleet?** (P20.9)
 *
 * Built because 15 of the 24 cores written on 2026-07-20 had no live consumer, and adding a 16th would have been
 * the same mistake with a better docblock. These three answer one operator question, so one surface is honest
 * rather than a wire invented to clear an audit.
 *
 * The ordering is deliberate: grader integrity prints FIRST. If the grader is forgeable, the threshold table and
 * the benchmark list are describing a measurement process that does not measure — and a reader who sees the
 * detail first will have formed an impression before reaching the caveat.
 */

import { assessBenchmarkFitness, BENCHMARK_CANDIDATES } from "../core/benchmark-fitness";
import { runDevTestGraderBaseline } from "../core/dev-test-grader-baseline";
import { assessGraderIntegrity } from "../core/null-agent-baseline";
import { assessThreshold, SHIPPED_THRESHOLDS } from "../core/threshold-provenance";

export async function runDevEvidenceCommand(options: { json?: boolean }): Promise<void> {
	// P20.1b: the forgery baseline is now RUN, not passed as nulls — every vector is driven through the real
	// `classifyDevTestRun` grader. The null and random scores feed the null/random/real gap check; the full vector
	// sweep (which `assessGraderIntegrity` does not model) carries the honest result: state-tampering forges,
	// because the board's own counts are the grader's only source of truth. realAgent stays null — the discriminating
	// gap needs a real fleet run — so the verdict is legitimately `indeterminate` on discrimination, NOT void on null.
	const baseline = runDevTestGraderBaseline();
	const grader = assessGraderIntegrity({
		nullAgent: baseline.nullAgentScore,
		randomAgent: baseline.randomAgentScore,
		realAgent: null,
	});
	const thresholds = SHIPPED_THRESHOLDS.map(assessThreshold);
	const benchmarks = BENCHMARK_CANDIDATES.map(assessBenchmarkFitness);

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ grader, baseline, thresholds, benchmarks }, null, 2)}\n`);
		return;
	}

	process.stdout.write("GRADER INTEGRITY (P20.1) — read this before anything below\n");
	process.stdout.write(`  ${grader.verdict.toUpperCase()}: ${grader.reason}\n`);
	if (grader.allNumbersVoid) {
		process.stdout.write("  ⚠️ Until this resolves, treat every number in this report as unverified.\n");
	}
	process.stdout.write("  Forgery vector baseline (0 = grader gave no pass; 100 = grader forged a pass):\n");
	for (const vector of baseline.vectors) {
		process.stdout.write(`    ${vector.forged ? "⚠️ FORGED" : "✓ survives"} [${vector.score}] ${vector.id}\n`);
	}
	if (baseline.anyForged) {
		process.stdout.write(
			"  ⚠️ State-tampering forges a pass: `classifyDevTestRun` reads the board's own counts, so writing\n" +
				"     `completed` without doing the work reads as a completion. The board sits inside the trust\n" +
				"     boundary — the fix is independent acceptance evidence (P20.3), not a smarter count.\n",
		);
	}
	process.stdout.write("\n");

	const citable = thresholds.filter((threshold) => threshold.citableAsMeasured).length;
	process.stdout.write(`THRESHOLD PROVENANCE (P18.5) — ${citable}/${thresholds.length} citable as measured\n`);
	for (const threshold of thresholds) {
		process.stdout.write(`  ${threshold.declaration.id}: ${threshold.label}\n`);
	}
	process.stdout.write("\n");

	process.stdout.write("BENCHMARK FITNESS (P20.9)\n");
	for (const benchmark of benchmarks) {
		process.stdout.write(`  [${benchmark.verdict}] ${benchmark.id}\n`);
		for (const blocker of benchmark.blockers) {
			process.stdout.write(`      ✗ ${blocker}\n`);
		}
		for (const caveat of benchmark.caveats) {
			process.stdout.write(`      · ${caveat}\n`);
		}
	}

	process.stdout.write(
		"\nNothing here is a score. This reports whether our scores would MEAN anything — which is a different\n" +
			"question, and the one that has to be answered first.\n",
	);
}
