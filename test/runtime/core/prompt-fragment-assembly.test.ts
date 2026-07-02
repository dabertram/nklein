import { describe, expect, it } from "vitest";
import {
	assemblePromptFragments,
	computeSharedPrefixRatio,
	type PromptFragment,
} from "../../../src/core/prompt-fragment-assembly";

const f = (key: string, volatility: PromptFragment["volatility"], text: string, pinned?: "head"): PromptFragment => ({
	key,
	volatility,
	text,
	...(pinned ? { pinned } : {}),
});

describe("assemblePromptFragments (W2.3b cache-stable prefix)", () => {
	it("orders fragments by ascending volatility regardless of input order", () => {
		const assembled = assemblePromptFragments([
			f("date", "daily", "DATE"),
			f("task-env", "task", "TASK"),
			f("rules", "static", "RULES"),
			f("config", "config", "CONFIG"),
		]);
		expect(assembled.orderedKeys).toEqual(["rules", "config", "date", "task-env"]);
		expect(assembled.text).toBe("RULES\n\nCONFIG\n\nDATE\n\nTASK");
	});

	it("keeps input order within one volatility class (caller controls intra-class layout)", () => {
		const assembled = assemblePromptFragments([f("b", "config", "B"), f("a", "config", "A")]);
		expect(assembled.orderedKeys).toEqual(["b", "a"]);
	});

	it("pins head fragments first and reports volatile pins (the visible cache cost)", () => {
		const assembled = assemblePromptFragments([f("rules", "static", "RULES"), f("base", "task", "BASE", "head")]);
		expect(assembled.orderedKeys).toEqual(["base", "rules"]);
		expect(assembled.text).toBe("BASE\n\nRULES");
		// A per-task head pin caps the shareable prefix at per-task churn — surfaced, never silent.
		expect(assembled.headPinnedVolatileKeys).toEqual(["base"]);
	});

	it("does not report a static head pin as a cache cost", () => {
		const assembled = assemblePromptFragments([f("base", "static", "BASE", "head"), f("date", "daily", "DATE")]);
		expect(assembled.headPinnedVolatileKeys).toEqual([]);
	});

	it("drops empty fragments entirely (no stray separators)", () => {
		const assembled = assemblePromptFragments([
			f("rules", "static", "RULES"),
			f("empty", "config", "   "),
			f("date", "daily", "DATE"),
		]);
		expect(assembled.orderedKeys).toEqual(["rules", "date"]);
		expect(assembled.text).toBe("RULES\n\nDATE");
	});

	it("is deterministic — same fragments in, same bytes out", () => {
		const build = () => [f("date", "daily", "D"), f("rules", "static", "R"), f("env", "task", "E")];
		expect(assemblePromptFragments(build()).text).toBe(assemblePromptFragments(build()).text);
	});
});

describe("computeSharedPrefixRatio (reuseRatio telemetry)", () => {
	it("is 1 for identical prompts and 0 for immediate divergence", () => {
		expect(computeSharedPrefixRatio("abc", "abc")).toBe(1);
		expect(computeSharedPrefixRatio("xbc", "abc")).toBe(0);
		expect(computeSharedPrefixRatio("", "abc")).toBe(0);
		expect(computeSharedPrefixRatio("abc", "")).toBe(0);
	});

	it("measures the volatile-suffix win: same rules+date, different task env ⇒ high reuse", () => {
		const previous = "RULES\n\nCONFIG\n\nDATE\n\nTASK-A";
		const next = "RULES\n\nCONFIG\n\nDATE\n\nTASK-B";
		expect(computeSharedPrefixRatio(previous, next)).toBeGreaterThan(0.8);
	});

	it("shows the failure mode the assembler prevents: volatile content up front ⇒ near-zero reuse", () => {
		const previous = "TASK-A\n\nRULES\n\nCONFIG\n\nDATE";
		const next = "TASK-B\n\nRULES\n\nCONFIG\n\nDATE";
		expect(computeSharedPrefixRatio(previous, next)).toBeLessThan(0.2);
	});

	it("is codepoint-safe for multi-byte content", () => {
		expect(computeSharedPrefixRatio("日本語テスト", "日本語テスト")).toBe(1);
		expect(computeSharedPrefixRatio("日本語A", "日本語B")).toBe(0.75);
	});
});
