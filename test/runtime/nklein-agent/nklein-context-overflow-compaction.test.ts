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
