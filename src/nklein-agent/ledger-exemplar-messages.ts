/**
 * F12.81 wire helper — join the attempt ledger to the board so the PURE exemplar core can select behavioural
 * few-shots, then render them as real SDK message turns for `initialMessages`.
 *
 * The core deliberately owns no IO and the ledger stores no card TEXT, so this is where the two meet: ledger
 * attempts supply outcome/role/tool-sequence, the board supplies each card's title, and the pair becomes an
 * {@link ExemplarCandidate}. Best-effort by contract — any unreadable source yields NO exemplars, because a
 * missing example costs nothing while a wrong one gets imitated.
 */

import type { AgentLedgerEvent } from "../core/agent-attempt-ledger";
import {
	type ExemplarCandidate,
	renderExemplarMessages,
	selectLedgerExemplars,
} from "../core/ledger-few-shot-exemplars";
import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary";

/** Minimal board shape this helper needs — a title per task id. */
export interface ExemplarBoardLookup {
	readonly titleByTaskId: ReadonlyMap<string, string>;
}

/** Build exemplar candidates by joining attempts to their card titles. Attempts with no known title are dropped. */
export function buildExemplarCandidates(
	events: readonly AgentLedgerEvent[],
	board: ExemplarBoardLookup,
	excludeTaskId: string,
): ExemplarCandidate[] {
	const candidates: ExemplarCandidate[] = [];
	for (const event of events) {
		if (event.kind !== "attempt" || event.taskId === excludeTaskId) {
			continue;
		}
		const text = board.titleByTaskId.get(event.taskId);
		if (!text) {
			continue;
		}
		candidates.push({
			attemptId: event.attemptId,
			text,
			role: event.role,
			succeeded: event.outcome === "success",
			toolNames: event.toolCalls.map((call) => call.name),
		});
	}
	return candidates;
}

/** Wrap the rendered exemplar turns as SDK persisted messages, stamped so transcript tooling can identify them. */
export function toExemplarPersistedMessages(
	messages: readonly { role: "user" | "assistant"; content: string }[],
	now: number,
): NKleinSdkPersistedMessage[] {
	return messages.map(
		(message, index) =>
			({
				id: `kanban-ledger-exemplar-${now}-${index}`,
				role: message.role,
				content: [{ type: "text", text: message.content }],
				createdAt: now,
				metadata: { kind: "kanban-ledger-exemplar" },
			}) as unknown as NKleinSdkPersistedMessage,
	);
}

/**
 * End-to-end: attempts + board → selected exemplars → SDK message turns. Returns [] when nothing qualifies, so
 * the caller can pass it straight through and keep a byte-identical prompt in the common case.
 */
export function buildLedgerExemplarMessages(input: {
	readonly events: readonly AgentLedgerEvent[];
	readonly board: ExemplarBoardLookup;
	readonly taskId: string;
	readonly targetText: string;
	readonly targetRole: string | null;
	readonly now: number;
}): NKleinSdkPersistedMessage[] {
	const candidates = buildExemplarCandidates(input.events, input.board, input.taskId);
	const selected = selectLedgerExemplars({
		targetText: input.targetText,
		targetRole: input.targetRole,
		candidates,
	});
	return toExemplarPersistedMessages(renderExemplarMessages(selected), input.now);
}
