import { describe, expect, it } from "vitest";
import {
	assemblePromptFragments,
	assemblePromptFragmentsForIntent,
	computeSharedPrefixRatio,
	type PromptFragment,
	selectPromptFragmentsForIntent,
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

describe("selectPromptFragmentsForIntent / assemblePromptFragmentsForIntent (F4.39)", () => {
	const tiered: PromptFragment[] = [
		{ key: "base", volatility: "static", text: "BASE", invariant: true },
		{ key: "essential", volatility: "static", text: "ESS", tier: "essential" },
		{ key: "standard", volatility: "config", text: "STD", tier: "standard" },
		{ key: "enriching", volatility: "task", text: "ENR", tier: "enriching" },
		{ key: "untagged", volatility: "static", text: "UNTAGGED" },
	];

	it("minimize keeps only invariants + essentials (+ untagged, which defaults to essential)", () => {
		const kept = selectPromptFragmentsForIntent(tiered, "minimize").map((frag) => frag.key);
		expect(kept).toEqual(["base", "essential", "untagged"]);
	});

	it("balance adds standard; max_task_info keeps everything", () => {
		expect(selectPromptFragmentsForIntent(tiered, "balance").map((frag) => frag.key)).toEqual([
			"base",
			"essential",
			"standard",
			"untagged",
		]);
		expect(selectPromptFragmentsForIntent(tiered, "max_task_info")).toHaveLength(5);
	});

	it("an UN-TIERED fragment set is byte-identical in every mode (opt-in, safe adoption)", () => {
		const untagged: PromptFragment[] = [
			{ key: "a", volatility: "static", text: "A" },
			{ key: "b", volatility: "config", text: "B" },
		];
		const direct = assemblePromptFragments(untagged).text;
		expect(assemblePromptFragmentsForIntent(untagged, "minimize").text).toBe(direct);
		expect(assemblePromptFragmentsForIntent(untagged, "balance").text).toBe(direct);
		expect(assemblePromptFragmentsForIntent(untagged, "max_task_info").text).toBe(direct);
	});

	it("max_task_info assembly equals assembling all fragments directly (byte-identical default)", () => {
		expect(assemblePromptFragmentsForIntent(tiered, "max_task_info").text).toBe(assemblePromptFragments(tiered).text);
	});

	it("minimize actually drops the enriching/standard bytes", () => {
		const text = assemblePromptFragmentsForIntent(tiered, "minimize").text;
		expect(text).toContain("ESS");
		expect(text).not.toContain("STD");
		expect(text).not.toContain("ENR");
	});
});
