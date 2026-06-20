/**
 * Lenient fuzzy search/replace editing for small/quantized local models.
 *
 * Research across aider, Roo Code, and Cline shows the single biggest failure mode for weak/local models is
 * the *exact-match* edit: the model emits a search block that is almost-but-not-quite the file text (a stray
 * space, dropped indentation, an elided middle, a one-token paraphrase) and a strict applier rejects it,
 * sending the model into a re-read/retry loop. Whole-file rewrites avoid this but are too token-expensive for
 * small context windows. The robust middle ground — used by aider's `editblock` coder — is a *fallback ladder*
 * that tries progressively more tolerant matches:
 *
 *   1. exact            — perfect contiguous line match
 *   2. whitespace       — match ignoring uniform indentation, re-indent the replacement to the file
 *   3. leading_blank    — tolerate leading blank lines the model added to the search block
 *   4. dotdotdots       — honor `...` elision markers, applying each non-elided segment in order
 *   5. fuzzy            — closest window by similarity ratio (≥0.8) within ±10% of the search length
 *
 * This module is the pure, unit-tested algorithm; the `edit_file` tool wires it to file IO and the existing
 * write guards. It is deliberately !Klein-owned (not an SDK patch) so it can be routed to small models.
 */

export interface SearchReplaceBlock {
	search: string;
	replace: string;
}

export type FuzzyEditStrategy = "exact" | "whitespace" | "leading_blank" | "dotdotdots" | "fuzzy";

export interface ApplySearchReplaceResult {
	ok: boolean;
	content?: string;
	strategy?: FuzzyEditStrategy;
	/** Similarity ratio of the chosen match, for the fuzzy strategy. */
	similarity?: number;
	reason?: string;
	/** Best similarity found when the match failed, to help the model correct its search block. */
	bestSimilarity?: number;
}

/** Default minimum similarity for the fuzzy fallback, matching aider's 0.8 threshold. */
const FUZZY_MATCH_THRESHOLD = 0.8;
/** Skip the O(n·m) fuzzy pass on very large files / blocks to keep editing cheap. */
const MAX_FUZZY_CONTENT_CHARS = 200_000;

function splitKeepNewlines(text: string): string[] {
	if (text === "") {
		return [];
	}
	return text.split(/(?<=\n)/);
}

function leadingWhitespace(line: string): string {
	return line.match(/^[ \t]*/)?.[0] ?? "";
}

function isBlank(line: string): boolean {
	return line.trim() === "";
}

function perfectReplace(whole: string[], part: string[], replace: string[]): string[] | null {
	if (part.length === 0) {
		return null;
	}
	for (let i = 0; i + part.length <= whole.length; i += 1) {
		let matched = true;
		for (let j = 0; j < part.length; j += 1) {
			if (whole[i + j] !== part[j]) {
				matched = false;
				break;
			}
		}
		if (matched) {
			return [...whole.slice(0, i), ...replace, ...whole.slice(i + part.length)];
		}
	}
	return null;
}

/**
 * Matches when the search block's lines equal the file's lines after trimming, then re-indents the
 * replacement by the indentation delta of the matched region so the result keeps the file's real indentation.
 */
function whitespaceFlexibleReplace(whole: string[], part: string[], replace: string[]): string[] | null {
	if (part.length === 0) {
		return null;
	}
	const firstNonBlank = part.findIndex((line) => !isBlank(line));
	for (let i = 0; i + part.length <= whole.length; i += 1) {
		let matched = true;
		for (let j = 0; j < part.length; j += 1) {
			if (whole[i + j].trim() !== part[j].trim()) {
				matched = false;
				break;
			}
		}
		if (!matched) {
			continue;
		}
		let reindented = replace;
		if (firstNonBlank >= 0) {
			const fileIndent = leadingWhitespace(whole[i + firstNonBlank]);
			const partIndent = leadingWhitespace(part[firstNonBlank]);
			if (fileIndent !== partIndent) {
				reindented = replace.map((line) => {
					if (isBlank(line)) {
						return line;
					}
					const current = leadingWhitespace(line);
					const withoutPartIndent = current.startsWith(partIndent) ? current.slice(partIndent.length) : current;
					return `${fileIndent}${withoutPartIndent}${line.slice(current.length)}`;
				});
			}
		}
		return [...whole.slice(0, i), ...reindented, ...whole.slice(i + part.length)];
	}
	return null;
}

function stripLeadingBlankLines(lines: string[]): string[] {
	let start = 0;
	while (start < lines.length && isBlank(lines[start])) {
		start += 1;
	}
	return lines.slice(start);
}

const DOTDOTDOTS = /^\s*\.\.\.\s*$/;

/**
 * Honors `...` elision: the search/replace blocks are split on `...` lines and each concrete segment is
 * applied in order. Requires the same number of `...` markers in both blocks.
 */
function dotdotdotsReplace(content: string, search: string, replace: string): string | null {
	const searchLines = splitKeepNewlines(search);
	const replaceLines = splitKeepNewlines(replace);
	if (!searchLines.some((line) => DOTDOTDOTS.test(line))) {
		return null;
	}
	const splitSegments = (lines: string[]): string[][] => {
		const segments: string[][] = [[]];
		for (const line of lines) {
			if (DOTDOTDOTS.test(line)) {
				segments.push([]);
			} else {
				segments[segments.length - 1].push(line);
			}
		}
		return segments;
	};
	const searchSegments = splitSegments(searchLines);
	const replaceSegments = splitSegments(replaceLines);
	if (searchSegments.length !== replaceSegments.length) {
		return null;
	}
	let current = content;
	for (let index = 0; index < searchSegments.length; index += 1) {
		const segSearch = searchSegments[index].join("");
		const segReplace = replaceSegments[index].join("");
		if (segSearch.trim() === "") {
			continue;
		}
		const occurrences = current.split(segSearch).length - 1;
		if (occurrences !== 1) {
			return null;
		}
		current = current.replace(segSearch, () => segReplace);
	}
	return current;
}

/** Character-level Levenshtein similarity ratio in [0,1]; 1 means identical. */
export function similarityRatio(a: string, b: string): number {
	if (a === b) {
		return 1;
	}
	if (a.length === 0 || b.length === 0) {
		return 0;
	}
	const rows = a.length + 1;
	const cols = b.length + 1;
	let previous = new Array<number>(cols);
	let currentRow = new Array<number>(cols);
	for (let j = 0; j < cols; j += 1) {
		previous[j] = j;
	}
	for (let i = 1; i < rows; i += 1) {
		currentRow[0] = i;
		for (let j = 1; j < cols; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			currentRow[j] = Math.min(previous[j] + 1, currentRow[j - 1] + 1, previous[j - 1] + cost);
		}
		[previous, currentRow] = [currentRow, previous];
	}
	const distance = previous[cols - 1];
	return 1 - distance / Math.max(a.length, b.length);
}

function fuzzyReplace(
	whole: string[],
	part: string[],
	replace: string[],
	threshold: number,
): { lines: string[]; similarity: number } | { lines: null; similarity: number } {
	if (part.length === 0) {
		return { lines: null, similarity: 0 };
	}
	const partText = part.join("");
	const minLen = Math.max(1, Math.floor(part.length * 0.9));
	const maxLen = Math.ceil(part.length * 1.1);
	let bestSimilarity = 0;
	let bestStart = -1;
	let bestLen = part.length;
	for (let windowLen = minLen; windowLen <= maxLen; windowLen += 1) {
		for (let i = 0; i + windowLen <= whole.length; i += 1) {
			const windowText = whole.slice(i, i + windowLen).join("");
			const ratio = similarityRatio(windowText, partText);
			if (ratio > bestSimilarity) {
				bestSimilarity = ratio;
				bestStart = i;
				bestLen = windowLen;
			}
		}
	}
	if (bestStart >= 0 && bestSimilarity >= threshold) {
		return {
			lines: [...whole.slice(0, bestStart), ...replace, ...whole.slice(bestStart + bestLen)],
			similarity: bestSimilarity,
		};
	}
	return { lines: null, similarity: bestSimilarity };
}

export function applySearchReplaceBlock(
	content: string,
	search: string,
	replace: string,
	options: { fuzzyThreshold?: number } = {},
): ApplySearchReplaceResult {
	// Empty search block means "insert"/"create": append for an existing file, set for an empty one.
	if (search === "") {
		return { ok: true, content: content === "" ? replace : `${content}${replace}`, strategy: "exact" };
	}

	const whole = splitKeepNewlines(content);
	const part = splitKeepNewlines(search);
	const replaceLines = splitKeepNewlines(replace);

	const exact = perfectReplace(whole, part, replaceLines);
	if (exact) {
		return { ok: true, content: exact.join(""), strategy: "exact" };
	}

	const whitespace = whitespaceFlexibleReplace(whole, part, replaceLines);
	if (whitespace) {
		return { ok: true, content: whitespace.join(""), strategy: "whitespace" };
	}

	const trimmedPart = stripLeadingBlankLines(part);
	if (trimmedPart.length !== part.length && trimmedPart.length > 0) {
		const exactTrimmed = perfectReplace(whole, trimmedPart, replaceLines);
		if (exactTrimmed) {
			return { ok: true, content: exactTrimmed.join(""), strategy: "leading_blank" };
		}
		const whitespaceTrimmed = whitespaceFlexibleReplace(whole, trimmedPart, replaceLines);
		if (whitespaceTrimmed) {
			return { ok: true, content: whitespaceTrimmed.join(""), strategy: "leading_blank" };
		}
	}

	const dotdotdots = dotdotdotsReplace(content, search, replace);
	if (dotdotdots !== null) {
		return { ok: true, content: dotdotdots, strategy: "dotdotdots" };
	}

	if (content.length <= MAX_FUZZY_CONTENT_CHARS) {
		const threshold = options.fuzzyThreshold ?? FUZZY_MATCH_THRESHOLD;
		const fuzzy = fuzzyReplace(whole, part, replaceLines, threshold);
		if (fuzzy.lines) {
			return { ok: true, content: fuzzy.lines.join(""), strategy: "fuzzy", similarity: fuzzy.similarity };
		}
		return {
			ok: false,
			reason:
				"Search block did not match the file. Re-read the exact current text (including indentation) and copy it verbatim into the search block, or include enough surrounding context to make it unique.",
			bestSimilarity: fuzzy.similarity,
		};
	}

	return {
		ok: false,
		reason:
			"Search block did not match the file. Re-read the exact current text and copy it verbatim into the search block.",
	};
}

export interface ApplySearchReplaceBlocksResult {
	ok: boolean;
	content: string;
	appliedStrategies: FuzzyEditStrategy[];
	failedBlockIndex?: number;
	reason?: string;
	bestSimilarity?: number;
}

export function applySearchReplaceBlocks(
	content: string,
	blocks: readonly SearchReplaceBlock[],
	options: { fuzzyThreshold?: number } = {},
): ApplySearchReplaceBlocksResult {
	let current = content;
	const appliedStrategies: FuzzyEditStrategy[] = [];
	for (let index = 0; index < blocks.length; index += 1) {
		const result = applySearchReplaceBlock(current, blocks[index].search, blocks[index].replace, options);
		if (!result.ok || result.content === undefined) {
			return {
				ok: false,
				content,
				appliedStrategies,
				failedBlockIndex: index,
				reason: result.reason,
				bestSimilarity: result.bestSimilarity,
			};
		}
		current = result.content;
		if (result.strategy) {
			appliedStrategies.push(result.strategy);
		}
	}
	return { ok: true, content: current, appliedStrategies };
}
