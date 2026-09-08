import { describe, expect, it } from "vitest";
import { isContextOverflowMessage } from "../../../src/core/context-overflow-signature";
import { classifyFailureSignature } from "../../../src/core/failure-signature";
import { isModelSideError } from "../../../src/core/model-failover-policy";
import { isContextOverflowError } from "../../../src/nklein-agent/nklein-context-overflow-compaction";

/** The live P0.CTX500 wording (v31 factory 2026-09-03 s42 worker; 2026-09-05 merge session — both parked). */
const LMSTUDIO_ENGINE_500 =
	"Engine protocol predict stream returned an error: {code:500, message:'Context size has been exceeded'}";

/** Every cited wording, with where it was read. Adding an engine string means adding it HERE and in the table. */
const CITED_OVERFLOW_MESSAGES: readonly [label: string, message: string][] = [
	["LM Studio engine-500 wrapper (live 2026-09-03)", LMSTUDIO_ENGINE_500],
	["llama.cpp generation-time (server-context.cpp)", "Context size has been exceeded."],
	[
		"llama.cpp request-time, no context shift (server-context.cpp)",
		"input (70000 tokens) is larger than the max context size (65536 tokens). skipping",
	],
	[
		"llama.cpp request-time, context shift (server-context.cpp)",
		"request (66000 tokens) exceeds the available context size (65536 tokens), try increasing it",
	],
	[
		"llama.cpp typed error envelope (server-common.cpp)",
		'{"error":{"code":400,"message":"request (66000 tokens) exceeds the available context size (65536 tokens), try increasing it","type":"exceed_context_size_error"}}',
	],
	[
		"LM Studio over-window probe (P21.3b, 2026-07-20)",
		"tokens to keep from the initial prompt is greater than the context length",
	],
	[
		"OpenAI-compatible gateway",
		"This model's maximum context length is 8192 tokens. However, you requested 16800 tokens. Please reduce the length of the messages or completion.",
	],
	["aimock compaction cell (2026-07-25)", "maximum context length exceeded"],
	["OpenAI error code", "context_length_exceeded"],
	["Anthropic", "prompt is too long: 250000 tokens > 200000 maximum"],
	["stop reason", "contextLengthReached"],
	["generic", "Input exceeds the context window"],
	["generic", "requested input length 9000 exceeds the maximum input length"],
	["generic", "input token count exceeds the maximum 128000 tokens allowed"],
];

const NOT_OVERFLOW_MESSAGES: readonly string[] = [
	"Engine protocol predict request returned 500: The model has crashed without additional info",
	"network timeout",
	"ECONNREFUSED 127.0.0.1:1234",
	"finish_reason: length",
	"max_tokens reached",
	"the response was truncated",
	"Docker bind mount failed",
	"npm test exited with code 1",
	"invalid api key",
];

describe("isContextOverflowMessage", () => {
	it.each(CITED_OVERFLOW_MESSAGES)("recognizes %s", (_label, message) => {
		expect(isContextOverflowMessage(message)).toBe(true);
	});

	it.each(NOT_OVERFLOW_MESSAGES)("does not flag %j", (message) => {
		expect(isContextOverflowMessage(message)).toBe(false);
	});

	it("is false for empty or missing text", () => {
		expect(isContextOverflowMessage("")).toBe(false);
		expect(isContextOverflowMessage("   ")).toBe(false);
		expect(isContextOverflowMessage(null)).toBe(false);
		expect(isContextOverflowMessage(undefined)).toBe(false);
	});
});

describe("one classifier behind every seam (P0.CTX500: three private copies each missed the engine wording)", () => {
	it.each(
		CITED_OVERFLOW_MESSAGES,
	)("%s reaches the dispatch-time compaction AND the in-turn ladder as a context overflow", (_label, message) => {
		expect(isContextOverflowError(new Error(message))).toBe(true);
		const verdict = classifyFailureSignature(new Error(message));
		expect(verdict.signature).toBe("context_overflow");
		expect(verdict.outcome).toBe("aborted");
		expect(verdict.remediable).toBe(true);
	});

	it("the LM Studio engine-500 wrapper is ALSO model-side for the terminal failover leg", () => {
		// Before the fix the failover leg refused this exact text as "not model-side" and parked the card.
		expect(isModelSideError(LMSTUDIO_ENGINE_500)).toBe(true);
	});

	it.each(NOT_OVERFLOW_MESSAGES)("%j is not an overflow at any seam", (message) => {
		expect(isContextOverflowError(new Error(message))).toBe(false);
		expect(classifyFailureSignature(new Error(message)).signature).not.toBe("context_overflow");
	});
});
