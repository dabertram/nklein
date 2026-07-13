// F1.6 — the focus-chain AUDIT history read: project the durable F1.5 ledger `transition` events (reason
// `focus_step: <text>`, from/to `focus:<status>`) back into operator-facing per-step transitions for one task.
// Read-only over the append-only ledger; the panel renders it as the chain's history.
import type {
	RuntimeFocusChainHistoryRequest,
	RuntimeFocusChainHistoryResponse,
	RuntimeFocusChainTransition,
} from "../../core/task-lifecycle-api-contract";
import { hashWorkspacePathForLedger } from "../../nklein-agent/nklein-ledger-attempt";
import { readAgentLedger } from "../../state/agent-attempt-ledger-store";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

const FOCUS_REASON_PREFIX = "focus_step: ";
const FOCUS_STATUS_PREFIX = "focus:";

export async function handleGetFocusChainHistory(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	input: RuntimeFocusChainHistoryRequest,
): Promise<RuntimeFocusChainHistoryResponse> {
	if (!workspaceScope) {
		return { transitions: [] };
	}
	const events = await readAgentLedger({
		workspacePathHash: hashWorkspacePathForLedger(workspaceScope.workspacePath),
	}).catch(() => []);
	const transitions: RuntimeFocusChainTransition[] = [];
	for (const event of events) {
		if (event.kind !== "transition" || event.taskId !== input.taskId) {
			continue;
		}
		if (!event.reason?.startsWith(FOCUS_REASON_PREFIX) || !event.to.startsWith(FOCUS_STATUS_PREFIX)) {
			continue;
		}
		transitions.push({
			stepText: event.reason.slice(FOCUS_REASON_PREFIX.length),
			from: event.from?.startsWith(FOCUS_STATUS_PREFIX) ? event.from.slice(FOCUS_STATUS_PREFIX.length) : null,
			to: event.to.slice(FOCUS_STATUS_PREFIX.length),
			recordedAt: event.recordedAt,
		});
	}
	transitions.sort((a, b) => a.recordedAt - b.recordedAt);
	return { transitions };
}
