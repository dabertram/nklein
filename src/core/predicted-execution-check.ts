/**
 * Predict-then-execute verification (F12.96) — PURE comparison core.
 *
 * LLMs routinely "hallucinate" that buggy code is correct while mentally tracing it — concrete execution catches a
 * categorically different bug class. The pattern: before accepting, the worker PREDICTS the output for key inputs,
 * the sandbox RUNS them for real, and a mismatch blocks acceptance and localizes the bug. This core is the
 * comparator + verdict: tolerant normalization (whitespace/trailing-newline/CRLF noise must not fail a correct
 * program) but strict on content. The caller owns eliciting predictions and executing; this only compares.
 */

export interface PredictedExecutionCase {
	/** Label for the check (e.g. the command or input). */
	readonly label: string;
	readonly predicted: string;
	readonly actual: string;
}

export interface CaseComparison {
	readonly label: string;
	readonly matched: boolean;
	/** First line number (1-based, post-normalization) where they diverge; null when matched. */
	readonly firstDivergentLine: number | null;
	/** Compact predicted-vs-actual excerpt at the divergence; empty when matched. */
	readonly divergence: string;
}

export interface PredictedExecutionVerdict {
	readonly cases: readonly CaseComparison[];
	readonly matchedCount: number;
	readonly mismatchedCount: number;
	/** True when every case matched — the prediction survived contact with reality. */
	readonly pass: boolean;
	readonly reason: string;
}

/** Normalize output for comparison: CRLF→LF, strip trailing whitespace per line, drop trailing blank lines. */
function normalizeOutput(text: string): string[] {
	const lines = text
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((line) => line.replace(/\s+$/, ""));
	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}

/** Compare one predicted-vs-actual pair with tolerant normalization. */
export function comparePredictedExecution(item: PredictedExecutionCase): CaseComparison {
	const predicted = normalizeOutput(item.predicted);
	const actual = normalizeOutput(item.actual);
	const maxLines = Math.max(predicted.length, actual.length);
	for (let i = 0; i < maxLines; i++) {
		if ((predicted[i] ?? "<absent>") !== (actual[i] ?? "<absent>")) {
			return {
				label: item.label,
				matched: false,
				firstDivergentLine: i + 1,
				divergence: `line ${i + 1}: predicted ${JSON.stringify(predicted[i] ?? "<absent>")} vs actual ${JSON.stringify(actual[i] ?? "<absent>")}`,
			};
		}
	}
	return { label: item.label, matched: true, firstDivergentLine: null, divergence: "" };
}

/**
 * Verdict over all prediction cases. Pass requires EVERY case to match — a single divergence means the model's
 * mental trace of its own code is wrong somewhere, which is exactly the acceptance-blocking signal. The per-case
 * divergences localize the bug for a targeted repair prompt. Zero cases ⇒ pass-with-note (nothing was predicted;
 * the caller decides whether to require predictions for this card class).
 */
export function assessPredictedExecution(cases: readonly PredictedExecutionCase[]): PredictedExecutionVerdict {
	const comparisons = cases.map(comparePredictedExecution);
	const matchedCount = comparisons.filter((comparison) => comparison.matched).length;
	const mismatchedCount = comparisons.length - matchedCount;
	if (comparisons.length === 0) {
		return {
			cases: comparisons,
			matchedCount,
			mismatchedCount,
			pass: true,
			reason: "no prediction cases supplied — nothing to falsify (caller decides whether predictions are required).",
		};
	}
	if (mismatchedCount === 0) {
		return {
			cases: comparisons,
			matchedCount,
			mismatchedCount,
			pass: true,
			reason: `all ${matchedCount} predicted output(s) matched real execution.`,
		};
	}
	const firstMiss = comparisons.find((comparison) => !comparison.matched);
	return {
		cases: comparisons,
		matchedCount,
		mismatchedCount,
		pass: false,
		reason: `${mismatchedCount}/${comparisons.length} prediction(s) diverged from real execution — the mental trace is wrong. First: [${firstMiss?.label}] ${firstMiss?.divergence}`,
	};
}
