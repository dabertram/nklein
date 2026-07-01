import { describe, expect, it } from "vitest";
import {
	type ClassifyTestRegressionInput,
	classifyTestRegression,
	regressionGateDecision,
	type TestResultRecord,
} from "../../../src/core/test-regression-verdict";

function fail(id: string, recentHistory?: readonly boolean[]): TestResultRecord {
	return { id, passed: false, ...(recentHistory ? { recentHistory } : {}) };
}
function pass(id: string, recentHistory?: readonly boolean[]): TestResultRecord {
	return { id, passed: true, ...(recentHistory ? { recentHistory } : {}) };
}
function classify(input: Partial<ClassifyTestRegressionInput> & Pick<ClassifyTestRegressionInput, "current">) {
	return classifyTestRegression({ baselineFailingIds: [], ...input });
}

describe("classifyTestRegression", () => {
	it("reports clean when every current test passes", () => {
		const result = classify({ current: [pass("a"), pass("b"), pass("c")] });
		expect(result.verdict).toBe("clean");
		expect(result.failures).toEqual([]);
		expect(result.newFailureIds).toEqual([]);
		expect(result.counts).toMatchObject({ totalTests: 3, passed: 3, failed: 0, newFailures: 0 });
		expect(result.summary).toContain("Clean");
	});

	it("attributes a failure with no baseline and no history as a NEW failure → regressed", () => {
		const result = classify({ current: [pass("a"), fail("b")] });
		expect(result.verdict).toBe("regressed");
		expect(result.failures).toEqual([{ id: "b", attribution: "new_failure" }]);
		expect(result.newFailureIds).toEqual(["b"]);
		expect(result.counts).toMatchObject({ passed: 1, failed: 1, newFailures: 1 });
		expect(result.summary).toContain("REGRESSED");
		expect(result.summary).toContain("b");
	});

	it("attributes a failure already failing on the baseline as PRE-EXISTING (not charged to the change)", () => {
		const result = classify({ current: [pass("a"), fail("b")], baselineFailingIds: ["b"] });
		expect(result.verdict).toBe("pre_existing_failures");
		expect(result.failures).toEqual([{ id: "b", attribution: "pre_existing" }]);
		expect(result.preExistingIds).toEqual(["b"]);
		expect(result.newFailureIds).toEqual([]);
		expect(result.summary).toContain("No new failures");
	});

	it("regressed when a NEW failure sits alongside a pre-existing one (only the new one is decisive)", () => {
		const result = classify({
			current: [fail("old"), fail("new"), pass("ok")],
			baselineFailingIds: ["old"],
		});
		expect(result.verdict).toBe("regressed");
		expect(result.newFailureIds).toEqual(["new"]);
		expect(result.preExistingIds).toEqual(["old"]);
		// Sorted new_failure before pre_existing.
		expect(result.failures.map((f) => f.attribution)).toEqual(["new_failure", "pre_existing"]);
		expect(result.summary).toContain("1 pre-existing");
	});

	it("treats an intermittent test (mixed recent history) as a FLAKE, not a new failure", () => {
		const result = classify({ current: [fail("flaky", [true, false, true])] });
		expect(result.verdict).toBe("pre_existing_failures");
		expect(result.failures).toEqual([{ id: "flaky", attribution: "flake" }]);
		expect(result.flakeIds).toEqual(["flaky"]);
		expect(result.newFailureIds).toEqual([]);
		expect(result.summary).toContain("flaky");
	});

	it("does NOT call a test flaky when its history is all-failing (consistently red = new failure here)", () => {
		const result = classify({ current: [fail("red", [false, false, false])] });
		expect(result.verdict).toBe("regressed");
		expect(result.failures).toEqual([{ id: "red", attribution: "new_failure" }]);
	});

	it("respects flakeMinHistory — a single prior sample is not enough evidence of intermittency", () => {
		// One-sample mixed history is impossible; a 2-sample [pass, fail] history needs minHistory ≤ 2 to count.
		const twoSample = [true, false];
		expect(classify({ current: [fail("t", twoSample)], flakeMinHistory: 2 }).flakeIds).toEqual(["t"]);
		expect(classify({ current: [fail("t", twoSample)], flakeMinHistory: 3 }).newFailureIds).toEqual(["t"]);
	});

	it("clamps a non-finite / sub-1 flakeMinHistory to 1", () => {
		const hist = [true, false];
		expect(classify({ current: [fail("t", hist)], flakeMinHistory: 0 }).flakeIds).toEqual(["t"]);
		expect(classify({ current: [fail("t", hist)], flakeMinHistory: Number.NaN }).flakeIds).toEqual(["t"]);
	});

	it("prefers pre_existing over flake by default when a test is both baseline-failing and flaky", () => {
		const result = classify({
			current: [fail("both", [true, false])],
			baselineFailingIds: ["both"],
		});
		expect(result.failures).toEqual([{ id: "both", attribution: "pre_existing" }]);
	});

	it("prefers flake over pre_existing when preferFlakeOverPreExisting is set", () => {
		const result = classify({
			current: [fail("both", [true, false])],
			baselineFailingIds: ["both"],
			preferFlakeOverPreExisting: true,
		});
		expect(result.failures).toEqual([{ id: "both", attribution: "flake" }]);
		expect(result.verdict).toBe("pre_existing_failures");
	});

	it("reports newlyFixed for baseline failures that now pass (and when they no longer appear at all)", () => {
		const result = classify({
			current: [pass("was_red"), pass("ok")],
			baselineFailingIds: ["was_red", "gone"],
		});
		expect(result.verdict).toBe("clean");
		expect(result.newlyFixedIds).toEqual(["gone", "was_red"]);
		expect(result.counts.newlyFixed).toBe(2);
		expect(result.summary).toContain("Fixed 2");
	});

	it("does not count a still-failing baseline test as newly fixed", () => {
		const result = classify({ current: [fail("was_red")], baselineFailingIds: ["was_red"] });
		expect(result.newlyFixedIds).toEqual([]);
		expect(result.preExistingIds).toEqual(["was_red"]);
	});

	it("dedups duplicate current ids (last write wins) so a re-reported test counts once", () => {
		// First reported failing, then reported passing — the pass wins.
		const result = classify({ current: [fail("t"), pass("t")] });
		expect(result.counts.totalTests).toBe(1);
		expect(result.verdict).toBe("clean");
		expect(result.failures).toEqual([]);
	});

	it("sorts failures new_failure → pre_existing → flake, then by id, deterministically", () => {
		const result = classify({
			current: [fail("z_flake", [true, false]), fail("a_new"), fail("m_pre"), fail("b_new")],
			baselineFailingIds: ["m_pre"],
		});
		expect(result.failures).toEqual([
			{ id: "a_new", attribution: "new_failure" },
			{ id: "b_new", attribution: "new_failure" },
			{ id: "m_pre", attribution: "pre_existing" },
			{ id: "z_flake", attribution: "flake" },
		]);
	});

	it("handles an empty current run as clean with zero counts", () => {
		const result = classify({ current: [] });
		expect(result.verdict).toBe("clean");
		expect(result.counts).toMatchObject({ totalTests: 0, passed: 0, failed: 0 });
	});

	it("all failures pre-existing/flaky ⇒ pre_existing_failures (never regressed)", () => {
		const result = classify({
			current: [fail("old1"), fail("old2"), fail("flk", [true, false, true])],
			baselineFailingIds: ["old1", "old2"],
		});
		expect(result.verdict).toBe("pre_existing_failures");
		expect(result.newFailureIds).toEqual([]);
		expect(result.counts).toMatchObject({ preExisting: 2, flake: 1, newFailures: 0 });
	});
});

describe("regressionGateDecision", () => {
	it("maps regressed → block", () => {
		expect(regressionGateDecision("regressed")).toBe("block");
	});
	it("maps pre_existing_failures → needs_review", () => {
		expect(regressionGateDecision("pre_existing_failures")).toBe("needs_review");
	});
	it("maps clean → proceed", () => {
		expect(regressionGateDecision("clean")).toBe("proceed");
	});

	it("composes with classifyTestRegression end-to-end", () => {
		const regressed = classify({ current: [fail("x")] });
		expect(regressionGateDecision(regressed.verdict)).toBe("block");
		const preExisting = classify({ current: [fail("x")], baselineFailingIds: ["x"] });
		expect(regressionGateDecision(preExisting.verdict)).toBe("needs_review");
		const clean = classify({ current: [pass("x")] });
		expect(regressionGateDecision(clean.verdict)).toBe("proceed");
	});
});
