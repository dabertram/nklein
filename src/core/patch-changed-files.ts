/**
 * Which files a unified diff touches.
 *
 * Extracted from `listGradedTestFiles` (SWE-bench tamper detection) because the P20.3b delivery seam needs the
 * same answer about a card's result-branch diff. Two implementations of "which files does this patch change"
 * would drift, and they fail in opposite directions: the grader would miss a tampered file while the scheduler
 * skipped an ablation it should have run.
 *
 * ── WHY `diff --git`, NOT `+++` ──
 * The `+++` line is `/dev/null` for a DELETION, so a parser reading it silently drops every deleted file. For
 * the grader that means a tamper it cannot see; for the scheduler it means a module that vanished still counted
 * as unchanged. The `diff --git a/X b/X` header names both sides on every hunk kind, so it is the one line that
 * is always present and always complete.
 */

/** Files the patch touches, de-duplicated and sorted. Empty for an empty or unparseable patch. */
export function changedFilesFromPatch(patch: string): string[] {
	const files = new Set<string>();
	for (const line of patch.split("\n")) {
		// The `b/` side is the post-change path: for a rename it is the NEW name, which is the one that exists
		// afterwards and therefore the one a later lookup can resolve.
		const match = line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
		if (match?.[2]) {
			files.add(match[2]);
		}
	}
	return [...files].sort();
}
