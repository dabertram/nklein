import type { RuntimeTaskChatMessage } from "@/runtime/types";

/**
 * §5.V (handoff 2026-06-28) — the live REASONING-phase snippet for board cards. Reasoning deltas do NOT flow through
 * `latestHookActivity` (that carries tool/status hooks); they stream as `role:"reasoning"` task-chat messages the
 * client already accumulates per task. This pure derivation turns that map into a tiny per-task snippet map so the
 * board re-renders on a short string change, never on the raw message firehose:
 *  - a task contributes a snippet ONLY while the reasoning message is the LATEST one (the agent is thinking NOW —
 *    once a tool/assistant message follows, the tool-activity line takes over);
 *  - the snippet is the reasoning's last non-empty line, trimmed + truncated (glance surface, not a transcript).
 */

export const REASONING_SNIPPET_MAX_CHARS = 80;

/** Last non-empty line of the reasoning text, trimmed; null when blank. */
function lastReasoningLine(text: string): string | null {
	const lines = text.split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		const line = (lines[i] ?? "").trim();
		if (line.length > 0) {
			return line;
		}
	}
	return null;
}

export function deriveReasoningSnippetByTask(
	messagesByTaskId: Readonly<Record<string, readonly RuntimeTaskChatMessage[]>>,
	maxChars: number = REASONING_SNIPPET_MAX_CHARS,
): Record<string, string> {
	const snippets: Record<string, string> = {};
	for (const [taskId, messages] of Object.entries(messagesByTaskId)) {
		const latest = messages.at(-1);
		if (latest?.role !== "reasoning") {
			continue; // not thinking right now — the tool/status activity line owns the card.
		}
		const line = lastReasoningLine(latest.content);
		if (!line) {
			continue;
		}
		snippets[taskId] = line.length > maxChars ? `${line.slice(0, maxChars).trimEnd()}…` : line;
	}
	return snippets;
}
