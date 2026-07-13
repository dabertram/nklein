import { describe, expect, it } from "vitest";
import { countUnresolvedClarifications, isUnresolvedClarification } from "../../../src/core/clarification-count";
import type { NKleinPlanQuestion } from "../../../src/nklein-agent/nklein-plan-artifacts";

function question(overrides: Partial<NKleinPlanQuestion> = {}): NKleinPlanQuestion {
	return {
		id: overrides.id ?? "q1",
		question: overrides.question ?? "Which storage backend should we use?",
		status: overrides.status ?? "open",
		options: overrides.options ?? [],
		answer: overrides.answer ?? null,
		assumption: overrides.assumption ?? null,
		blockedTaskId: null,
	};
}

describe("countUnresolvedClarifications (§5.S badge data)", () => {
	it("is 0 for an empty / undefined plan", () => {
		expect(countUnresolvedClarifications([])).toBe(0);
		expect(countUnresolvedClarifications(undefined)).toBe(0);
		expect(countUnresolvedClarifications(null)).toBe(0);
	});

	it("counts an open question with neither answer nor assumption", () => {
		expect(isUnresolvedClarification(question())).toBe(true);
		expect(countUnresolvedClarifications([question()])).toBe(1);
	});

	it("does NOT count an open question that has a working assumption (resolved-with-default §5.B)", () => {
		expect(isUnresolvedClarification(question({ assumption: "default to SQLite" }))).toBe(false);
		expect(countUnresolvedClarifications([question({ assumption: "default to SQLite" })])).toBe(0);
	});

	it("does NOT count answered or assumed-default questions", () => {
		expect(countUnresolvedClarifications([question({ status: "answered", answer: "Postgres" })])).toBe(0);
		expect(countUnresolvedClarifications([question({ status: "assumed-default", assumption: "SQLite" })])).toBe(0);
	});

	it("treats whitespace-only answer/assumption as absent (still unresolved)", () => {
		expect(isUnresolvedClarification(question({ answer: "   ", assumption: "\n" }))).toBe(true);
	});

	it("returns the correct subtotal over a mixed plan", () => {
		expect(
			countUnresolvedClarifications([
				question({ id: "a" }), // open, bare → 1
				question({ id: "b", assumption: "x" }), // resolved-with-default → 0
				question({ id: "c", status: "answered", answer: "y" }), // resolved → 0
				question({ id: "d" }), // open, bare → 1
			]),
		).toBe(2);
	});
});
