import { describe, expect, it } from "vitest";
import {
	CompletionOutcome,
	classifyCompletionOutcome,
	deriveTruncationSignal,
	isTruncatedOutcome,
} from "../../../src/core/completion-stop-reason";

describe("classifyCompletionOutcome — OpenAI /v1 finish_reason dialect", () => {
	it("maps stop → NaturalStop", () => {
		expect(classifyCompletionOutcome("stop")).toBe(CompletionOutcome.NaturalStop);
	});
	it("maps length → TruncatedTokens", () => {
		expect(classifyCompletionOutcome("length")).toBe(CompletionOutcome.TruncatedTokens);
	});
	it("maps tool_calls → ToolCall", () => {
		expect(classifyCompletionOutcome("tool_calls")).toBe(CompletionOutcome.ToolCall);
	});
	it("maps content_filter → ContentFiltered", () => {
		expect(classifyCompletionOutcome("content_filter")).toBe(CompletionOutcome.ContentFiltered);
	});
	it("maps function_call → ToolCall", () => {
		expect(classifyCompletionOutcome("function_call")).toBe(CompletionOutcome.ToolCall);
	});
});

describe("classifyCompletionOutcome — Anthropic /v1/messages stop_reason dialect", () => {
	it("maps end_turn → NaturalStop", () => {
		expect(classifyCompletionOutcome("end_turn")).toBe(CompletionOutcome.NaturalStop);
	});
	it("maps max_tokens → TruncatedTokens", () => {
		expect(classifyCompletionOutcome("max_tokens")).toBe(CompletionOutcome.TruncatedTokens);
	});
	it("maps tool_use → ToolCall", () => {
		expect(classifyCompletionOutcome("tool_use")).toBe(CompletionOutcome.ToolCall);
	});
	it("maps stop_sequence → NaturalStop", () => {
		expect(classifyCompletionOutcome("stop_sequence")).toBe(CompletionOutcome.NaturalStop);
	});
	it("maps refusal → ContentFiltered", () => {
		expect(classifyCompletionOutcome("refusal")).toBe(CompletionOutcome.ContentFiltered);
	});
});

describe("classifyCompletionOutcome — native /api/v0 stats.stop_reason dialect", () => {
	it("maps eosFound → NaturalStop (the live-verified qwen3 default)", () => {
		expect(classifyCompletionOutcome("eosFound")).toBe(CompletionOutcome.NaturalStop);
	});
	it("maps stopStringFound → NaturalStop", () => {
		expect(classifyCompletionOutcome("stopStringFound")).toBe(CompletionOutcome.NaturalStop);
	});
	it("maps maxTokensReached → TruncatedTokens", () => {
		expect(classifyCompletionOutcome("maxTokensReached")).toBe(CompletionOutcome.TruncatedTokens);
	});
	it("maps maxPredictedTokensReached → TruncatedTokens", () => {
		expect(classifyCompletionOutcome("maxPredictedTokensReached")).toBe(CompletionOutcome.TruncatedTokens);
	});
	it("maps contextLengthReached → TruncatedContext (distinct from a token truncation)", () => {
		expect(classifyCompletionOutcome("contextLengthReached")).toBe(CompletionOutcome.TruncatedContext);
	});
	it("maps toolCalls → ToolCall", () => {
		expect(classifyCompletionOutcome("toolCalls")).toBe(CompletionOutcome.ToolCall);
	});
	it("maps userStopped → UserStopped", () => {
		expect(classifyCompletionOutcome("userStopped")).toBe(CompletionOutcome.UserStopped);
	});
	it("maps failed → Failed", () => {
		expect(classifyCompletionOutcome("failed")).toBe(CompletionOutcome.Failed);
	});
});

describe("classifyCompletionOutcome — normalization + robustness", () => {
	it("is case-insensitive and tolerant of spaces / underscores / hyphens", () => {
		expect(classifyCompletionOutcome("MAX_TOKENS")).toBe(CompletionOutcome.TruncatedTokens);
		expect(classifyCompletionOutcome("Max Tokens Reached")).toBe(CompletionOutcome.TruncatedTokens);
		expect(classifyCompletionOutcome("context-length-reached")).toBe(CompletionOutcome.TruncatedContext);
		expect(classifyCompletionOutcome("  eosFound  ")).toBe(CompletionOutcome.NaturalStop);
	});
	it("classifies compound / variant spellings via the substring fallback", () => {
		expect(classifyCompletionOutcome("stop:length")).toBe(CompletionOutcome.TruncatedTokens);
		expect(classifyCompletionOutcome("maxOutputTokensReached")).toBe(CompletionOutcome.TruncatedTokens);
		expect(classifyCompletionOutcome("model_refused_content")).toBe(CompletionOutcome.ContentFiltered);
	});
	it("prefers a context truncation over a token truncation when both words are present", () => {
		// A hypothetical verbose spelling — must NOT be mis-bucketed as a plain token truncation.
		expect(classifyCompletionOutcome("maxContextLengthReached")).toBe(CompletionOutcome.TruncatedContext);
	});
	it("returns Unknown for null / undefined / empty / unrecognized (conservative — not assumed complete)", () => {
		expect(classifyCompletionOutcome(null)).toBe(CompletionOutcome.Unknown);
		expect(classifyCompletionOutcome(undefined)).toBe(CompletionOutcome.Unknown);
		expect(classifyCompletionOutcome("")).toBe(CompletionOutcome.Unknown);
		expect(classifyCompletionOutcome("   ")).toBe(CompletionOutcome.Unknown);
		expect(classifyCompletionOutcome("banana")).toBe(CompletionOutcome.Unknown);
		// non-string input via an untyped boundary must not throw
		expect(classifyCompletionOutcome(42 as unknown as string)).toBe(CompletionOutcome.Unknown);
	});
});

describe("isTruncatedOutcome", () => {
	it("is true for both truncation outcomes", () => {
		expect(isTruncatedOutcome(CompletionOutcome.TruncatedTokens)).toBe(true);
		expect(isTruncatedOutcome(CompletionOutcome.TruncatedContext)).toBe(true);
	});
	it("is false for every non-truncation outcome", () => {
		for (const outcome of [
			CompletionOutcome.NaturalStop,
			CompletionOutcome.ToolCall,
			CompletionOutcome.ContentFiltered,
			CompletionOutcome.UserStopped,
			CompletionOutcome.Failed,
			CompletionOutcome.Unknown,
		]) {
			expect(isTruncatedOutcome(outcome)).toBe(false);
		}
	});
});

describe("deriveTruncationSignal", () => {
	it("flags a stop-reason truncation regardless of dialect (the §5.AA retry trigger)", () => {
		expect(deriveTruncationSignal({ rawReason: "length" })).toEqual({
			outcome: CompletionOutcome.TruncatedTokens,
			truncatedByStopReason: true,
			reasoningStarvedBudget: false,
			shouldRetryLarger: true,
		});
		expect(deriveTruncationSignal({ rawReason: "maxTokensReached" }).shouldRetryLarger).toBe(true);
		expect(deriveTruncationSignal({ rawReason: "contextLengthReached" }).shouldRetryLarger).toBe(true);
	});

	it("does NOT flag a clean natural stop or a tool call", () => {
		expect(deriveTruncationSignal({ rawReason: "eosFound" }).shouldRetryLarger).toBe(false);
		expect(deriveTruncationSignal({ rawReason: "tool_calls" }).shouldRetryLarger).toBe(false);
		expect(deriveTruncationSignal({ rawReason: "end_turn" }).truncatedByStopReason).toBe(false);
	});

	it("flags reasoning starvation when reasoning consumed ≥90% of the budget, even without a length stop", () => {
		// The endpoint reported a benign stop but reasoning ate the budget before a call could land.
		const signal = deriveTruncationSignal({ rawReason: "stop", reasoningTokens: 950, tokenBudget: 1000 });
		expect(signal.truncatedByStopReason).toBe(false);
		expect(signal.reasoningStarvedBudget).toBe(true);
		expect(signal.shouldRetryLarger).toBe(true);
	});

	it("does not flag starvation when reasoning is comfortably under the threshold", () => {
		const signal = deriveTruncationSignal({ rawReason: "stop", reasoningTokens: 200, tokenBudget: 1000 });
		expect(signal.reasoningStarvedBudget).toBe(false);
		expect(signal.shouldRetryLarger).toBe(false);
	});

	it("honors a custom reasoningStarvedFraction", () => {
		const at50 = deriveTruncationSignal({
			rawReason: "stop",
			reasoningTokens: 600,
			tokenBudget: 1000,
			reasoningStarvedFraction: 0.5,
		});
		expect(at50.reasoningStarvedBudget).toBe(true);
	});

	it("treats missing / non-finite / zero budget or tokens as no starvation (never a false positive)", () => {
		expect(deriveTruncationSignal({ rawReason: "stop", reasoningTokens: 950 }).reasoningStarvedBudget).toBe(false);
		expect(deriveTruncationSignal({ rawReason: "stop", tokenBudget: 1000 }).reasoningStarvedBudget).toBe(false);
		expect(
			deriveTruncationSignal({ rawReason: "stop", reasoningTokens: 950, tokenBudget: 0 }).reasoningStarvedBudget,
		).toBe(false);
		expect(
			deriveTruncationSignal({
				rawReason: "stop",
				reasoningTokens: Number.NaN,
				tokenBudget: 1000,
			}).reasoningStarvedBudget,
		).toBe(false);
	});

	it("classifies an unknown/absent stop reason as Unknown but still honors reasoning starvation", () => {
		const signal = deriveTruncationSignal({ rawReason: null, reasoningTokens: 999, tokenBudget: 1000 });
		expect(signal.outcome).toBe(CompletionOutcome.Unknown);
		expect(signal.reasoningStarvedBudget).toBe(true);
		expect(signal.shouldRetryLarger).toBe(true);
	});

	it("reproduces the chat-local-llm-adapter inline check (finish:length OR reasoning ≥90% budget)", () => {
		// Mirror of the two branches that adapter hard-codes today, now via the shared derivation.
		expect(deriveTruncationSignal({ rawReason: "length", tokenBudget: 1024 }).shouldRetryLarger).toBe(true);
		expect(
			deriveTruncationSignal({ rawReason: "stop", reasoningTokens: 930, tokenBudget: 1024 }).shouldRetryLarger,
		).toBe(true);
		expect(
			deriveTruncationSignal({ rawReason: "stop", reasoningTokens: 100, tokenBudget: 1024 }).shouldRetryLarger,
		).toBe(false);
	});
});
