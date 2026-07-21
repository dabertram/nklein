import { describe, expect, it } from "vitest";
import {
	buildContextIntegrityCases,
	buildContextIntegrityPrompts,
	CONTEXT_INTEGRITY_MDE_POINTS,
	CONTEXT_INTEGRITY_TASK_COUNT,
	type ContextIntegrityArm,
	type ContextIntegrityObservation,
	orderContextIntegrityPrompts,
	scoreContextIntegrityAnswer,
	summarizeContextIntegrityExperiment,
} from "../../../src/core/context-integrity-experiment";

describe("context integrity experiment", () => {
	it("pre-registers 20 distinct paired tasks and six complete arms", () => {
		const cases = buildContextIntegrityCases();
		const prompts = buildContextIntegrityPrompts();
		expect(cases).toHaveLength(CONTEXT_INTEGRITY_TASK_COUNT);
		expect(new Set(cases.map((case_) => case_.id)).size).toBe(CONTEXT_INTEGRITY_TASK_COUNT);
		expect(prompts).toHaveLength(CONTEXT_INTEGRITY_TASK_COUNT * 6);
		for (const case_ of cases) {
			expect(
				prompts
					.filter((prompt) => prompt.caseId === case_.id)
					.map((prompt) => prompt.arm)
					.sort(),
			).toEqual(["fact_list", "narrative", "raw_50", "raw_75", "raw_90", "shuffled_facts"]);
		}
	});

	it("counterbalances arm positions across the run", () => {
		const ordered = orderContextIntegrityPrompts(buildContextIntegrityPrompts());
		const positions = new Map<string, number[]>();
		for (let index = 0; index < ordered.length; index += 1) {
			const prompt = ordered[index];
			if (!prompt) continue;
			const values = positions.get(prompt.arm) ?? Array.from({ length: 6 }, () => 0);
			values[index % 6] = (values[index % 6] ?? 0) + 1;
			positions.set(prompt.arm, values);
		}
		for (const values of positions.values()) {
			expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
		}
	});

	it("scores only the three case-specific contract fragments", () => {
		const case_ = buildContextIntegrityCases()[0];
		expect(case_).toBeDefined();
		if (!case_) throw new Error("missing fixture");
		expect(scoreContextIntegrityAnswer(case_, case_.expectedFragments.join(" | "))).toBe(1);
		expect(scoreContextIntegrityAnswer(case_, case_.expectedFragments[0] ?? "")).toBeCloseTo(1 / 3);
	});

	it("reports a measured knee and format winner only at the pre-registered 25-point effect", () => {
		const arms: readonly ContextIntegrityArm[] = [
			"raw_50",
			"raw_75",
			"raw_90",
			"narrative",
			"fact_list",
			"shuffled_facts",
		];
		const rows: ContextIntegrityObservation[] = [];
		for (let task = 0; task < CONTEXT_INTEGRITY_TASK_COUNT; task += 1) {
			for (const arm of arms) {
				rows.push({
					caseId: `t${task}`,
					arm,
					score: arm === "fact_list" || (arm.startsWith("raw_") && arm !== "raw_90") ? 1 : 0.5,
					latencyMs: 10,
					promptTokens: arm === "raw_90" ? 29_000 : arm.startsWith("raw_") ? 20_000 : 1_000,
					infraError: null,
				});
			}
		}
		const summary = summarizeContextIntegrityExperiment(rows);
		expect(summary.preRegistration.verdict).toBe("adequately_powered");
		expect(summary.measuredCompactionThreshold).toBeCloseTo(29_000 / 32_768);
		expect(summary.formatDecision).toBe("winner");
		expect(summary.formatWinner).toBe("fact_list");
		expect(summary.formatMarginPoints).toBeGreaterThanOrEqual(CONTEXT_INTEGRITY_MDE_POINTS);
	});

	it("leaves small format differences unresolved", () => {
		const rows = buildContextIntegrityPrompts().map((prompt) => ({
			caseId: prompt.caseId,
			arm: prompt.arm,
			score: prompt.arm === "fact_list" ? 1 : 0.9,
			latencyMs: 10,
			promptTokens: 1_000,
			infraError: null,
		}));
		expect(summarizeContextIntegrityExperiment(rows).formatDecision).toBe("unresolved");
	});
});
