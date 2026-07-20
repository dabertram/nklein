/**
 * P20.10b — the CHURN COLLECTOR: turn git history into the observations `post-acceptance-churn.ts` judges.
 *
 * P20.10 established WHY churn matters: every other quality signal measures a moment, and P20.1 showed our own
 * grader cannot distinguish a real completion from a forged one because the board is inside the trust boundary.
 * **Churn is outside it** — it is written by the people who had to live with the result, and no state tampering
 * changes what a human later deleted.
 *
 * This is the gathering half. It is pure: git is an injected PORT, so the arithmetic is testable without a
 * repository, and the same logic works against a sandbox result branch or the main history.
 *
 * ── THE MEASUREMENT, AND WHY IT IS BLAME AND NOT DIFF ──
 * The obvious approach diffs the card's commit against a later ref and counts changed lines. That answers "how
 * much changed nearby", not "how much of what this card wrote is still here" — a later commit touching adjacent
 * lines inflates it, and a file rename destroys it entirely.
 *
 * Blame answers the actual question: for each line the card authored, is that line still attributed to the
 * card's commit at the later ref? Lines that are gone were deleted or rewritten; lines still attributed survived.
 *
 * ── WHAT THIS DELIBERATELY CANNOT SEE, stated because a churn number implies more precision than it has ──
 *  - **A moved line reads as churn.** Blame follows content within a file by default, not across a refactor that
 *    relocates it. So a tidy-up that relocates working code inflates churn, and this metric will call good
 *    housekeeping "rewritten".
 *  - **A reformat reads as churn.** A formatter pass rewrites attribution wholesale.
 * Both push the number UP, so a LOW churn figure is trustworthy while a HIGH one deserves a look before it is
 * believed. That asymmetry is worth knowing before anyone acts on a ranking.
 */

export interface AuthoredFile {
	readonly path: string;
	/** Lines this card authored in that file, at the card's own commit. */
	readonly authoredLines: number;
}

/** Injected git access. Returning null distinguishes "could not read" from "nothing survived". */
export interface ChurnGitPort {
	/**
	 * How many lines at `ref` are still attributed to `commit` in `path`.
	 * `null` when the file or ref cannot be read — the file may have been renamed or deleted.
	 */
	readonly countSurvivingLines: (input: {
		readonly path: string;
		readonly commit: string;
		readonly ref: string;
	}) => Promise<number | null>;
}

export interface CollectedChurn {
	readonly cardId: string;
	readonly authoredLines: number;
	readonly survivingLines: number;
	readonly churnedLines: number;
	/** Files whose survival could not be read — counted as FULLY churned, and named. */
	readonly unreadableFiles: readonly string[];
	readonly summary: string;
}

/**
 * Collect churn for one card at one point in time.
 *
 * An unreadable file counts as fully churned AND is named. Counting it as surviving would hide a deleted file —
 * the strongest possible churn signal — behind a read error; counting it silently would make the denominator
 * lie. Both halves are needed: the number stays honest and the reason stays visible.
 */
export async function collectChurnForCard(input: {
	readonly cardId: string;
	readonly commit: string;
	readonly laterRef: string;
	readonly files: readonly AuthoredFile[];
	readonly git: ChurnGitPort;
}): Promise<CollectedChurn> {
	let authoredLines = 0;
	let survivingLines = 0;
	const unreadableFiles: string[] = [];

	for (const file of input.files) {
		authoredLines += Math.max(0, file.authoredLines);
		const surviving = await input.git
			.countSurvivingLines({ path: file.path, commit: input.commit, ref: input.laterRef })
			.catch(() => null);
		if (surviving === null) {
			unreadableFiles.push(file.path);
			continue;
		}
		// Clamp: blame can attribute MORE lines than the card authored when a later commit re-indents around them
		// and git widens attribution. Letting survival exceed authorship would produce negative churn, which reads
		// as "the card added lines after the fact" — a nonsense a reader would rightly not believe.
		survivingLines += Math.min(Math.max(0, surviving), Math.max(0, file.authoredLines));
	}

	const churnedLines = Math.max(0, authoredLines - survivingLines);

	return {
		cardId: input.cardId,
		authoredLines,
		survivingLines,
		churnedLines,
		unreadableFiles,
		summary:
			authoredLines === 0
				? `${input.cardId}: no authored lines recorded — churn is UNMEASURED, which is not the same as zero`
				: `${input.cardId}: ${survivingLines}/${authoredLines} line(s) survive at ${input.laterRef} (${churnedLines} churned)${
						unreadableFiles.length > 0
							? `; ${unreadableFiles.length} file(s) unreadable and counted as fully churned: ${unreadableFiles.slice(0, 3).join(", ")}`
							: ""
					}`,
	};
}

/**
 * Build the `git blame` invocation for one file.
 *
 * Split out so the command layer stays a thin adapter and the argument shape is testable — a wrong flag here
 * silently changes what is being measured rather than erroring, which is the failure mode that would make every
 * churn number quietly wrong.
 */
export function buildBlameArgs(input: { readonly path: string; readonly ref: string }): readonly string[] {
	// --line-porcelain emits one attribution block per line, which is what makes counting per-commit lines
	// possible at all; `-w` ignores whitespace-only changes so a re-indent does not read as a rewrite.
	return ["blame", "--line-porcelain", "-w", input.ref, "--", input.path];
}

/** Count lines attributed to `commit` in `git blame --line-porcelain` output. */
export function countAttributedLines(porcelain: string, commit: string): number {
	if (commit.trim().length === 0) {
		return 0;
	}
	const prefix = commit.trim().toLowerCase();
	let count = 0;
	for (const line of porcelain.split("\n")) {
		// A porcelain block opens with "<sha> <origLine> <finalLine> [<count>]". Matching the SHA prefix supports
		// the short hashes a caller may hold without requiring them to resolve full ones first.
		const sha = /^([0-9a-f]{7,40})\s+\d+\s+\d+/.exec(line)?.[1];
		if (sha && sha.toLowerCase().startsWith(prefix)) {
			count += 1;
		}
	}
	return count;
}
