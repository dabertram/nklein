import { describe, expect, it } from "vitest";
import {
	type ReasoningChannelSplit,
	reasoningAndAnswerText,
	splitReasoningChannel,
	stripReasoningChannel,
} from "../../../src/core/reasoning-channel-split";

describe("splitReasoningChannel — separate reasoning_content field (OpenAI /v1 split)", () => {
	it("keeps content as the answer and reasoning_content as the reasoning", () => {
		const split = splitReasoningChannel({
			content: "The capital of France is Paris.",
			reasoning_content: "The user asked about France; its capital is Paris.",
		});
		expect(split).toEqual<ReasoningChannelSplit>({
			answer: "The capital of France is Paris.",
			reasoning: "The user asked about France; its capital is Paris.",
			hadInlineReasoning: false,
			truncatedReasoning: false,
		});
	});

	it("trims both channels", () => {
		const split = splitReasoningChannel({
			content: "   Paris.  \n",
			reasoning_content: "\n\n  thinking...  ",
		});
		expect(split.answer).toBe("Paris.");
		expect(split.reasoning).toBe("thinking...");
	});

	it("yields empty reasoning when reasoning_content is null/absent", () => {
		expect(splitReasoningChannel({ content: "hello" }).reasoning).toBe("");
		expect(splitReasoningChannel({ content: "hello", reasoning_content: null }).reasoning).toBe("");
		expect(splitReasoningChannel({ content: "hello", reasoning_content: "   " }).reasoning).toBe("");
	});
});

describe("splitReasoningChannel — inline <think>…</think> (DeepSeek-R1 convention)", () => {
	it("lifts a closed inline block out of the answer and into reasoning", () => {
		const split = splitReasoningChannel({
			content: "<think>Let me compute 2+2.</think>The answer is 4.",
		});
		expect(split.answer).toBe("The answer is 4.");
		expect(split.reasoning).toBe("Let me compute 2+2.");
		expect(split.hadInlineReasoning).toBe(true);
		expect(split.truncatedReasoning).toBe(false);
	});

	it("keeps answer text that appears before AND after the block", () => {
		const split = splitReasoningChannel({
			content: "Prefix. <think>hidden</think> Suffix.",
		});
		expect(split.answer).toBe("Prefix.  Suffix.");
		expect(split.reasoning).toBe("hidden");
	});

	it("handles multiple inline blocks, joining reasoning in document order", () => {
		const split = splitReasoningChannel({
			content: "A<think>one</think>B<think>two</think>C",
		});
		expect(split.answer).toBe("ABC");
		expect(split.reasoning).toBe("one\n\ntwo");
		expect(split.hadInlineReasoning).toBe(true);
	});

	it("matches the tags case-insensitively", () => {
		const split = splitReasoningChannel({ content: "<THINK>deep</Think>done" });
		expect(split.answer).toBe("done");
		expect(split.reasoning).toBe("deep");
		expect(split.hadInlineReasoning).toBe(true);
	});

	it("does NOT treat ordinary prose mentioning 'think' as a marker", () => {
		const split = splitReasoningChannel({ content: "I think Paris is the capital." });
		expect(split.answer).toBe("I think Paris is the capital.");
		expect(split.reasoning).toBe("");
		expect(split.hadInlineReasoning).toBe(false);
	});

	it("does NOT accept a tag with internal whitespace (conservative)", () => {
		const split = splitReasoningChannel({ content: "< think >nope</ think >text" });
		expect(split.hadInlineReasoning).toBe(false);
		expect(split.answer).toBe("< think >nope</ think >text");
	});
});

describe("splitReasoningChannel — TRUNCATED (unterminated) inline block (§5.AA mid-thought truncation)", () => {
	it("treats an open <think> with no close as reasoning, leaving an empty answer", () => {
		const split = splitReasoningChannel({
			content: "<think>I need to reason a lot and then I ran out of budget before finishing",
		});
		expect(split.answer).toBe("");
		expect(split.reasoning).toBe("I need to reason a lot and then I ran out of budget before finishing");
		expect(split.hadInlineReasoning).toBe(true);
		expect(split.truncatedReasoning).toBe(true);
	});

	it("keeps the answer text that preceded the unterminated open marker", () => {
		const split = splitReasoningChannel({
			content: "Partial answer. <think>then it kept thinking without closing",
		});
		expect(split.answer).toBe("Partial answer.");
		expect(split.reasoning).toBe("then it kept thinking without closing");
		expect(split.truncatedReasoning).toBe(true);
	});

	it("is the behavior the naive replace(/<think>…<\\/think>/) regex gets WRONG (regression guard)", () => {
		const truncated = "<think>runaway reasoning with no closing tag at all";
		// The old strip leaves the whole reasoning dump in place because it needs a closing tag:
		const naiveStrip = truncated.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
		expect(naiveStrip).toBe(truncated); // regex matched nothing → reasoning leaks
		// The core removes it from the answer:
		expect(stripReasoningChannel(truncated)).toBe("");
	});
});

describe("splitReasoningChannel — [THINK] bracket variant", () => {
	it("lifts a closed [THINK]…[/THINK] block", () => {
		const split = splitReasoningChannel({ content: "[THINK]bracketed thought[/THINK]visible" });
		expect(split.answer).toBe("visible");
		expect(split.reasoning).toBe("bracketed thought");
		expect(split.hadInlineReasoning).toBe(true);
	});

	it("detects a truncated [THINK] with no terminator", () => {
		const split = splitReasoningChannel({ content: "[THINK]open bracket never closed" });
		expect(split.answer).toBe("");
		expect(split.truncatedReasoning).toBe(true);
		expect(split.reasoning).toBe("open bracket never closed");
	});
});

describe("splitReasoningChannel — mixed separate + inline", () => {
	it("joins the separate reasoning_content FIRST, then inline blocks", () => {
		const split = splitReasoningChannel({
			content: "answer <think>inline thought</think> tail",
			reasoning_content: "separate-field thought",
		});
		expect(split.answer).toBe("answer  tail");
		expect(split.reasoning).toBe("separate-field thought\n\ninline thought");
	});
});

describe("splitReasoningChannel — string overload + degenerate inputs", () => {
	it("accepts a bare content string (no separate reasoning field)", () => {
		const split = splitReasoningChannel("<think>t</think>hi");
		expect(split.answer).toBe("hi");
		expect(split.reasoning).toBe("t");
	});

	it("returns empty channels for empty / whitespace / missing content", () => {
		for (const input of ["", "   \n ", { content: null }, { content: undefined }, {}]) {
			const split = splitReasoningChannel(input as string | { content?: string | null });
			expect(split.answer).toBe("");
			expect(split.reasoning).toBe("");
			expect(split.hadInlineReasoning).toBe(false);
			expect(split.truncatedReasoning).toBe(false);
		}
	});

	it("never throws on odd input", () => {
		expect(() => splitReasoningChannel({ content: "</think>orphan close" })).not.toThrow();
		// An orphan CLOSE with no open is just text (no open marker was found).
		const split = splitReasoningChannel({ content: "</think>orphan close" });
		expect(split.answer).toBe("</think>orphan close");
		expect(split.hadInlineReasoning).toBe(false);
	});
});

describe("stripReasoningChannel", () => {
	it("returns only the visible answer for a closed inline block", () => {
		expect(stripReasoningChannel("<think>reasoning</think>The result.")).toBe("The result.");
	});

	it("strips a separate reasoning field's content is untouched (only answer returned)", () => {
		expect(stripReasoningChannel({ content: "visible", reasoning_content: "hidden" })).toBe("visible");
	});
});

describe("reasoningAndAnswerText — narrated-recovery scan surface", () => {
	it("combines reasoning first then answer, blank-line separated", () => {
		const text = reasoningAndAnswerText({
			content: "the answer",
			reasoning_content: "the reasoning",
		});
		expect(text).toBe("the reasoning\n\nthe answer");
	});

	it("includes inline reasoning so an inline-reasoning model's narrated call is scannable", () => {
		const text = reasoningAndAnswerText('<think>{"tool":"read_file"}</think>ok');
		expect(text).toBe('{"tool":"read_file"}\n\nok');
	});

	it("omits an empty channel (no leading/trailing blank noise)", () => {
		expect(reasoningAndAnswerText({ content: "just answer" })).toBe("just answer");
		expect(reasoningAndAnswerText({ content: "", reasoning_content: "just reasoning" })).toBe("just reasoning");
	});
});
