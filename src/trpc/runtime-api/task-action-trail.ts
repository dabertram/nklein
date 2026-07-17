// F12.55 — the per-card action-trail read: project the task's ledger events through `buildCardActionTrail`
// (plain-language, artifact-anchored, reversibility-classified) for the card-detail panel. Read-only over the
// append-only ledger; the tail cap keeps the panel payload bounded while `totalEntries` stays honest about it.
import { buildCardActionTrail } from "../../core/card-action-trail";
import type {
	RuntimeTaskActionTrailRequest,
	RuntimeTaskActionTrailResponse,
} from "../../core/task-lifecycle-api-contract";
import { hashWorkspacePathForLedger } from "../../nklein-agent/nklein-ledger-attempt";
import { readAgentLedger } from "../../state/agent-attempt-ledger-store";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

const DEFAULT_TRAIL_LIMIT = 120;

export async function handleGetTaskActionTrail(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	input: RuntimeTaskActionTrailRequest,
): Promise<RuntimeTaskActionTrailResponse> {
	if (!workspaceScope) {
		return { entries: [], totalEntries: 0 };
	}
	const events = await readAgentLedger({
		workspacePathHash: hashWorkspacePathForLedger(workspaceScope.workspacePath),
	}).catch(() => []);
	const trail = buildCardActionTrail(events, input.taskId);
	const limit = input.limit ?? DEFAULT_TRAIL_LIMIT;
	return {
		entries: trail.slice(-limit).map((entry) => ({
			at: entry.at,
			kind: entry.kind,
			text: entry.text,
			files: [...entry.files],
			reversibility: entry.reversibility,
			hypothesis: entry.hypothesis,
		})),
		totalEntries: trail.length,
	};
}
