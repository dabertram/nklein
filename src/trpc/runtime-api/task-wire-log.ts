/**
 * §dsh#31 — the read-only WIRE LOG handler: what the model actually saw for one card.
 *
 * Two append-only streams already exist on disk — the session request log (every outbound model request,
 * verbatim) and the session injection log (every runtime-injected message). Until now they were reachable
 * only through a `dev` command, so the UI's "Full" level stopped short of the finest grain the product owns.
 *
 * INSPECTION ONLY: nothing here mutates a session. Two properties matter more than completeness —
 *  · a DISABLED log and an EMPTY log are reported as different facts (silence must stay attributable), and
 *  · truncation is reported as a count, so a capped view never reads as the whole history.
 */

import type { RuntimeTaskWireLogRequest, RuntimeTaskWireLogResponse } from "../../core/task-session-api-contract";
import { isSessionInjectionLogEnabled, readSessionInjectionRecords } from "../../state/session-injection-log-store";
import { isSessionRequestLogEnabled, readSessionRequestRecords } from "../../state/session-request-log-store";

const DEFAULT_LIMIT = 100;

/**
 * The session ids a card can own: the primary session plus the derived ones (`::review`, `::spec`, …). The
 * request log is keyed by SESSION id, and a card's story is incomplete without its reviewer's requests.
 */
export function wireLogSessionIdsForTask(taskId: string): string[] {
	return [taskId, `${taskId}::review`, `${taskId}::spec`];
}

export async function collectTaskWireLog(
	input: RuntimeTaskWireLogRequest,
	deps: {
		readRequests?: typeof readSessionRequestRecords;
		readInjections?: typeof readSessionInjectionRecords;
		requestLogEnabled?: () => boolean;
		injectionLogEnabled?: () => boolean;
	} = {},
): Promise<RuntimeTaskWireLogResponse> {
	const readRequests = deps.readRequests ?? readSessionRequestRecords;
	const readInjections = deps.readInjections ?? readSessionInjectionRecords;
	const limit = input.limit ?? DEFAULT_LIMIT;
	const includeText = input.includeMessageText === true;
	const sessionIds = wireLogSessionIdsForTask(input.taskId);

	const requestRecords = (await Promise.all(sessionIds.map((id) => readRequests(id).catch(() => []))))
		.flat()
		.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
	const injectionRecords = (await Promise.all(sessionIds.map((id) => readInjections(id).catch(() => []))))
		.flat()
		.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));

	// Newest last: keep the TAIL, which is the part an operator is almost always asking about.
	const keptRequests = requestRecords.slice(Math.max(0, requestRecords.length - limit));
	const keptInjections = injectionRecords.slice(Math.max(0, injectionRecords.length - limit));

	return {
		sessionIds,
		requests: keptRequests.map((record) => ({
			recordedAt: record.recordedAt,
			source: record.source,
			purpose: record.purpose,
			modelId: record.modelId,
			messagesSha256: record.messagesSha256,
			messageCount: record.messages.length,
			totalChars: record.messages.reduce((sum, message) => sum + message.content.length, 0),
			toolNames: [...(record.toolNames ?? [])],
			systemPromptChars: record.systemPrompt === undefined ? null : record.systemPrompt.length,
			messages: record.messages.map((message) => ({
				role: message.role,
				chars: message.content.length,
				...(includeText ? { text: message.content } : {}),
			})),
		})),
		injections: keptInjections.map((record) => ({
			recordedAt: record.recordedAt,
			kind: record.kind,
			role: record.role,
			chars: record.content.length,
			...(includeText ? { text: record.content } : {}),
		})),
		requestLogDisabled: !(deps.requestLogEnabled ?? isSessionRequestLogEnabled)(),
		injectionLogDisabled: !(deps.injectionLogEnabled ?? isSessionInjectionLogEnabled)(),
		truncatedRequests: requestRecords.length - keptRequests.length,
		truncatedInjections: injectionRecords.length - keptInjections.length,
	};
}
