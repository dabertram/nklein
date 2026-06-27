/**
 * Extract the ordered per-tool-call record from a task's persisted transcript, for the Agent Attempt Ledger's
 * `attempt.toolCalls` (§5.AF). Walks each `tool_use` block (name + lossless full-input fingerprint, §5.O) and
 * correlates the matching `tool_result` by `tool_use_id` to fill the per-call outcome (`error`/`success`); a call with
 * no result stays `null` (the run ended before that call completed).
 *
 * Pure + computed at terminal time from the already-persisted messages, so it needs no live per-event accumulation —
 * the richer-writer follow-up the coarse terminal seam noted is now this function.
 */

import type { AttemptToolCall } from "../core/agent-attempt-ledger";
import { computeNKleinToolInputFingerprint } from "./nklein-tool-call-fingerprint";
import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary.js";

export function extractTerminalToolCalls(messages: readonly NKleinSdkPersistedMessage[]): AttemptToolCall[] {
	const calls: AttemptToolCall[] = [];
	const callIndexByUseId = new Map<string, number>();
	for (const message of messages) {
		if (typeof message.content === "string") {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				callIndexByUseId.set(block.id, calls.length);
				calls.push({
					name: block.name,
					fingerprint: computeNKleinToolInputFingerprint(block.input),
					outcome: null,
				});
			} else if (block.type === "tool_result") {
				const index = callIndexByUseId.get(block.tool_use_id);
				const call = index === undefined ? undefined : calls[index];
				if (call) {
					call.outcome = block.is_error ? "error" : "success";
				}
			}
		}
	}
	return calls;
}
