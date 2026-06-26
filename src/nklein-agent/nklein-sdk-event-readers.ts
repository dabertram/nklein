/**
 * Defensive readers for the loosely-typed shapes the vendored SDK emits (extracted from
 * `nklein-task-session-service` per the §5.U decompose-the-service finding). Pure — they only narrow `unknown`
 * into the SDK event/result shapes the service then dispatches on. No behaviour change from the in-file versions.
 */

import { asRecord } from "./nklein-value-guards";
import type { NKleinSdkSessionEvent } from "./sdk-runtime-boundary.js";

/** The inner `payload.event` object of an SDK `agent_event`, or null if the shape doesn't match. */
export function readSdkAgentEvent(event: unknown): Record<string, unknown> | null {
	const record = asRecord(event);
	if (record?.type !== "agent_event") {
		return null;
	}
	const payload = asRecord(record.payload);
	return asRecord(payload?.event);
}

/** Narrow an unknown value to a known SDK session-event union member, or null. */
export function readSdkSessionEvent(event: unknown): NKleinSdkSessionEvent | null {
	const record = asRecord(event);
	if (!record || typeof record.type !== "string") {
		return null;
	}
	switch (record.type) {
		case "agent_event":
		case "chunk":
		case "ended":
		case "hook":
		case "pending_prompt_submitted":
		case "pending_prompts":
		case "session_snapshot":
		case "status":
		case "team_progress":
			return event as NKleinSdkSessionEvent;
		default:
			return null;
	}
}

/** The trimmed `.text` of an SDK agent result, or null when absent/empty. */
export function readAgentResultText(result: unknown): string | null {
	if (!result || typeof result !== "object") {
		return null;
	}
	if (!("text" in result)) {
		return null;
	}
	const text = result.text;
	if (typeof text !== "string") {
		return null;
	}
	const normalized = text.trim();
	return normalized.length > 0 ? normalized : null;
}
