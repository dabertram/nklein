import { describe, expect, it } from "vitest";

import {
	buildKanbanContextPressurePolicy,
	buildKanbanContextSafetyBudgets,
	buildKanbanEfficiencyRules,
} from "./nklein-task-session-service";

describe("buildKanbanContextSafetyBudgets", () => {
	it("keeps file chunks safely below an 80k active context window", () => {
		expect(buildKanbanContextSafetyBudgets(80_000)).toEqual({
			contextWindow: 80_000,
			outputReserveTokens: 8_000,
			promptOverheadReserveTokens: 12_000,
			safeWorkingBudget: 60_000,
			fileChunkTokenBudget: 36_000,
			fileChunkContentTokenBudget: 35_000,
			fileChunkCharBudget: 144_000,
		});
	});

	it("uses conservative chunk sizes when the model context is unknown", () => {
		expect(buildKanbanContextSafetyBudgets(null)).toMatchObject({
			contextWindow: null,
			outputReserveTokens: 8_000,
			promptOverheadReserveTokens: 12_000,
			safeWorkingBudget: null,
			fileChunkTokenBudget: 12_000,
			fileChunkContentTokenBudget: 11_000,
			fileChunkCharBudget: 48_000,
		});
	});

	it("keeps useful working room for 8k and 16k target models", () => {
		const eightK = buildKanbanContextSafetyBudgets(8_000);
		const sixteenK = buildKanbanContextSafetyBudgets(16_000);
		const eightKSafeWorkingBudget = eightK.safeWorkingBudget ?? 0;
		const sixteenKSafeWorkingBudget = sixteenK.safeWorkingBudget ?? 0;

		expect(eightKSafeWorkingBudget).toBeGreaterThan(0);
		expect(eightK.fileChunkTokenBudget).toBeLessThanOrEqual(Math.floor(eightKSafeWorkingBudget * 0.6));
		expect(sixteenKSafeWorkingBudget).toBeGreaterThan(8_000);
		expect(sixteenK.fileChunkTokenBudget).toBeLessThanOrEqual(Math.floor(sixteenKSafeWorkingBudget * 0.6));
	});
});

describe("buildKanbanContextPressurePolicy", () => {
	it("keeps richer retrieval budgets for large fast windows", () => {
		const policy = buildKanbanContextPressurePolicy({
			contextWindow: 80_000,
			wallTimeMsPer1kPromptTokens: 250,
		});

		expect(policy.pressure).toBe("low");
		expect(policy.repoMapTokenBudget).toBeGreaterThanOrEqual(1_000);
		expect(policy.retrievalResultTokenBudget).toBeGreaterThanOrEqual(3_000);
		expect(policy.compactionTriggerRatio).toBeGreaterThan(0.7);
	});

	it("tightens retrieval and compaction pressure for small or slow models", () => {
		const policy = buildKanbanContextPressurePolicy({
			contextWindow: 8_000,
			wallTimeMsPer1kPromptTokens: 3_500,
		});

		expect(policy.pressure).toBe("high");
		expect(policy.repoMapTokenBudget).toBeLessThanOrEqual(500);
		expect(policy.retrievalResultTokenBudget).toBeLessThanOrEqual(900);
		expect(policy.compactionTriggerRatio).toBeLessThanOrEqual(0.62);
	});
});

describe("buildKanbanEfficiencyRules", () => {
	it("offers requirements extraction as an optional reasoning-selected prompt pack", () => {
		const rules = buildKanbanEfficiencyRules({
			contextScope: "smart",
			contextWindow: 80_000,
			timeoutMode: "long",
		});

		expect(rules).toContain("## Adaptive Prompt Selection");
		expect(rules).toContain("Apply a pack only when its description matches the requested work");
		expect(rules).toContain("Do not keyword-match mechanically");
		expect(rules).toContain("Available optional pack: Requirements Extraction Rules");
		expect(rules).toContain("## Requirements Extraction Rules");
		expect(rules).toContain("reconstruct the latest agreed requirements");
		expect(rules).toContain("Maintain a compact requirements ledger");
		expect(rules).toContain("explicit source facts, latest accepted requirements, superseded older requirements");
		expect(rules).toContain("Do not invent concrete details");
		expect(rules).toContain("Preserve important conceptual boundaries");
		expect(rules).toContain("self-audit for hallucinated details");
	});

	it("requires EOF coverage before summarizing large files", () => {
		const rules = buildKanbanEfficiencyRules({
			contextScope: "smart",
			contextWindow: 256_000,
			timeoutMode: "unlimited",
		});

		expect(rules).toContain("coverage ledger");
		expect(rules).toContain("use `read_large_file` with a workflow cursor");
		expect(rules).toContain("Make exactly one `read_large_file` call per assistant response");
		expect(rules).toContain("never call it in parallel");
		expect(rules).toContain("stitching verification");
		expect(rules).toContain("If tool output is truncated, clipped, summarized, or hits a limit");
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
		expect(rules).toContain("first use `list_files` or `find_files`, then `get_file_size`");
		expect(rules).toContain("Treat discovery output as metadata only");
		expect(rules).toContain("Never call a write tool with only a path");
	});

	it("instructs agents to select deterministic line chunks from token estimates", () => {
		const rules = buildKanbanEfficiencyRules({
			contextScope: "smart",
			contextWindow: 80_000,
			timeoutMode: "long",
		});

		expect(rules).toContain("Backend approval will tokenize the selected text");
		expect(rules).toContain("target about 70% of the 144k character budget");
		expect(rules).toContain("do not default to tiny 300-line starters");
		expect(rules).toContain("A rejected read covers zero lines");
		expect(rules).toContain("shrinking by at least half or to the suggested line count");
		expect(rules).toContain("set the next unread line to the successful `end_line + 1`");
		expect(rules).toContain("Never skip from a failed 1-N attempt to N+1");
		expect(rules).toContain("Grow chunk sizes slowly from the last successful read");
		expect(rules).toContain("at or below about 35k tokens (36k total read budget including tool/result framing)");
		expect(rules).toContain("floor(0.7 * chunk character budget / bytes per line)");
		expect(rules).toContain("explicit inclusive `start_line` and `end_line` values");
		expect(rules).toContain("Prefer non-overlapping primary chunks");
		expect(rules).toContain("explicitly inspect stitching areas around each chunk boundary");
		expect(rules).toContain(
			"Safe working budget after output reserve and prompt overhead reserve: 60,000 tokens (~60k)",
		);
	});

	it("keeps the generated efficiency prompt itself small", () => {
		const rules = buildKanbanEfficiencyRules({
			contextScope: "smart",
			contextWindow: 80_000,
			timeoutMode: "long",
		});
		const estimatedPromptTokens = Math.ceil(rules.length / 4);

		expect(estimatedPromptTokens).toBeLessThanOrEqual(2_300);
	});
});
