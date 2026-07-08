import { describe, expect, it } from "vitest";
import type { RuntimeTaskChatMessage } from "@/runtime/types";
import { deriveReasoningSnippetByTask, REASONING_SNIPPET_MAX_CHARS } from "./board-reasoning-snippets";

const msg = (role: RuntimeTaskChatMessage["role"], content: string): RuntimeTaskChatMessage => ({
	id: `${role}-${content.slice(0, 8)}`,
	role,
	content,
	createdAt: 1,
});

describe("deriveReasoningSnippetByTask (live reasoning-phase snippet for board cards)", () => {
	it("yields the last non-empty reasoning line while the reasoning message is the LATEST", () => {
		const out = deriveReasoningSnippetByTask({
			t1: [msg("user", "do it"), msg("reasoning", "First I check the config.\nNow reading board state.\n")],
		});
		expect(out).toEqual({ t1: "Now reading board state." });
	});

	it("drops a task whose thinking phase ended (a tool/assistant message followed)", () => {
		const out = deriveReasoningSnippetByTask({
			t1: [msg("reasoning", "planning..."), msg("tool", "Tool: read_file")],
			t2: [msg("reasoning", "still thinking"), msg("assistant", "done")],
		});
		expect(out).toEqual({}); // the tool/status activity line owns those cards now.
	});

	it("truncates a long line with an ellipsis and skips blank reasoning + empty tasks", () => {
		const long = "x".repeat(REASONING_SNIPPET_MAX_CHARS + 20);
		const out = deriveReasoningSnippetByTask({
			t1: [msg("reasoning", long)],
			t2: [msg("reasoning", "   \n \n")],
			t3: [],
		});
		expect(out.t1?.endsWith("…")).toBe(true);
		expect((out.t1 ?? "").length).toBeLessThanOrEqual(REASONING_SNIPPET_MAX_CHARS + 1);
		expect(out.t2).toBeUndefined();
		expect(out.t3).toBeUndefined();
	});
});
