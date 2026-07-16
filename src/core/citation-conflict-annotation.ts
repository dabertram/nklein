/**
 * F4.5 — annotate a rendered synthesis with the resolved source conflicts.
 *
 * The pipeline is: extract keyed claims from the model's cited answer → {@link detectClaimConflicts} groups them into
 * conflict clusters → {@link resolveClaimConflictsByAuthorityBatch} decides each (winner + retained minority, or
 * unresolved). This core is the LAST rendering step: it turns those resolutions into an operator-facing "Source-conflict
 * notes" block appended to the answer, so the synthesis SHOWS which claims disagreed and how they were resolved —
 * prefer-winner, retain-minority, or mark-unresolved — instead of silently picking one value. Pure + deterministic.
 *
 * (Claim EXTRACTION from the free-text answer is the remaining model-side seam; this core takes already-detected clusters
 * + their resolutions, so it is fully unit-testable without a model.)
 */

import type { ClaimConflictResolution } from "./citation-conflict-authority.js";
import type { ClaimConflictCluster } from "./citation-conflict-detection.js";

/** One conflict cluster paired with its authority resolution (index-aligned outputs of detect + resolve). */
export interface AnnotatedConflict {
	readonly cluster: ClaimConflictCluster;
	readonly resolution: ClaimConflictResolution;
}

const SECTION_HEADING = "## Source-conflict notes";

/** The value a given source asserted for a cluster's claim key, or null when that source isn't in the cluster. */
function valueForSource(cluster: ClaimConflictCluster, sourceId: string | null): string | null {
	if (sourceId === null) {
		return null;
	}
	return cluster.claims.find((claim) => claim.sourceId === sourceId)?.value ?? null;
}

/** Render one conflict's note line: the resolved winner + retained minority, or an explicit unresolved warning. */
function renderConflictNote(entry: AnnotatedConflict): string {
	const { cluster, resolution } = entry;
	if (resolution.unresolved || resolution.winnerId === null) {
		const views = cluster.claims.map((claim) => `${claim.value} (${claim.sourceId})`).join(" · ");
		return `- **${cluster.claimKey}**: UNRESOLVED — sources disagree with no clear authority: ${views}. Verify before relying on it.`;
	}
	const winnerValue = valueForSource(cluster, resolution.winnerId) ?? "(unknown)";
	const minority = resolution.supersededIds
		.map((id) => {
			const value = valueForSource(cluster, id);
			return value ? `${value} (${id})` : id;
		})
		.join(" · ");
	const minorityNote = minority.length > 0 ? ` Superseded: ${minority}.` : "";
	return `- **${cluster.claimKey}**: using **${winnerValue}** (from ${resolution.winnerId}).${minorityNote} ${resolution.reason}`.trimEnd();
}

/**
 * Append a "Source-conflict notes" block to `answer` for each detected+resolved conflict. When there are no conflicts the
 * answer is returned UNCHANGED (byte-identical), so a clean synthesis never grows a spurious section. Conflicts keep their
 * input order.
 */
export function annotateSynthesisWithConflicts(answer: string, conflicts: readonly AnnotatedConflict[]): string {
	if (conflicts.length === 0) {
		return answer;
	}
	const notes = conflicts.map(renderConflictNote).join("\n");
	const base = answer.trimEnd();
	return `${base}${base.length > 0 ? "\n\n" : ""}${SECTION_HEADING}\n${notes}`;
}
