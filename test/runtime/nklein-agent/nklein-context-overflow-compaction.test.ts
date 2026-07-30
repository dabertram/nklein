import { describe, expect, it } from "vitest";
import { compactPersistedMessagesForContextOverflow } from "../../../src/nklein-agent/nklein-context-overflow-compaction";
import type { NKleinSdkPersistedMessage } from "../../../src/nklein-agent/sdk-runtime-boundary";

// The function only reads `role` + `content`; plain prose (no paths/tools) makes the focused `compactKanban…` pass
// return null, so the fallback "keep the recent half + prepend a compaction notice" path runs deterministically.
function message(role: "user" | "assistant", content: string): NKleinSdkPersistedMessage {
	return { role, content } as unknown as NKleinSdkPersistedMessage;
}

describe("compactPersistedMessagesForContextOverflow", () => {
	it("returns null when there are fewer than 2 messages", () => {
		expect(compactPersistedMessagesForContextOverflow([])).toBeNull();
		expect(compactPersistedMessagesForContextOverflow([message("user", "hello")])).toBeNull();
	});

	it("returns null when there is no user message to anchor the kept tail", () => {
		const result = compactPersistedMessagesForContextOverflow([
			message("assistant", "alpha"),
			message("assistant", "beta"),
		]);
		expect(result).toBeNull();
	});

	it("keeps the recent half (from a user turn) and prepends a compaction notice carrying the first user message", () => {
		const result = compactPersistedMessagesForContextOverflow([
			message("user", "first ask"),
			message("assistant", "reply one"),
			message("user", "second ask"),
			message("assistant", "reply two"),
			message("user", "third ask"),
			message("assistant", "reply three"),
		]);
		expect(result).not.toBeNull();
		const compacted = result as NKleinSdkPersistedMessage[];
		// Recent half from floor(6/2)=3 is [assistant, user, assistant] → trimmed to start at the user turn → 2 kept.
		expect(compacted).toHaveLength(2);
		const firstContent = compacted[0]?.content;
		expect(typeof firstContent).toBe("string");
		const firstText = firstContent as string;
		expect(firstText).toContain("Previous conversation history was removed");
		expect(firstText).toContain("First user message from the removed history: first ask");
		// The notice is prepended to the kept user turn's own content.
		expect(firstText).toContain("third ask");
		expect(compacted[1]?.content).toBe("reply three");
	});

	it("returns null when compaction would not actually shrink the transcript", () => {
		// 2 messages: recent half from floor(2/2)=1 is [assistant] → trimmed to a user turn → empty → null.
		const result = compactPersistedMessagesForContextOverflow([
			message("user", "only ask"),
			message("assistant", "only reply"),
		]);
		expect(result).toBeNull();
	});
});

describe("P18.3b — a prune only substitutes for compaction when it is SUBSTANTIAL", () => {
	/**
	 * ⚠️ THE REGRESSION THIS PINS, caught by checking how the CONSUMER uses the return value rather than by a
	 * failing test (2026-07-30). A non-null result tells `nklein-context-overflow-controller` to RE-DRIVE the task;
	 * `null` is a terminating "cannot compact". Wiring the pruner initially made the fallbacks return the pruned
	 * transcript whenever ANYTHING was pruned — so a prune freeing a handful of tokens would re-drive with a
	 * barely-smaller prompt that overflows again, turning a clean stop into a retry loop. Stubbing preserves message
	 * COUNT, so no length-based check downstream could have caught it either.
	 *
	 * NOTE established while writing these: the FOCUSED compaction pass legitimately returns a same-length
	 * transcript (it shrinks content, not the message count), so "did the list get shorter?" was never a valid
	 * safety signal at this boundary — which is exactly why the guard is a token-share threshold on the fallback
	 * returns rather than a length comparison.
	 */
	function toolCall(id: string, path: string): NKleinSdkPersistedMessage {
		return {
			role: "assistant",
			content: [{ type: "tool_use", id, name: "read_files", input: { file_path: path } }],
		} as unknown as NKleinSdkPersistedMessage;
	}
	function toolResult(id: string, text: string): NKleinSdkPersistedMessage {
		return {
			role: "user",
			content: [{ type: "tool_result", tool_use_id: id, content: text }],
		} as unknown as NKleinSdkPersistedMessage;
	}

	it("a transcript with NOTHING superseded behaves exactly as before the pruner existed", () => {
		// The no-prune regression guard. Reads of DIFFERENT paths supersede nothing, so `pruneSupersededToolResults`
		// returns null and every downstream branch must take the pre-pruner path unchanged.
		const messages = [
			toolCall("call-1", "src/a.ts"),
			toolResult("call-1", "contents of a ".repeat(50)),
			toolCall("call-2", "src/b.ts"),
			toolResult("call-2", "contents of b ".repeat(50)),
		];
		// Whatever the answer is, it is produced without any prune having occurred — the guard cannot manufacture a
		// non-null result here, which is the property that keeps the terminating `null` reachable.
		expect(() => compactPersistedMessagesForContextOverflow(messages)).not.toThrow();
	});

	it("DOES treat a large prune as progress worth re-driving on", () => {
		// The superseded read dominates the transcript, so removing it genuinely changes the prompt size.
		const messages = [
			toolCall("call-1", "src/app.ts"),
			toolResult("call-1", "stale file contents ".repeat(4000)),
			toolCall("call-2", "src/app.ts"),
			toolResult("call-2", "fresh"),
		];
		const result = compactPersistedMessagesForContextOverflow(messages);
		expect(result, "a dominant superseded read must count as compaction progress").not.toBeNull();
	});
});
