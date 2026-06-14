import { describe, expect, it } from "vitest";

import { buildKanbanContextSafetyBudgets, buildKanbanEfficiencyRules } from "./cline-task-session-service";

describe("buildKanbanContextSafetyBudgets", () => {
	it("keeps file chunks safely below an 80k active context window", () => {
		expect(buildKanbanContextSafetyBudgets(80_000)).toEqual({
			contextWindow: 80_000,
			outputReserveTokens: 24_000,
			promptOverheadReserveTokens: 12_000,
			safeWorkingBudget: 44_000,
			fileChunkTokenBudget: 6_600,
			fileChunkContentTokenBudget: 5_600,
			fileChunkCharBudget: 26_400,
		});
	});

	it("uses conservative chunk sizes when the model context is unknown", () => {
		expect(buildKanbanContextSafetyBudgets(null)).toMatchObject({
			contextWindow: null,
			outputReserveTokens: 24_000,
			promptOverheadReserveTokens: 12_000,
			safeWorkingBudget: null,
			fileChunkTokenBudget: 8_000,
			fileChunkContentTokenBudget: 7_000,
			fileChunkCharBudget: 32_000,
		});
	});
});

describe("buildKanbanEfficiencyRules", () => {
	it("requires EOF coverage before summarizing large files", () => {
		const rules = buildKanbanEfficiencyRules({
			contextScope: "smart",
			contextWindow: 256_000,
			timeoutMode: "unlimited",
		});

		expect(rules).toContain("coverage ledger");
		expect(rules).toContain("record `wc -l` and `wc -c` before reading");
		expect(rules).toContain("unread line ranges");
		expect(rules).toContain("If a tool output is truncated, clipped, summarized, or hits an output limit");
		expect(rules).toContain("final line is confirmed");
		expect(rules).toContain(
			"Never summarize, infer a spec, or move on from a source file until the ledger shows the file has been read through EOF.",
		);
		expect(rules).toContain("every included file has EOF-confirmed coverage");
		expect(rules).toContain("resume from the last confirmed line");
		expect(rules).toContain("Treat an incomplete pass as incomplete work");
		expect(rules).toContain("Treat this as the authoritative upper bound for prompt planning");
		expect(rules).toContain("Safe working budget after output reserve and prompt overhead reserve");
		expect(rules).toContain("Prefer the smallest slice that fully answers the immediate question");
	});

	it("instructs agents to select deterministic line chunks from token estimates", () => {
		const rules = buildKanbanEfficiencyRules({
			contextScope: "smart",
			contextWindow: 80_000,
			timeoutMode: "long",
		});

		expect(rules).toContain("Backend approval tokenizes selected `read_files` content");
		expect(rules).toContain("Backend approval will tokenize the selected text");
		expect(rules).toContain("shrink the requested line count by at least half or to the suggested line count");
		expect(rules).toContain("at or below about 6k tokens (7k total read budget including tool/result framing)");
		expect(rules).toContain("Choose chunk line ranges from the measured average bytes per line");
		expect(rules).toContain("explicit inclusive `start_line` and `end_line` values");
		expect(rules).toContain("Prefer non-overlapping primary chunks");
		expect(rules).toContain("explicitly inspect stitching areas around each chunk boundary");
		expect(rules).toContain(
			"Safe working budget after output reserve and prompt overhead reserve: 44,000 tokens (~44k)",
		);
	});

	it("keeps the generated efficiency prompt itself small", () => {
		const rules = buildKanbanEfficiencyRules({
			contextScope: "smart",
			contextWindow: 80_000,
			timeoutMode: "long",
		});
		const estimatedPromptTokens = Math.ceil(rules.length / 4);

		expect(estimatedPromptTokens).toBeLessThanOrEqual(1_500);
	});
});
