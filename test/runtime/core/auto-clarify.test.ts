import { describe, expect, it } from "vitest";
import {
	type AutoClarifyConfig,
	type AutoClarifyRound,
	applyAutoClarifyDecision,
	DEFAULT_AUTO_CLARIFY_CONFIG,
	decideAutoClarifyStep,
	resolveAutoClarifyRoundBudget,
} from "../../../src/core/auto-clarify";
import type { NKleinPlanQuestion } from "../../../src/nklein-sdk/nklein-plan-artifacts";

function round(overrides: Partial<AutoClarifyRound> = {}): AutoClarifyRound {
	return {
		proposal: "Use SQLite for local persistence.",
		reviewerOpinion: null,
		selfReportedProgress: true,
		resolved: false,
		...overrides,
	};
}

const exactSimilarity = (a: string, b: string): number => (a.trim() === b.trim() ? 1 : 0);

describe("decideAutoClarifyStep", () => {
	it("keeps asking when there are no rounds yet", () => {
		expect(decideAutoClarifyStep([], DEFAULT_AUTO_CLARIFY_CONFIG, exactSimilarity)).toMatchObject({
			action: "keep_asking",
		});
	});

	it("answers immediately when the architect declares a confident answer", () => {
		const decision = decideAutoClarifyStep(
			[round({ resolved: true, proposal: "Postgres via a local container." })],
			DEFAULT_AUTO_CLARIFY_CONFIG,
			exactSimilarity,
		);
		expect(decision).toEqual({
			action: "answer",
			answer: "Postgres via a local container.",
			reason: expect.any(String),
		});
	});

	it("keeps asking while proposals are still progressing", () => {
		const rounds = [
			round({ proposal: "Maybe SQLite." }),
			round({ proposal: "SQLite, but consider Postgres for concurrency." }),
			round({ proposal: "SQLite for v1; document the Postgres migration path.", selfReportedProgress: true }),
		];
		expect(decideAutoClarifyStep(rounds, DEFAULT_AUTO_CLARIFY_CONFIG, exactSimilarity)).toMatchObject({
			action: "keep_asking",
		});
	});

	it("gives up with an assumption when consecutive proposals converge and the agent self-reports no progress", () => {
		const rounds = [
			round({ proposal: "A." }),
			round({ proposal: "B." }),
			round({ proposal: "Final: use SQLite.", selfReportedProgress: false }),
			round({ proposal: "Final: use SQLite.", selfReportedProgress: false }),
		];
		const decision = decideAutoClarifyStep(rounds, DEFAULT_AUTO_CLARIFY_CONFIG, exactSimilarity);
		expect(decision).toMatchObject({ action: "give_up_with_assumption", assumption: "Final: use SQLite." });
	});

	it("does NOT stall when proposals converge but the agent still reports progress", () => {
		const rounds = [
			round({ proposal: "X." }),
			round({ proposal: "Same.", selfReportedProgress: true }),
			round({ proposal: "Same.", selfReportedProgress: true }),
		];
		expect(decideAutoClarifyStep(rounds, DEFAULT_AUTO_CLARIFY_CONFIG, exactSimilarity)).toMatchObject({
			action: "keep_asking",
		});
	});

	it("gives up at the round budget, tightened by the operator hard limit", () => {
		const config: AutoClarifyConfig = { ...DEFAULT_AUTO_CLARIFY_CONFIG, userHardLimit: 3 };
		const rounds = [round({ proposal: "p1" }), round({ proposal: "p2" }), round({ proposal: "p3" })];
		const decision = decideAutoClarifyStep(rounds, config, () => 0);
		expect(decision).toMatchObject({ action: "give_up_with_assumption", assumption: "p3" });
	});

	it("resolves the round budget from the safety cap and a positive hard limit", () => {
		expect(resolveAutoClarifyRoundBudget(DEFAULT_AUTO_CLARIFY_CONFIG)).toBe(30);
		expect(resolveAutoClarifyRoundBudget({ ...DEFAULT_AUTO_CLARIFY_CONFIG, userHardLimit: 5 })).toBe(5);
		expect(resolveAutoClarifyRoundBudget({ ...DEFAULT_AUTO_CLARIFY_CONFIG, safetyCap: 4, userHardLimit: 10 })).toBe(
			4,
		);
	});
});

describe("applyAutoClarifyDecision", () => {
	const baseQuestion: NKleinPlanQuestion = {
		id: "q1",
		question: "Which database?",
		status: "open",
		options: [],
		answer: null,
		assumption: null,
	};

	it("records a confident answer", () => {
		const next = applyAutoClarifyDecision(baseQuestion, {
			action: "answer",
			answer: "SQLite",
			reason: "done",
		});
		expect(next).toMatchObject({ status: "answered", answer: "SQLite", assumption: null });
	});

	it("records an assumed default that stays inspectable", () => {
		const next = applyAutoClarifyDecision(baseQuestion, {
			action: "give_up_with_assumption",
			assumption: "SQLite for now",
			reason: "stalled",
		});
		expect(next).toMatchObject({ status: "assumed-default", assumption: "SQLite for now" });
	});

	it("leaves a question open while still asking", () => {
		const next = applyAutoClarifyDecision(baseQuestion, { action: "keep_asking", reason: "more" });
		expect(next.status).toBe("open");
	});
});
