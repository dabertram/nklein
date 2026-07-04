import { describe, expect, it } from "vitest";
import {
	assessClarificationNeed,
	type ClarificationSignalKind,
	detectClarificationSignals,
	MODE_THRESHOLDS,
	SIGNAL_WEIGHTS,
	scoreClarificationSignals,
} from "../../../src/core/clarification-need";

function kinds(request: string | null | undefined): ClarificationSignalKind[] {
	return detectClarificationSignals(request).map((s) => s.kind);
}

describe("detectClarificationSignals", () => {
	it("flags an empty / whitespace / null / undefined request as empty_or_trivial (and nothing else)", () => {
		for (const empty of ["", "   ", null, undefined]) {
			expect(kinds(empty)).toEqual(["empty_or_trivial"]);
		}
	});

	it("flags a too-short, ungrounded ask as empty_or_trivial", () => {
		expect(kinds("fix it")).toEqual(["empty_or_trivial"]);
		expect(kinds("asap please")).toEqual(["empty_or_trivial"]);
	});

	it("flags a bare action verb with no target as missing_target", () => {
		expect(kinds("could you please refactor")).toContain("missing_target");
		expect(kinds("improve performance somehow")).toContain("missing_target");
	});

	it("does NOT flag missing_target when a concrete target is named", () => {
		expect(kinds("refactor the session module")).not.toContain("missing_target");
		expect(kinds("update the config file for the parser")).not.toContain("missing_target");
	});

	it("flags an unresolved pronoun with no antecedent", () => {
		expect(kinds("please make that work again")).toContain("unresolved_pronoun");
	});

	it("does NOT flag a pronoun when a concrete antecedent is present", () => {
		expect(kinds("the parser is broken, please fix it in that file")).not.toContain("unresolved_pronoun");
	});

	it("flags conflicting constraints when both sides of a tensioned pair appear", () => {
		expect(kinds("keep the change minimal but make it comprehensive and complete")).toContain(
			"conflicting_constraints",
		);
		expect(kinds("do this quickly but be really thorough and robust about the module")).toContain(
			"conflicting_constraints",
		);
		expect(kinds("preserve the old behavior but rewrite everything from scratch in the module")).toContain(
			"conflicting_constraints",
		);
	});

	it("does NOT flag conflicting constraints when only one side is present", () => {
		expect(kinds("keep the change minimal in the parser module")).not.toContain("conflicting_constraints");
	});

	it("does NOT fire on a conflict-term SUBSTRING inside a larger, non-conflicting word", () => {
		// Unanchored alternation used to match 'replace' inside 'irreplaceable', 'full' inside 'fully',
		// 'complete' inside 'completed' — pairing with the other side and raising a spurious clarifying
		// question that stalls a clear task. Each of these fired on the old regex; none should now.
		expect(kinds("preserve this irreplaceable artifact in the config module")).not.toContain(
			"conflicting_constraints",
		);
		expect(kinds("make a minimal but fully-tested change to the parser module")).not.toContain(
			"conflicting_constraints",
		);
		expect(kinds("keep it small but with the completed feature set in the module")).not.toContain(
			"conflicting_constraints",
		);
	});

	it("still fires on a genuine conflict term that is a prefix (backward-compatible ↔ breaking change)", () => {
		// backward[- ]compat is a DELIBERATE prefix — it must still match "backward-compatible".
		expect(kinds("make it backward-compatible but also a breaking change to the module")).toContain(
			"conflicting_constraints",
		);
	});

	it("flags multiple interpretations when open choices are offered", () => {
		expect(kinds("add caching to the module, either redis or maybe something else")).toContain(
			"multiple_interpretations",
		);
		expect(kinds("pick whichever option works for the config file")).toContain("multiple_interpretations");
	});

	it("flags explicit uncertainty from the requester", () => {
		expect(kinds("not sure what the config file should do, figure it out")).toContain("explicit_uncertainty");
		expect(kinds("make the parser module handle errors or something")).toContain("explicit_uncertainty");
	});

	it("a well-specified request produces NO signals", () => {
		expect(kinds("add a unit test for the JSON parser in parser.ts")).toEqual([]);
		expect(kinds("rename the variable `foo` to `bar` in the config module")).toEqual([]);
	});

	it("dedupes each signal kind (fires at most once) and orders by descending weight then kind", () => {
		const signals = detectClarificationSignals(
			"make that quickly but be thorough, either way, not sure what the module should do",
		);
		const detected = signals.map((s) => s.kind);
		// no duplicate kinds
		expect(new Set(detected).size).toBe(detected.length);
		// weights are non-increasing (deterministic ordering)
		for (let i = 1; i < signals.length; i++) {
			expect(signals[i - 1].weight).toBeGreaterThanOrEqual(signals[i].weight);
		}
	});

	it("every emitted signal carries the fixed weight for its kind and a non-empty detail", () => {
		for (const s of detectClarificationSignals("refactor")) {
			expect(s.weight).toBe(SIGNAL_WEIGHTS[s.kind]);
			expect(s.detail.length).toBeGreaterThan(0);
		}
	});
});

describe("scoreClarificationSignals", () => {
	it("no signals → 0", () => {
		expect(scoreClarificationSignals([])).toBe(0);
	});

	it("sums weights and clamps to [0, 1]", () => {
		const two = detectClarificationSignals("make that quickly but be thorough");
		const score = scoreClarificationSignals(two);
		expect(score).toBeGreaterThan(0);
		expect(score).toBeLessThanOrEqual(1);
	});

	it("empty_or_trivial alone already saturates the score to 1", () => {
		expect(scoreClarificationSignals(detectClarificationSignals("fix it"))).toBe(1);
	});
});

describe("assessClarificationNeed", () => {
	it("a clearly specified request needs no clarification in any mode", () => {
		const request = "add a unit test for the JSON parser in parser.ts";
		for (const mode of ["cautious", "balanced", "autonomous"] as const) {
			const a = assessClarificationNeed(request, mode);
			expect(a.score).toBe(0);
			expect(a.needsClarification).toBe(false);
			expect(a.mode).toBe(mode);
		}
	});

	it("an empty request needs clarification in every mode (score 1 ≥ every threshold)", () => {
		for (const mode of ["cautious", "balanced", "autonomous"] as const) {
			expect(assessClarificationNeed("", mode).needsClarification).toBe(true);
		}
	});

	it("defaults to balanced mode", () => {
		expect(assessClarificationNeed("refactor").mode).toBe("balanced");
	});

	it("mode monotonicity: a single soft signal trips cautious but not balanced/autonomous", () => {
		// One soft signal (unresolved_pronoun, weight 0.35): ≥ cautious 0.3, < balanced 0.6.
		const request = "please make that work again";
		expect(assessClarificationNeed(request, "cautious").needsClarification).toBe(true);
		expect(assessClarificationNeed(request, "balanced").needsClarification).toBe(false);
		expect(assessClarificationNeed(request, "autonomous").needsClarification).toBe(false);
	});

	it("a strong missing_target (0.6) meets the balanced threshold but not autonomous", () => {
		const request = "could you please refactor";
		const assessment = assessClarificationNeed(request, "balanced");
		expect(assessment.score).toBeGreaterThanOrEqual(MODE_THRESHOLDS.balanced);
		expect(assessment.needsClarification).toBe(true);
		expect(assessClarificationNeed(request, "autonomous").needsClarification).toBe(false);
	});

	it("autonomous only asks when the request is essentially unusable (empty / no target at all)", () => {
		// Compounding soft signals still don't reach 1 unless empty/trivial or truly targetless.
		const soft = assessClarificationNeed("make that quickly but be thorough or something", "autonomous");
		expect(soft.needsClarification).toBe(soft.score >= 1);
		// A totally empty ask does trip autonomous.
		expect(assessClarificationNeed("", "autonomous").needsClarification).toBe(true);
	});

	it("is deterministic: repeated calls yield identical assessments", () => {
		const request = "keep it minimal but comprehensive, either A or B, not sure about the module";
		const first = assessClarificationNeed(request, "balanced");
		const second = assessClarificationNeed(request, "balanced");
		expect(second).toEqual(first);
	});

	it("thresholds are ordered cautious < balanced < autonomous (more autonomy ⇒ asks less)", () => {
		expect(MODE_THRESHOLDS.cautious).toBeLessThan(MODE_THRESHOLDS.balanced);
		expect(MODE_THRESHOLDS.balanced).toBeLessThan(MODE_THRESHOLDS.autonomous);
	});
});
