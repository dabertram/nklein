import { isNKleinUserAttentionTool, type NKleinTaskSessionEntry } from "./nklein-session-state";

/**
 * §5.U — the pure tool-activity classifiers extracted from `nklein-event-adapter`: read the retained tool name/input
 * from a session entry's latest SDK hook activity, decide whether an aborted turn ended on a reviewable (mutating) tool
 * completion, and recognize the SDK's recoverable "tool call(s) failed" message. No IO / no emits — just reads of the
 * entry summary — so the classification rules are independently testable.
 */

/** The tool name + input summary retained from the entry's latest SDK hook activity (nulls when there is none). */
export function getRetainedNKleinToolActivity(entry: NKleinTaskSessionEntry): {
	toolName: string | null;
	toolInputSummary: string | null;
} {
	const latestHookActivity = entry.summary.latestHookActivity;
	if (latestHookActivity?.source !== "nklein-sdk" || !latestHookActivity.toolName) {
		return {
			toolName: null,
			toolInputSummary: null,
		};
	}

	return {
		toolName: latestHookActivity.toolName,
		toolInputSummary: latestHookActivity.toolInputSummary ?? null,
	};
}

/**
 * True when the entry's latest activity is a completed `tool_result` for a mutating tool (edit/write/run) that isn't a
 * user-attention tool — i.e. an aborted turn that nonetheless produced a reviewable change.
 */
export function isReviewableAbortedToolCompletion(entry: NKleinTaskSessionEntry): boolean {
	const latestHookActivity = entry.summary.latestHookActivity;
	if (latestHookActivity?.source !== "nklein-sdk" || latestHookActivity.hookEventName !== "tool_result") {
		return false;
	}
	const toolName = latestHookActivity.toolName?.trim().toLowerCase();
	if (!toolName || isNKleinUserAttentionTool(toolName)) {
		return false;
	}
	return new Set([
		"edit",
		"edit_file",
		"replace_in_file",
		"run_command",
		"run_commands",
		"write",
		"write_file",
		"write_files",
	]).has(toolName);
}

/** True when an SDK error message reports the recoverable "tool call(s) failed" condition. */
export function isRecoverableToolCallFailure(message: string | null): boolean {
	return Boolean(message?.includes("tool call(s) failed:"));
}
