/**
 * Diff-minimality metrics (F12.45 slice) — PURE core.
 *
 * Agents edit already-correct code 35–65% of the time and submit unnecessary changes at ~2× human churn — and this
 * over-eagerness is INVISIBLE while "tests pass" is the only signal. This core scores a delivered unified diff on
 * minimality: size, file spread, and — the sharpest over-eagerness signal — files touched OUTSIDE the card's declared
 * scope (`filesLikelyTouched`). Pure/total: the caller supplies the patch text + the expected scope; verdicts are
 * advisory for the delivery gate / reviewer prompt / trajectory metrics.
 */

export interface DiffMinimalityInput {
	/** The delivered unified diff (git patch text). */
	readonly patch: string;
	/** The card's declared scope (filesLikelyTouched); empty/omitted ⇒ scope checking is skipped. */
	readonly expectedScopeFiles?: readonly string[];
	/** Lines-changed budget for a "minimal" verdict. Default 120. */
	readonly minimalLineBudget?: number;
	/** Files-touched budget for a "minimal" verdict. Default 4. */
	readonly minimalFileBudget?: number;
}

export type DiffMinimalityVerdict = "empty" | "minimal" | "acceptable" | "bloated";

export interface DiffMinimalityAssessment {
	readonly filesTouched: readonly string[];
	readonly linesAdded: number;
	readonly linesRemoved: number;
	/** Total changed lines (added + removed) — the churn measure. */
	readonly linesChanged: number;
	/** Touched files NOT in the declared scope (the over-eagerness signal); empty when scope was not declared. */
	readonly outOfScopeFiles: readonly string[];
	readonly verdict: DiffMinimalityVerdict;
	readonly reason: string;
}

const FILE_HEADER = /^\+\+\+ b\/(.+)$/;

/** Normalize a scope entry for comparison (strip leading ./ and slashes). */
function normalizePath(path: string): string {
	return path.replace(/^\.?\//, "");
}

/**
 * Assess a delivered diff's minimality. Verdicts, cheapest-first: no changes ⇒ `empty` (a valid abstention — the
 * caller decides if doing nothing was correct); within both budgets AND fully in-scope ⇒ `minimal`; out-of-scope
 * files OR >2× a budget ⇒ `bloated`; otherwise `acceptable`.
 */
export function assessDiffMinimality(input: DiffMinimalityInput): DiffMinimalityAssessment {
	const minimalLineBudget = input.minimalLineBudget ?? 120;
	const minimalFileBudget = input.minimalFileBudget ?? 4;
	const files: string[] = [];
	let linesAdded = 0;
	let linesRemoved = 0;
	for (const line of input.patch.split("\n")) {
		const header = FILE_HEADER.exec(line);
		if (header?.[1]) {
			files.push(normalizePath(header[1]));
			continue;
		}
		if (line.startsWith("+") && !line.startsWith("+++")) {
			linesAdded++;
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			linesRemoved++;
		}
	}
	const linesChanged = linesAdded + linesRemoved;
	const scope = (input.expectedScopeFiles ?? []).map(normalizePath);
	const outOfScopeFiles =
		scope.length === 0
			? []
			: files.filter((file) => !scope.some((expected) => file === expected || file.endsWith(`/${expected}`)));

	if (linesChanged === 0) {
		return {
			filesTouched: files,
			linesAdded,
			linesRemoved,
			linesChanged,
			outOfScopeFiles,
			verdict: "empty",
			reason:
				"no changes — a valid abstention IF the task was already satisfied; verify against the acceptance check.",
		};
	}
	const overLine = linesChanged > minimalLineBudget;
	const overFile = files.length > minimalFileBudget;
	const badlyOver = linesChanged > minimalLineBudget * 2 || files.length > minimalFileBudget * 2;
	if (outOfScopeFiles.length > 0 || badlyOver) {
		const scopePart =
			outOfScopeFiles.length > 0
				? `${outOfScopeFiles.length} file(s) outside the declared scope (${outOfScopeFiles.slice(0, 3).join(", ")})`
				: "";
		const sizePart = badlyOver ? `${linesChanged} changed lines across ${files.length} files (>2× budget)` : "";
		return {
			filesTouched: files,
			linesAdded,
			linesRemoved,
			linesChanged,
			outOfScopeFiles,
			verdict: "bloated",
			reason: `over-eager diff: ${[scopePart, sizePart].filter(Boolean).join("; ")} — trim to the task's scope.`,
		};
	}
	if (!overLine && !overFile) {
		return {
			filesTouched: files,
			linesAdded,
			linesRemoved,
			linesChanged,
			outOfScopeFiles,
			verdict: "minimal",
			reason: `${linesChanged} changed lines across ${files.length} file(s), all in scope.`,
		};
	}
	return {
		filesTouched: files,
		linesAdded,
		linesRemoved,
		linesChanged,
		outOfScopeFiles,
		verdict: "acceptable",
		reason: `${linesChanged} changed lines across ${files.length} file(s) — above the minimal budget but within 2×.`,
	};
}
