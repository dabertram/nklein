import { describe, expect, it } from "vitest";
import {
	type CandidateTest,
	type ChangedFile,
	type PrioritizeTestSelectionInput,
	prioritizeTestSelection,
} from "../../../src/core/test-selection-priority";

function changed(path: string, kind?: ChangedFile["kind"]): ChangedFile {
	return kind ? { path, kind } : { path };
}

function test(id: string, extra: Omit<CandidateTest, "id"> = {}): CandidateTest {
	return { id, ...extra };
}

function prioritize(input: Partial<PrioritizeTestSelectionInput> & Pick<PrioritizeTestSelectionInput, "tests">) {
	return prioritizeTestSelection({ changedFiles: [], ...input });
}

/** Ids in priority order (convenience). */
function orderIds(result: ReturnType<typeof prioritizeTestSelection>): string[] {
	return result.ordered.map((t) => t.id);
}

describe("prioritizeTestSelection — scoring & ordering", () => {
	it("returns an empty, well-formed result for no tests", () => {
		const result = prioritize({ tests: [] });
		expect(result.ordered).toEqual([]);
		expect(result.selected).toEqual([]);
		expect(result.deferred).toEqual([]);
		expect(result.counts.total).toBe(0);
		expect(result.selectedDurationMs).toBe(0);
		expect(result.summary).toMatch(/no candidate tests/i);
	});

	it("ranks a directly-impacted test above all non-impacted ones", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/foo.ts")],
			tests: [
				test("a", { files: ["src/core/bar.ts"] }),
				test("impacted", { files: ["src/core/foo.ts"] }),
				test("c", { files: ["src/core/baz.ts"] }),
			],
		});
		expect(orderIds(result)[0]).toBe("impacted");
		const impacted = result.ordered.find((t) => t.id === "impacted");
		expect(impacted?.signals.directlyImpacted).toBe(true);
		expect(impacted?.reason).toMatch(/touches a changed file/);
	});

	it("matches impact on ANY of a test's files", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/foo.ts")],
			tests: [test("multi", { files: ["src/core/other.ts", "src/core/foo.ts"] })],
		});
		expect(result.ordered[0]?.signals.directlyImpacted).toBe(true);
	});

	it("counts all change kinds (including deleted) as an impact", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/gone.ts", "deleted")],
			tests: [test("dependent", { files: ["src/core/gone.ts"] })],
		});
		expect(result.ordered[0]?.signals.directlyImpacted).toBe(true);
	});

	it("earns no impact signal when there are no changed files", () => {
		const result = prioritize({
			changedFiles: [],
			tests: [test("t", { files: ["src/core/foo.ts"] })],
		});
		expect(result.ordered[0]?.signals.directlyImpacted).toBe(false);
		expect(result.ordered[0]?.score).toBe(0);
	});

	it("does not penalise a test with unknown/empty files — it is simply not boosted", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/foo.ts")],
			tests: [test("no-files"), test("empty", { files: [] })],
		});
		for (const t of result.ordered) {
			expect(t.signals.directlyImpacted).toBe(false);
			expect(t.score).toBe(0);
		}
	});

	it("weights recent failures (capped) and orders more-failed first", () => {
		const result = prioritize({
			tests: [test("stable"), test("flaky-red", { recentFailures: 1 }), test("very-red", { recentFailures: 5 })],
		});
		expect(orderIds(result)).toEqual(["very-red", "flaky-red", "stable"]);
		// default recentFailure weight 20, cap 3 → very-red capped at 3*20 = 60.
		expect(result.ordered.find((t) => t.id === "very-red")?.score).toBe(60);
		expect(result.ordered.find((t) => t.id === "flaky-red")?.score).toBe(20);
	});

	it("boosts new/never-run tests", () => {
		const result = prioritize({ tests: [test("old"), test("new", { isNew: true })] });
		expect(orderIds(result)[0]).toBe("new");
		expect(result.ordered.find((t) => t.id === "new")?.score).toBe(15);
		expect(result.ordered.find((t) => t.id === "new")?.reason).toMatch(/new\/never-run/);
	});

	it("applies a small penalty (not a boost) for flakiness, scaled by flakeScore", () => {
		const result = prioritize({
			tests: [test("clean"), test("half-flaky", { flakeScore: 0.5 }), test("max-flaky", { flakeScore: 1 })],
		});
		// clean (0) > half-flaky (-5) > max-flaky (-10)
		expect(orderIds(result)).toEqual(["clean", "half-flaky", "max-flaky"]);
		expect(result.ordered.find((t) => t.id === "max-flaky")?.score).toBe(-10);
		expect(result.ordered.find((t) => t.id === "half-flaky")?.score).toBe(-5);
		expect(result.ordered.find((t) => t.id === "max-flaky")?.reason).toMatch(/flaky \(deprioritized\)/);
	});

	it("directly-impacted outranks a heavily-failing but non-impacted test", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/foo.ts")],
			tests: [test("impacted", { files: ["src/core/foo.ts"] }), test("red", { recentFailures: 3 })],
		});
		// impacted = 100 > red = 60
		expect(orderIds(result)[0]).toBe("impacted");
	});

	it("combines signals additively (impacted + recently-failed + new)", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/foo.ts")],
			tests: [test("combo", { files: ["src/core/foo.ts"], recentFailures: 2, isNew: true })],
		});
		// 100 + 2*20 + 15 = 155
		expect(result.ordered[0]?.score).toBe(155);
		const s = result.ordered[0]?.signals;
		expect(s).toEqual({ directlyImpacted: true, recentlyFailed: true, isNew: true, flaky: false });
	});
});

describe("prioritizeTestSelection — tie-breaks & determinism", () => {
	it("breaks equal scores toward the SHORTER last duration (fast feedback)", () => {
		const result = prioritize({
			tests: [test("slow", { lastDurationMs: 900 }), test("fast", { lastDurationMs: 100 })],
		});
		expect(orderIds(result)).toEqual(["fast", "slow"]);
	});

	it("treats unknown duration as slowest (sorts after a known-duration equal-score test)", () => {
		const result = prioritize({
			tests: [test("unknown"), test("known", { lastDurationMs: 500 })],
		});
		expect(orderIds(result)).toEqual(["known", "unknown"]);
		expect(result.ordered.find((t) => t.id === "unknown")?.lastDurationMs).toBeNull();
	});

	it("breaks a full tie (same score, same duration) by id ascending — stable & deterministic", () => {
		const result = prioritize({
			tests: [test("zeta", { lastDurationMs: 10 }), test("alpha", { lastDurationMs: 10 })],
		});
		expect(orderIds(result)).toEqual(["alpha", "zeta"]);
	});

	it("is deterministic regardless of input order", () => {
		const tests: CandidateTest[] = [
			test("d", { recentFailures: 1 }),
			test("a", { isNew: true }),
			test("c", { files: ["src/core/foo.ts"] }),
			test("b"),
		];
		const changedFiles = [changed("src/core/foo.ts")];
		const forward = orderIds(prioritize({ changedFiles, tests }));
		const reversed = orderIds(prioritize({ changedFiles, tests: [...tests].reverse() }));
		expect(forward).toEqual(reversed);
	});
});

describe("prioritizeTestSelection — dedup & robustness", () => {
	it("dedupes by id, last write wins", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/foo.ts")],
			tests: [test("t", { files: ["src/core/foo.ts"] }), test("t", {})],
		});
		expect(result.ordered).toHaveLength(1);
		// the later (non-impacted) entry wins → score 0
		expect(result.ordered[0]?.score).toBe(0);
		expect(result.ordered[0]?.signals.directlyImpacted).toBe(false);
	});

	it("clamps flakeScore to [0,1] and ignores non-finite / negative durations", () => {
		const result = prioritize({
			tests: [
				test("over", { flakeScore: 5 }),
				test("neg-dur", { lastDurationMs: -3 }),
				test("nan-dur", { lastDurationMs: Number.NaN }),
			],
		});
		// flakeScore clamped to 1 → penalty 10
		expect(result.ordered.find((t) => t.id === "over")?.score).toBe(-10);
		// invalid durations become null (treated as unknown)
		expect(result.ordered.find((t) => t.id === "neg-dur")?.lastDurationMs).toBeNull();
		expect(result.ordered.find((t) => t.id === "nan-dur")?.lastDurationMs).toBeNull();
	});

	it("ignores negative / non-finite recentFailures", () => {
		const result = prioritize({
			tests: [test("neg", { recentFailures: -2 }), test("nan", { recentFailures: Number.POSITIVE_INFINITY })],
		});
		expect(result.ordered.find((t) => t.id === "neg")?.score).toBe(0);
		expect(result.ordered.find((t) => t.id === "nan")?.score).toBe(0);
	});

	it("honours weight overrides", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/foo.ts")],
			tests: [test("impacted", { files: ["src/core/foo.ts"] }), test("red", { recentFailures: 1 })],
			weights: { directlyImpacted: 1, recentFailure: 50 },
		});
		// with these weights, the recently-failed test (50) now outranks the impacted one (1)
		expect(orderIds(result)[0]).toBe("red");
	});
});

describe("prioritizeTestSelection — subset carve-out (topN / timeBudget)", () => {
	it("selects ALL tests when neither bound is set", () => {
		const result = prioritize({ tests: [test("a"), test("b"), test("c")] });
		expect(result.selected).toHaveLength(3);
		expect(result.deferred).toHaveLength(0);
	});

	it("selected ++ deferred always reconstitutes ordered", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/foo.ts")],
			tests: [
				test("a", { files: ["src/core/foo.ts"] }),
				test("b", { recentFailures: 1 }),
				test("c", { isNew: true }),
				test("d"),
			],
			topN: 2,
		});
		expect([...result.selected, ...result.deferred].map((t) => t.id)).toEqual(orderIds(result));
	});

	it("honours topN, keeping the highest-priority prefix", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/foo.ts")],
			tests: [test("impacted", { files: ["src/core/foo.ts"] }), test("red", { recentFailures: 2 }), test("plain")],
			topN: 2,
		});
		expect(result.selected.map((t) => t.id)).toEqual(["impacted", "red"]);
		expect(result.deferred.map((t) => t.id)).toEqual(["plain"]);
		expect(result.counts.selected).toBe(2);
		expect(result.counts.deferred).toBe(1);
	});

	it("honours timeBudgetMs, filling in priority order and reporting the estimate", () => {
		const result = prioritize({
			// equal scores → ordered by duration asc: fast(100), mid(300), slow(500)
			tests: [
				test("slow", { lastDurationMs: 500 }),
				test("fast", { lastDurationMs: 100 }),
				test("mid", { lastDurationMs: 300 }),
			],
			timeBudgetMs: 450,
		});
		// fast(100) + mid(300) = 400 ≤ 450; slow would push to 900 → deferred
		expect(result.selected.map((t) => t.id)).toEqual(["fast", "mid"]);
		expect(result.deferred.map((t) => t.id)).toEqual(["slow"]);
		expect(result.selectedDurationMs).toBe(400);
	});

	it("applies BOTH bounds when given (a test must fit under each)", () => {
		const result = prioritize({
			tests: [
				test("fast", { lastDurationMs: 100 }),
				test("mid", { lastDurationMs: 100 }),
				test("more", { lastDurationMs: 100 }),
			],
			topN: 2,
			timeBudgetMs: 10_000,
		});
		// topN caps at 2 even though the budget could fit all three
		expect(result.selected).toHaveLength(2);
		expect(result.deferred).toHaveLength(1);
	});

	it("treats unknown duration as 0 cost for budgeting (cheap to admit)", () => {
		const result = prioritize({
			tests: [test("no-dur"), test("known", { lastDurationMs: 200 })],
			timeBudgetMs: 100,
		});
		// known(200) exceeds the 100 budget; no-dur costs 0 → admitted. Ordering: known first (dur 200 < unknown ∞),
		// but it doesn't fit → deferred; no-dur fits.
		expect(result.selected.map((t) => t.id)).toEqual(["no-dur"]);
		expect(result.deferred.map((t) => t.id)).toEqual(["known"]);
		expect(result.selectedDurationMs).toBe(0);
	});

	it("ignores invalid bounds (negative / non-finite) → selects all", () => {
		const result = prioritize({
			tests: [test("a"), test("b")],
			topN: -1,
			timeBudgetMs: Number.NaN,
		});
		expect(result.selected).toHaveLength(2);
	});

	it("topN of 0 selects nothing and defers everything", () => {
		const result = prioritize({ tests: [test("a"), test("b")], topN: 0 });
		expect(result.selected).toHaveLength(0);
		expect(result.deferred).toHaveLength(2);
	});
});

describe("prioritizeTestSelection — counts & summary", () => {
	it("counts each signal across the ordered set", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/foo.ts")],
			tests: [
				test("impacted", { files: ["src/core/foo.ts"] }),
				test("red", { recentFailures: 1 }),
				test("new", { isNew: true }),
				test("flaky", { flakeScore: 0.4 }),
				test("plain"),
			],
		});
		expect(result.counts).toMatchObject({
			total: 5,
			directlyImpacted: 1,
			recentlyFailed: 1,
			isNew: 1,
			flaky: 1,
		});
	});

	it("produces a human-readable summary naming the selection", () => {
		const result = prioritize({
			changedFiles: [changed("src/core/foo.ts")],
			tests: [test("impacted", { files: ["src/core/foo.ts"], lastDurationMs: 120 })],
		});
		expect(result.summary).toMatch(/run 1\/1 test/i);
		expect(result.summary).toMatch(/1 impacted/);
		expect(result.summary).toMatch(/120 ms/);
	});
});
