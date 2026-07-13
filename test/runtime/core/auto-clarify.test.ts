import { describe, expect, it, vi } from "vitest";
import {
	type AutoClarifyConfig,
	type AutoClarifyRound,
	type AutoClarifyTurnDeps,
	applyAutoClarifyDecision,
	DEFAULT_AUTO_CLARIFY_CONFIG,
	decideAutoClarifyStep,
	resolveAutoClarifyRoundBudget,
	runAutoClarifyLoop,
} from "../../../src/core/auto-clarify";
import type { NKleinPlanQuestion } from "../../../src/nklein-agent/nklein-plan-artifacts";

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
		blockedTaskId: null,
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

describe("runAutoClarifyLoop", () => {
	const question: NKleinPlanQuestion = {
		id: "q1",
		question: "Which database?",
		status: "open",
		options: [],
		answer: null,
		assumption: null,
		blockedTaskId: null,
	};
	const exactSimilarity = (a: string, b: string): number => (a.trim() === b.trim() ? 1 : 0);

	it("resolves with an answer once the architect is confident, skipping the reviewer on the final round", async () => {
		const review = vi.fn(async () => "looks fine");
		const deps: AutoClarifyTurnDeps = {
			propose: vi.fn(async (_question, rounds) =>
				rounds.length === 0
					? { proposal: "Maybe SQLite", resolved: false, selfReportedProgress: true }
					: { proposal: "Use SQLite (final)", resolved: true, selfReportedProgress: true },
			),
			review,
			similarity: exactSimilarity,
		};
		const result = await runAutoClarifyLoop(question, deps, DEFAULT_AUTO_CLARIFY_CONFIG);
		expect(result.decision.action).toBe("answer");
		expect(result.question.status).toBe("answered");
		expect(result.question.answer).toBe("Use SQLite (final)");
		// Reviewer was consulted on round 1 (non-final) but not the resolved round 2.
		expect(review).toHaveBeenCalledTimes(1);
		expect(result.rounds).toHaveLength(2);
	});

	it("gives up with an assumption when the architect stalls (converged + no self-progress)", async () => {
		const deps: AutoClarifyTurnDeps = {
			propose: vi.fn(async () => ({ proposal: "Use SQLite", resolved: false, selfReportedProgress: false })),
			review: vi.fn(async () => "no strong opinion"),
			similarity: exactSimilarity,
		};
		const result = await runAutoClarifyLoop(question, deps, {
			...DEFAULT_AUTO_CLARIFY_CONFIG,
			minRoundsBeforeStallCheck: 2,
		});
		expect(result.decision.action).toBe("give_up_with_assumption");
		expect(result.question.status).toBe("assumed-default");
		expect(result.question.assumption).toBe("Use SQLite");
	});

	it("terminates at the operator hard limit even if the architect never resolves", async () => {
		let n = 0;
		const deps: AutoClarifyTurnDeps = {
			propose: vi.fn(async () => {
				n += 1;
				return { proposal: `attempt ${n}`, resolved: false, selfReportedProgress: true };
			}),
			review: vi.fn(async () => "keep going"),
			similarity: () => 0,
		};
		const result = await runAutoClarifyLoop(question, deps, {
			...DEFAULT_AUTO_CLARIFY_CONFIG,
			userHardLimit: 3,
		});
		expect(result.decision.action).toBe("give_up_with_assumption");
		expect(result.rounds.length).toBeLessThanOrEqual(3);
	});
});
