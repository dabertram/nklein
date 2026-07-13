import { describe, expect, it } from "vitest";
import { applyClarificationAnswer } from "../../../src/core/clarification-answer";
import type { NKleinPlanQuestion, NKleinPlanQuestionOption } from "../../../src/nklein-agent/nklein-plan-artifacts";

function option(overrides: Partial<NKleinPlanQuestionOption> = {}): NKleinPlanQuestionOption {
	return {
		id: overrides.id ?? "o1",
		label: overrides.label ?? "Option one",
		description: overrides.description ?? null,
		recommended: overrides.recommended ?? false,
	};
}

function question(overrides: Partial<NKleinPlanQuestion> = {}): NKleinPlanQuestion {
	return {
		id: overrides.id ?? "q1",
		question: overrides.question ?? "Which storage backend?",
		status: overrides.status ?? "open",
		options: overrides.options ?? [
			option({ id: "sqlite", label: "SQLite" }),
			option({ id: "postgres", label: "Postgres" }),
			option({ id: "mysql", label: "MySQL" }),
		],
		answer: overrides.answer ?? null,
		assumption: overrides.assumption ?? null,
		blockedTaskId: null,
	};
}

describe("applyClarificationAnswer (§5.S manual answer persistence)", () => {
	it("a single selected option becomes the answer and flips the status to answered", () => {
		const result = applyClarificationAnswer(question(), { selectedOptionIds: ["postgres"] });
		expect(result.status).toBe("answered");
		expect(result.answer).toBe("Postgres");
		expect(result.assumption).toBeNull();
	});

	it("multiple selections join in the QUESTION's option order, not click order", () => {
		// user clicked mysql then sqlite; the stored answer follows option order (sqlite before mysql).
		const result = applyClarificationAnswer(question(), { selectedOptionIds: ["mysql", "sqlite"] });
		expect(result.answer).toBe("SQLite; MySQL");
	});

	it("free text alone is a valid answer", () => {
		const result = applyClarificationAnswer(question(), { freeText: "Use DuckDB" });
		expect(result.status).toBe("answered");
		expect(result.answer).toBe("Use DuckDB");
	});

	it("selected options and free text combine, options first then the free text", () => {
		const result = applyClarificationAnswer(question(), {
			selectedOptionIds: ["sqlite"],
			freeText: "but only in dev",
		});
		expect(result.answer).toBe("SQLite; but only in dev");
	});

	it("an explicit answer overrides a prior assumed-default and clears the assumption", () => {
		const assumed = question({ status: "assumed-default", assumption: "SQLite (default)" });
		const result = applyClarificationAnswer(assumed, { selectedOptionIds: ["postgres"] });
		expect(result.status).toBe("answered");
		expect(result.answer).toBe("Postgres");
		expect(result.assumption).toBeNull();
	});

	it("an empty submission (nothing selected, blank free text) leaves the question unchanged", () => {
		const original = question();
		expect(applyClarificationAnswer(original, {})).toBe(original);
		expect(applyClarificationAnswer(original, { selectedOptionIds: [], freeText: "   \n" })).toBe(original);
	});

	it("unknown option ids are ignored (only real options contribute to the answer)", () => {
		const result = applyClarificationAnswer(question(), { selectedOptionIds: ["ghost", "postgres"] });
		expect(result.answer).toBe("Postgres");
	});

	it("whitespace-only free text with a real selection does not append an empty part", () => {
		const result = applyClarificationAnswer(question(), { selectedOptionIds: ["mysql"], freeText: "  " });
		expect(result.answer).toBe("MySQL");
	});
});
