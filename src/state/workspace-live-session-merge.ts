import type { RuntimeTaskSessionSummary } from "../core/task-session-api-contract";
import type { RuntimeWorkspaceStateResponse } from "../core/workspace-projects-api-contract";

/**
 * Overlays the LIVE task-session summaries onto a persisted workspace-state response, keyed by
 * taskId — the canonical "persisted + live" session merge.
 *
 * This is exactly the merge `buildWorkspaceStateSnapshot` performs: start from the persisted
 * sessions (`loadWorkspaceState`) and let each live summary REPLACE the persisted entry for its
 * taskId, while persisted-only tasks (no live session) are left untouched and live-only tasks are
 * added. Live wins on conflict because a running agent's in-memory state is fresher than what was
 * last flushed to disk. Mutates `response.sessions` in place (matching the prior inline loop).
 *
 * Extracted (§5.U M2) to make the merge semantics explicit and unit-testable — the characterization
 * prerequisite for unifying the two divergent read paths (low-level persisted `loadWorkspaceState`
 * vs the registry's live-layered snapshot). Behavior-preserving: identical to the inline overlay.
 */
export function applyLiveSessionsToWorkspaceState(
	response: RuntimeWorkspaceStateResponse,
	liveSummaries: Iterable<RuntimeTaskSessionSummary>,
): void {
	for (const summary of liveSummaries) {
		response.sessions[summary.taskId] = summary;
	}
}
