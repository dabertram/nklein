/**
 * Quality budget (pure) — ported from opencode-swarm's quality_budget gate, reduced to the signals computable from a
 * card's DIFF alone (no AST / tokenizer dependency, so it stays pure + language-agnostic). It enforces three ceilings a
 * runaway or sloppy change tends to breach, each mapped to a delivery-gate violation:
 *
 *   - `file_too_large`     — a single file's added-line count exceeds the per-file budget (an unreviewable mega-diff).
 *   - `insufficient_tests` — source changed but the test-to-source added-line ratio is below the floor (untested code).
 *   - `excess_duplication` — too many of the added non-trivial lines are exact duplicates of other added lines
 *                            (copy-paste instead of extraction).
 *
 * PROPOSE/HOLD signal only — the effectful b-leaf maps a non-empty `violations` to a boundary-style hold, consistent
 * with the placeholder scanner. The caller supplies each file's added lines (typically parsed from the unified diff).
 */

export interface QualityBudgetFile {
	readonly path: string;
	/** The lines ADDED by this card for this file (diff `+` lines, without the leading `+`). */
	readonly addedLines: readonly string[];
	/** Whether this file is a test file. Omitted ⇒ derived from the path (`.test.`/`.spec.`/`/test(s)/`/`__tests__`). */
	readonly isTest?: boolean;
}

export interface QualityBudgetConfig {
	/** Max added lines in any single non-test file (default 400). */
	readonly maxFileAddedLines: number;
	/** Minimum test-added ÷ source-added ratio when source changed (default 0.25). Set 0 to disable. */
	readonly minTestRatio: number;
	/** Max fraction of added non-trivial source lines that may be exact duplicates of each other (default 0.30). */
	readonly maxDuplicationRatio: number;
}

export const DEFAULT_QUALITY_BUDGET_CONFIG: QualityBudgetConfig = {
	maxFileAddedLines: 400,
	minTestRatio: 0.25,
	maxDuplicationRatio: 0.3,
};

export type QualityViolationKind = "file_too_large" | "insufficient_tests" | "excess_duplication";

export interface QualityViolation {
	readonly kind: QualityViolationKind;
	readonly detail: string;
	/** The file the violation is anchored to, or null for whole-change violations (test ratio). */
	readonly path: string | null;
}

export interface QualityBudgetMetrics {
	readonly sourceAddedLines: number;
	readonly testAddedLines: number;
	readonly testRatio: number;
	readonly maxFileAddedLines: number;
	readonly duplicationRatio: number;
}

export interface QualityBudgetResult {
	readonly withinBudget: boolean;
	readonly violations: readonly QualityViolation[];
	readonly metrics: QualityBudgetMetrics;
}

const TEST_PATH = /(\.test\.|\.spec\.|\/tests?\/|__tests__\/)/i;

function isTestFile(file: QualityBudgetFile): boolean {
	return file.isTest ?? TEST_PATH.test(file.path);
}

/** A line worth counting for duplication: non-blank and not a lone bracket/punctuation (those repeat legitimately). */
function isNonTrivial(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length < 4) {
		return false;
	}
	return !/^[{}()[\];,]+$/.test(trimmed);
}

/** Fraction of non-trivial added source lines that are exact duplicates of another such line (0 when none/too few). */
function duplicationRatio(sourceAddedLines: readonly string[]): number {
	const nonTrivial = sourceAddedLines.map((line) => line.trim()).filter((line) => isNonTrivial(line));
	if (nonTrivial.length < 2) {
		return 0;
	}
	const counts = new Map<string, number>();
	for (const line of nonTrivial) {
		counts.set(line, (counts.get(line) ?? 0) + 1);
	}
	let duplicated = 0;
	for (const count of counts.values()) {
		if (count > 1) {
			// Every occurrence beyond the first is a duplicate line.
			duplicated += count - 1;
		}
	}
	return duplicated / nonTrivial.length;
}

export function assessQualityBudget(
	files: readonly QualityBudgetFile[],
	config: QualityBudgetConfig = DEFAULT_QUALITY_BUDGET_CONFIG,
): QualityBudgetResult {
	const violations: QualityViolation[] = [];
	let sourceAddedLines = 0;
	let testAddedLines = 0;
	let maxFileAddedLines = 0;
	const sourceLines: string[] = [];

	for (const file of files) {
		const added = file.addedLines.length;
		if (isTestFile(file)) {
			testAddedLines += added;
			continue;
		}
		sourceAddedLines += added;
		sourceLines.push(...file.addedLines);
		maxFileAddedLines = Math.max(maxFileAddedLines, added);
		if (added > config.maxFileAddedLines) {
			violations.push({
				kind: "file_too_large",
				path: file.path,
				detail: `${added} added lines exceeds the per-file budget of ${config.maxFileAddedLines}.`,
			});
		}
	}

	const testRatio = sourceAddedLines === 0 ? 0 : testAddedLines / sourceAddedLines;
	if (config.minTestRatio > 0 && sourceAddedLines > 0 && testRatio < config.minTestRatio) {
		violations.push({
			kind: "insufficient_tests",
			path: null,
			detail: `test/source added-line ratio ${testRatio.toFixed(2)} is below the ${config.minTestRatio} floor (${testAddedLines} test / ${sourceAddedLines} source lines).`,
		});
	}

	const dupRatio = duplicationRatio(sourceLines);
	if (dupRatio > config.maxDuplicationRatio) {
		violations.push({
			kind: "excess_duplication",
			path: null,
			detail: `${(dupRatio * 100).toFixed(0)}% of added source lines are exact duplicates (max ${(config.maxDuplicationRatio * 100).toFixed(0)}%).`,
		});
	}

	return {
		withinBudget: violations.length === 0,
		violations,
		metrics: {
			sourceAddedLines,
			testAddedLines,
			testRatio,
			maxFileAddedLines,
			duplicationRatio: dupRatio,
		},
	};
}
