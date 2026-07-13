import { describe, expect, it } from "vitest";
import {
	buildOpportunisticWorkOutcomeEvent,
	decideOpportunisticBudget,
	OPPORTUNISTIC_WORK_DECISION,
	summarizeOpportunisticValue,
} from "../../../src/core/opportunistic-work-value";

/**
 * F1.36 — the background-budget gate (concurrency cap + trailing-hour dispatch budget) and realized-value
 * recording (ledger retention + the per-kind realized-rate projection).
 */

describe("decideOpportunisticBudget", () => {
	it("caps concurrent opportunistic actions first", () => {
		expect(decideOpportunisticBudget({ now: 10_000_000, recentDispatchAts: [], activeCount: 1 })).toEqual({
			allow: false,
			reason: "concurrent_cap",
		});
		expect(decideOpportunisticBudget({ now: 10_000_000, recentDispatchAts: [], activeCount: 0 })).toEqual({
			allow: true,
		});
	});

	it("enforces the trailing-hour dispatch budget and forgets older dispatches", () => {
		const now = 10_000_000_000;
		const withinHour = Array.from({ length: 6 }, (_, index) => now - (index + 1) * 60_000);
		expect(decideOpportunisticBudget({ now, recentDispatchAts: withinHour, activeCount: 0 })).toEqual({
			allow: false,
			reason: "hourly_budget",
		});
		const staleDispatches = withinHour.map((at) => at - 3_600_000);
		expect(decideOpportunisticBudget({ now, recentDispatchAts: staleDispatches, activeCount: 0 })).toEqual({
			allow: true,
		});
		// A tighter custom budget applies.
		expect(
			decideOpportunisticBudget({ now, recentDispatchAts: [now - 1_000], activeCount: 0, maxPerHour: 1 }),
		).toEqual({ allow: false, reason: "hourly_budget" });
	});
});

describe("realized-value recording", () => {
	it("retains outcomes and folds them into a per-kind realized-rate scorecard", () => {
		const hash = "hash1234hash1234";
		const events = [
			buildOpportunisticWorkOutcomeEvent({
				workspacePathHash: hash,
				kind: "review",
				targetRef: "card-1",
				outcome: "realized",
				detail: "idle review completed",
				recordedAt: 1,
			}),
			buildOpportunisticWorkOutcomeEvent({
				workspacePathHash: hash,
				kind: "review",
				targetRef: "card-2",
				outcome: "error",
				detail: "review runner threw",
				recordedAt: 2,
			}),
			buildOpportunisticWorkOutcomeEvent({
				workspacePathHash: hash,
				kind: "re_eval",
				targetRef: "worker|easy|qwen3-8b",
				outcome: "no_value",
				recordedAt: 3,
			}),
		];
		expect(events[0].controllerDecision).toBe(OPPORTUNISTIC_WORK_DECISION);
		expect(events[0].taskId).toBe("review:card-1");
		expect(events[0].to).toBe("opportunistic_realized");

		const summary = summarizeOpportunisticValue(events);
		expect(summary).toEqual([
			{ kind: "re_eval", dispatched: 1, realized: 0, noValue: 1, errored: 0, realizedRate: 0 },
			{ kind: "review", dispatched: 2, realized: 1, noValue: 0, errored: 1, realizedRate: 0.5 },
		]);
	});

	it("ignores unrelated ledger events and keeps target refs containing separators intact", () => {
		const event = buildOpportunisticWorkOutcomeEvent({
			workspacePathHash: "hash1234hash1234",
			kind: "re_eval",
			targetRef: "worker:easy:qwen3-8b", // colons in the ref must not confuse the kind fold
			outcome: "realized",
			recordedAt: 4,
		});
		const summary = summarizeOpportunisticValue([event]);
		expect(summary).toEqual([
			{ kind: "re_eval", dispatched: 1, realized: 1, noValue: 0, errored: 0, realizedRate: 1 },
		]);
	});
});
