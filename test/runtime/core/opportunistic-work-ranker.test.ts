import { describe, expect, it } from "vitest";
import {
	DRAFT_OPPORTUNISTIC_PRIORITY,
	type OpportunisticWorkKind,
	rankOpportunisticWork,
} from "../../../src/core/opportunistic-work-ranker";

describe("DRAFT opportunistic-work ranker (decision-11, held for approval)", () => {
	it("HARD veto: any real queued/active work suppresses ALL opportunistic work", () => {
		const verdict = rankOpportunisticWork({ hasRealQueuedWork: true, available: ["review", "work_ahead"] });
		expect(verdict.chosen).toBeNull();
		expect(verdict.reason).toMatch(/vetoed/i);
	});

	it("when idle, chooses the highest-priority AVAILABLE kind", () => {
		expect(rankOpportunisticWork({ hasRealQueuedWork: false, available: ["context_prep", "review"] }).chosen).toBe(
			"review",
		);
		expect(rankOpportunisticWork({ hasRealQueuedWork: false, available: ["spec_mirror", "work_ahead"] }).chosen).toBe(
			"work_ahead",
		);
		expect(rankOpportunisticWork({ hasRealQueuedWork: false, available: ["context_prep"] }).chosen).toBe(
			"context_prep",
		);
	});

	it("respects the full declared priority order", () => {
		// Feeding all kinds always yields the first in the priority list; removing it yields the next, and so on.
		let remaining: OpportunisticWorkKind[] = [...DRAFT_OPPORTUNISTIC_PRIORITY];
		for (const expected of DRAFT_OPPORTUNISTIC_PRIORITY) {
			expect(rankOpportunisticWork({ hasRealQueuedWork: false, available: remaining }).chosen).toBe(expected);
			remaining = remaining.filter((kind) => kind !== expected);
		}
	});

	it("idle with nothing available ⇒ null", () => {
		expect(rankOpportunisticWork({ hasRealQueuedWork: false, available: [] }).chosen).toBeNull();
	});

	it("review outranks work_ahead which outranks the speculative kinds (the proposed order)", () => {
		expect(DRAFT_OPPORTUNISTIC_PRIORITY.indexOf("review")).toBeLessThan(
			DRAFT_OPPORTUNISTIC_PRIORITY.indexOf("work_ahead"),
		);
		expect(DRAFT_OPPORTUNISTIC_PRIORITY.indexOf("work_ahead")).toBeLessThan(
			DRAFT_OPPORTUNISTIC_PRIORITY.indexOf("context_prep"),
		);
	});
});
