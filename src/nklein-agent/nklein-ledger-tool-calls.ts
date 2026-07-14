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
import type { RecordedToolExecution } from "../core/tool-replay-policy";
import { hashToolResultContent } from "../core/tool-result-record";
import { computeNKleinToolInputFingerprint } from "./nklein-tool-call-fingerprint";
import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary.js";

/** Input keys whose string value(s) name a file path a tool touched (read/edit/write/create). */
const FILE_PATH_INPUT_KEYS = new Set([
	"path",
	"file_path",
	"filePath",
	"target_file",
	"targetFile",
	"file",
	"filename",
]);
/** Input keys whose value is an ARRAY of file paths (multi-file tools). */
const FILE_PATH_ARRAY_KEYS = new Set(["paths", "files", "target_files", "targetFiles", "file_paths"]);

/**
 * Derive the file paths a tool call touched from its input (shallow scan of the known path-bearing keys). Pure + total:
 * unknown/non-file tools yield []. This is what populates {@link AttemptToolCall.filePaths} for PRM's context-thrash.
 */
export function deriveToolCallFilePaths(input: unknown): string[] {
	if (!input || typeof input !== "object") {
		return [];
	}
	const record = input as Record<string, unknown>;
	const paths = new Set<string>();
	for (const [key, value] of Object.entries(record)) {
		if (FILE_PATH_INPUT_KEYS.has(key) && typeof value === "string" && value.trim().length > 0) {
			paths.add(value.trim());
		} else if (FILE_PATH_ARRAY_KEYS.has(key) && Array.isArray(value)) {
			for (const entry of value) {
				if (typeof entry === "string" && entry.trim().length > 0) {
					paths.add(entry.trim());
				}
			}
		}
	}
	return [...paths];
}

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
				const filePaths = deriveToolCallFilePaths(block.input);
				calls.push({
					name: block.name,
					fingerprint: computeNKleinToolInputFingerprint(block.input),
					outcome: null,
					// Only carry the field when it says something (keeps legacy-shaped lines lean).
					...(filePaths.length > 0 ? { filePaths } : {}),
				});
			} else if (block.type === "tool_result") {
				const index = callIndexByUseId.get(block.tool_use_id);
				const call = index === undefined ? undefined : calls[index];
				if (call) {
					call.outcome = block.is_error ? "error" : "success";
					// F1.16: the durable evidence hash of what the tool returned — replay can verify the recorded
					// execution without re-running the side effect or persisting the payload.
					call.resultHash = hashToolResultContent(block.content ?? null);
				}
			}
		}
	}
	return calls;
}

/**
 * F1.17 — build the REPLAY source from a task's persisted transcript: every COMPLETED tool call as a
 * {@link RecordedToolExecution} (full recorded payload + canonical hash, occurrence-indexed per
 * (toolName, inputFingerprint) so deliberate repeats replay in order). This is the same contract simulator
 * fixtures supply — one shape, two sources. A call with no tool_result (the run died mid-call) is omitted:
 * it never completed, so a replay must execute it live.
 */
export function buildRecordedToolExecutions(messages: readonly NKleinSdkPersistedMessage[]): RecordedToolExecution[] {
	const pendingByUseId = new Map<string, { name: string; fingerprint: string | null }>();
	const occurrenceByKey = new Map<string, number>();
	const executions: RecordedToolExecution[] = [];
	for (const message of messages) {
		if (typeof message.content === "string") {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				pendingByUseId.set(block.id, {
					name: block.name,
					fingerprint: computeNKleinToolInputFingerprint(block.input),
				});
			} else if (block.type === "tool_result") {
				const pending = pendingByUseId.get(block.tool_use_id);
				if (!pending) {
					continue;
				}
				pendingByUseId.delete(block.tool_use_id);
				const key = `${pending.name}\u0000${pending.fingerprint ?? ""}`;
				const occurrence = occurrenceByKey.get(key) ?? 0;
				occurrenceByKey.set(key, occurrence + 1);
				const content = block.content ?? null;
				executions.push({
					toolName: pending.name,
					inputFingerprint: pending.fingerprint,
					occurrence,
					content,
					resultHash: hashToolResultContent(content),
					isError: block.is_error === true,
				});
			}
		}
	}
	return executions;
}
