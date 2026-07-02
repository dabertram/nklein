import { describe, expect, it } from "vitest";
import {
	buildDeliberationRecord,
	type DeliberationRound,
	runDeliberationLoop,
} from "../../../src/core/deliberation-loop";
import { shouldDeliberate } from "../../../src/core/deliberation-trigger";

const neverSimilar = () => 0;

describe("runDeliberationLoop (W4.1 — bounded propose→critique→resolve)", () => {
	it("resolves immediately on a confident proposal (the critic is skipped)", async () => {
		let critiques = 0;
		const result = await runDeliberationLoop("pick the storage design", {
			propose: async () => ({ proposal: "Use SQLite with WAL.", resolved: true, selfReportedProgress: true }),
			critique: async () => {
				critiques += 1;
				return "should not be called";
			},
			similarity: neverSimilar,
		});
		expect(result.outcome).toMatchObject({ action: "resolved", resolution: "Use SQLite with WAL." });
		expect(critiques).toBe(0);
		expect(result.rounds).toHaveLength(1);
	});

	it("refines through critique and resolves on a later round", async () => {
		const proposals = [
			{ proposal: "Plan A", resolved: false, selfReportedProgress: true },
			{ proposal: "Plan A, hardened per the critique", resolved: true, selfReportedProgress: true },
		];
		const result = await runDeliberationLoop("architecture fork", {
			propose: async (_s, rounds: readonly DeliberationRound[]) => proposals[rounds.length],
			critique: async () => "Plan A ignores the failure mode X.",
			similarity: neverSimilar,
		});
		expect(result.outcome.action).toBe("resolved");
		expect(result.rounds[0]?.critique).toContain("failure mode");
	});

	it("ends unresolved at the round budget (never unbounded)", async () => {
		const result = await runDeliberationLoop(
			"hard call",
			{
				propose: async () => ({ proposal: "Still torn.", resolved: false, selfReportedProgress: true }),
				critique: async () => "counterpoint",
				similarity: neverSimilar,
			},
			{ maxRounds: 3, noProgressSimilarityThreshold: 0.92, minRoundsBeforeStallCheck: 2 },
		);
		expect(result.outcome).toMatchObject({ action: "unresolved", bestProposal: "Still torn." });
		expect(result.rounds).toHaveLength(3);
	});

	it("the stall detector ends a converged, non-progressing debate early", async () => {
		const result = await runDeliberationLoop(
			"circular debate",
			{
				propose: async () => ({ proposal: "Same position.", resolved: false, selfReportedProgress: false }),
				critique: async () => "same critique",
				similarity: () => 0.99,
			},
			{ maxRounds: 10, noProgressSimilarityThreshold: 0.92, minRoundsBeforeStallCheck: 2 },
		);
		expect(result.outcome.action).toBe("unresolved");
		expect(result.rounds.length).toBeLessThan(10);
	});

	it("builds the ledger record with diversity provenance", async () => {
		const result = await runDeliberationLoop("kind test", {
			propose: async () => ({ proposal: "Done.", resolved: true, selfReportedProgress: true }),
			critique: async () => null,
			similarity: neverSimilar,
		});
		const record = buildDeliberationRecord({
			decisionKind: "decompose_plan",
			participants: [
				{ role: "proposer", modelId: "gpt-oss-120b", lineage: "gpt-oss" },
				{ role: "critic", modelId: "qwen3.5-9b", lineage: "qwen" },
			],
			diversityAchieved: true,
			result,
		});
		expect(record).toMatchObject({
			decisionKind: "decompose_plan",
			diversityAchieved: true,
			rounds: 1,
			resolution: "Done.",
		});
	});
});

describe("shouldDeliberate (the rare-fire trigger)", () => {
	const base = {
		stakes: "high" as const,
		confidence: "low" as const,
		diverseCriticAvailable: true,
		budgetRemaining: 3,
	};

	it("fires only on high-stakes + non-high-confidence + diverse critic + budget", () => {
		expect(shouldDeliberate(base).deliberate).toBe(true);
	});

	it("suppresses low/medium stakes (compute waste)", () => {
		expect(shouldDeliberate({ ...base, stakes: "low" }).deliberate).toBe(false);
		expect(shouldDeliberate({ ...base, stakes: "medium" }).deliberate).toBe(false);
	});

	it("suppresses when the decider is already confident", () => {
		expect(shouldDeliberate({ ...base, confidence: "high" }).deliberate).toBe(false);
	});

	it("suppresses WITH a surfaced diversity waiver when no diverse critic is loaded", () => {
		const decision = shouldDeliberate({ ...base, diverseCriticAvailable: false });
		expect(decision.deliberate).toBe(false);
		expect(decision).toMatchObject({ diversityWaived: true });
	});

	it("suppresses on an exhausted budget", () => {
		expect(shouldDeliberate({ ...base, budgetRemaining: 0 }).deliberate).toBe(false);
	});
});
