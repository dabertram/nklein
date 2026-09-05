/**
 * Conflict hunks for the merge-resolution seed (live 2026-09-05, v31 s03: the FIRST merge-agent session that ever
 * ran spent its whole 30-minute budget DISCOVERING the conflict — `git show :2:…`, `cat`, spec greps — and never
 * wrote a file. The seed prompt listed only the conflicted PATHS. Handing the agent the marker regions up front,
 * with a little context, turns the task from "go find out what conflicts" into "here are the four decisions;
 * make them"). Pure text; the runner reads the mid-merge files from the sandbox and clamps the total budget.
 */

export interface ConflictHunk {
	/** 1-based line of the `<<<<<<<` marker. */
	readonly startLine: number;
	/** 1-based line of the `>>>>>>>` marker. */
	readonly endLine: number;
	/** The excerpt: `contextLines` before the opening marker through `contextLines` after the closing one. */
	readonly excerpt: string;
}

const OPENING = /^<{7}(\s|$)/u;
const SEPARATOR = /^={7}(\s|$)/u;
const CLOSING = /^>{7}(\s|$)/u;

/**
 * Extract every `<<<<<<< … ======= … >>>>>>>` region of a mid-merge file with `contextLines` of surrounding
 * context. Unterminated markers are ignored (the file is then not a clean git conflict state — the caller's
 * marker scan decides). Never throws.
 */
export function extractConflictHunks(content: string, contextLines = 6): ConflictHunk[] {
	const lines = content.split("\n");
	const hunks: ConflictHunk[] = [];
	let open: number | null = null;
	let sawSeparator = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (open === null) {
			if (OPENING.test(line)) {
				open = index;
				sawSeparator = false;
			}
			continue;
		}
		if (SEPARATOR.test(line)) {
			sawSeparator = true;
			continue;
		}
		if (CLOSING.test(line) && sawSeparator) {
			const from = Math.max(0, open - contextLines);
			const to = Math.min(lines.length - 1, index + contextLines);
			hunks.push({
				startLine: open + 1,
				endLine: index + 1,
				excerpt: lines
					.slice(from, to + 1)
					.map((text, offset) => `${String(from + offset + 1).padStart(4, " ")} | ${text}`)
					.join("\n"),
			});
			open = null;
			sawSeparator = false;
		}
	}
	return hunks;
}

export interface ConflictHunkDigest {
	/** One rendered block per file, in input order, clamped to the character budget. */
	readonly text: string;
	/** Files whose hunks were dropped (entirely) because the budget was exhausted. */
	readonly omittedPaths: readonly string[];
	readonly hunkCount: number;
}

/**
 * Render the hunks of every conflicted file into one prompt section under a character budget. Files are kept
 * whole and in order; the first file that does not fit is omitted along with everything after it (a partial hunk
 * misleads more than an honest "read this one yourself").
 */
export function renderConflictHunkDigest(
	files: readonly { path: string; content: string }[],
	options: { budgetChars?: number; contextLines?: number } = {},
): ConflictHunkDigest {
	const budget = options.budgetChars ?? 24_000;
	const blocks: string[] = [];
	const omittedPaths: string[] = [];
	let used = 0;
	let hunkCount = 0;
	let exhausted = false;
	for (const file of files) {
		if (exhausted) {
			omittedPaths.push(file.path);
			continue;
		}
		const hunks = extractConflictHunks(file.content, options.contextLines);
		if (hunks.length === 0) {
			continue;
		}
		const block = [
			`### ${file.path} — ${hunks.length} conflict${hunks.length === 1 ? "" : "s"}`,
			...hunks.map((hunk) => `(lines ${hunk.startLine}–${hunk.endLine})\n${hunk.excerpt}`),
		].join("\n\n");
		if (used + block.length > budget) {
			exhausted = true;
			omittedPaths.push(file.path);
			continue;
		}
		blocks.push(block);
		used += block.length;
		hunkCount += hunks.length;
	}
	return { text: blocks.join("\n\n"), omittedPaths, hunkCount };
}
