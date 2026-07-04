/**
 * §5.AK N-candidate patch parser (pure) — turn a narrow model's "here are N patches" output into DISCRETE,
 * well-formed unified-diff candidates, rejecting malformed / empty / out-of-scope ones BEFORE they reach the
 * validator (which runs the expensive gates). The generator prompt asks for unified diffs; models emit them fenced
 * (```diff … ```), separated by `diff --git` headers, or as a single bare diff — this handles all three.
 *
 * A candidate is KEPT only when it carries real diff content (a `@@` hunk header, or `+++`/`---` file headers with at
 * least one added/removed line). Everything else is rejected WITH A REASON (empty, no-hunk/prose, or — when
 * `allowedPathPrefixes` is given — a path outside the task's scope), so the caller can log why a candidate was dropped
 * rather than silently losing it. Pure + deterministic.
 */

export interface DiffCandidate {
	/** The raw unified-diff text (trimmed). */
	diff: string;
	/** File paths the diff touches (from the `+++ b/…` / `diff --git` headers), `b/`/`a/` prefixes stripped. */
	touchedPaths: string[];
}

export interface RejectedDiff {
	/** The raw block that was rejected (trimmed, capped for logging). */
	raw: string;
	reason: "empty" | "no_diff_content" | "out_of_scope";
}

export interface ParsedPatchCandidates {
	candidates: DiffCandidate[];
	rejected: RejectedDiff[];
}

export interface ParsePatchCandidatesOptions {
	/** When set, a candidate touching any path NOT under one of these prefixes is rejected as out-of-scope. */
	allowedPathPrefixes?: readonly string[];
}

const FENCED_DIFF = /```(?:diff|patch)?\s*\n([\s\S]*?)```/gu;

/** Split raw model output into candidate diff blocks (fenced blocks, else `diff --git` segments, else the whole text). */
function splitIntoBlocks(modelOutput: string): string[] {
	const fenced: string[] = [];
	for (const match of modelOutput.matchAll(FENCED_DIFF)) {
		const body = match[1]?.trim();
		if (body) {
			fenced.push(body);
		}
	}
	if (fenced.length > 0) {
		return fenced;
	}
	const trimmed = modelOutput.trim();
	if (trimmed.includes("diff --git ")) {
		// Split on each `diff --git` header (keep the header with its block).
		return trimmed
			.split(/(?=^diff --git )/mu)
			.map((block) => block.trim())
			.filter((block) => block.length > 0);
	}
	return trimmed.length > 0 ? [trimmed] : [];
}

/** True when the block carries actual diff content (a hunk header, or file headers with an added/removed line). */
function hasDiffContent(block: string): boolean {
	if (/^@@[^\n]*@@/mu.test(block)) {
		return true;
	}
	const hasFileHeaders = /^\+\+\+ /mu.test(block) && /^--- /mu.test(block);
	const hasChangeLine = /^[+-](?![+-][+-])/mu.test(block); // a +/- line that isn't the +++/--- header
	return hasFileHeaders && hasChangeLine;
}

/** Extract the touched file paths from a diff block (prefer `+++ b/…`, fall back to `diff --git a/… b/…`). */
function extractTouchedPaths(block: string): string[] {
	const paths = new Set<string>();
	for (const match of block.matchAll(/^\+\+\+ (?:b\/)?(.+)$/gmu)) {
		const path = match[1]?.trim();
		if (path && path !== "/dev/null") {
			paths.add(path);
		}
	}
	if (paths.size === 0) {
		for (const match of block.matchAll(/^diff --git a\/(\S+) b\/(\S+)/gmu)) {
			const path = match[2]?.trim();
			if (path) {
				paths.add(path);
			}
		}
	}
	return [...paths];
}

function isWithinScope(paths: readonly string[], allowedPrefixes: readonly string[]): boolean {
	if (paths.length === 0) {
		return false; // can't confirm scope with no parseable path → reject rather than admit a blind diff
	}
	return paths.every((path) => allowedPrefixes.some((prefix) => path === prefix || path.startsWith(prefix)));
}

/** Parse a model's N-patch output into discrete, well-formed diff candidates + a rejected list (with reasons). Pure. */
export function parseNPatchCandidates(
	modelOutput: string,
	options: ParsePatchCandidatesOptions = {},
): ParsedPatchCandidates {
	const candidates: DiffCandidate[] = [];
	const rejected: RejectedDiff[] = [];
	const seen = new Set<string>();
	for (const block of splitIntoBlocks(modelOutput)) {
		const capped = block.length > 4000 ? `${block.slice(0, 4000)}…` : block;
		if (block.length === 0) {
			rejected.push({ raw: capped, reason: "empty" });
			continue;
		}
		if (!hasDiffContent(block)) {
			rejected.push({ raw: capped, reason: "no_diff_content" });
			continue;
		}
		const touchedPaths = extractTouchedPaths(block);
		if (options.allowedPathPrefixes && !isWithinScope(touchedPaths, options.allowedPathPrefixes)) {
			rejected.push({ raw: capped, reason: "out_of_scope" });
			continue;
		}
		if (seen.has(block)) {
			continue; // identical duplicate candidate — keep one
		}
		seen.add(block);
		candidates.push({ diff: block, touchedPaths });
	}
	return { candidates, rejected };
}
