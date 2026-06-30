/**
 * Pure read-file coverage parsing extracted from nklein-context-focus-policy. Given the per-read
 * `inputSummary` strings a `read_files` ledger accumulates ("path:start-end, path:start-end, ..."),
 * compute, per path, the merged set of read line ranges and the next still-unread line. No SDK or
 * policy coupling — the input is widened to the one field actually read, so it stays decoupled from
 * the ledger entry shape.
 */

/** Split a `read_files` input summary ("a:1-10, b:5-9") into its trimmed, non-empty parts. */
export function splitReadInputSummary(summary: string): string[] {
	return summary
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

/**
 * Parse a single `path:start-end` coverage part. Returns null unless it has a non-empty path, a
 * `start-end` numeric range with `start > 0` and `end >= start` (so malformed/zero/inverted ranges
 * are dropped). The path is everything before the LAST colon (so `c:\file:1-10` keeps the drive).
 */
export function parseReadCoveragePart(part: string): { path: string; start: number; end: number } | null {
	const colonIndex = part.lastIndexOf(":");
	if (colonIndex <= 0) {
		return null;
	}
	const path = part.slice(0, colonIndex).trim();
	const range = part.slice(colonIndex + 1).trim();
	const match = /^(\d+)-(\d+)$/.exec(range);
	if (!path || !match?.[1] || !match[2]) {
		return null;
	}
	const start = Number.parseInt(match[1], 10);
	const end = Number.parseInt(match[2], 10);
	return Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start ? { path, start, end } : null;
}

export interface ReadCoverageByPath {
	path: string;
	ranges: Array<{ start: number; end: number }>;
	nextUnreadLine: number;
}

/**
 * Build per-path read coverage from a ledger of read summaries: collect every valid range, sort and
 * merge overlapping/adjacent ranges (gap of 1 line counts as adjacent), and compute `nextUnreadLine`
 * — the first line not covered by a contiguous run starting at line 1.
 */
export function buildReadCoverageByPath(ledger: readonly { inputSummary: string }[]): ReadCoverageByPath[] {
	const rangesByPath = new Map<string, Array<{ start: number; end: number }>>();
	for (const entry of ledger) {
		for (const part of splitReadInputSummary(entry.inputSummary)) {
			const parsed = parseReadCoveragePart(part);
			if (!parsed) {
				continue;
			}
			const ranges = rangesByPath.get(parsed.path) ?? [];
			ranges.push({ start: parsed.start, end: parsed.end });
			rangesByPath.set(parsed.path, ranges);
		}
	}
	return [...rangesByPath.entries()].map(([path, ranges]) => {
		const sortedRanges = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
		const mergedRanges: Array<{ start: number; end: number }> = [];
		for (const range of sortedRanges) {
			const previous = mergedRanges.at(-1);
			if (previous && range.start <= previous.end + 1) {
				previous.end = Math.max(previous.end, range.end);
				continue;
			}
			mergedRanges.push({ ...range });
		}
		let nextUnreadLine = 1;
		for (const range of mergedRanges) {
			if (range.start > nextUnreadLine) {
				break;
			}
			nextUnreadLine = Math.max(nextUnreadLine, range.end + 1);
		}
		return {
			path,
			ranges: mergedRanges,
			nextUnreadLine,
		};
	});
}
