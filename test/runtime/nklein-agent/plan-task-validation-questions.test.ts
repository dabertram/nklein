import { describe, expect, it } from "vitest";
import {
	deriveOpenQuestionDefaults,
	validatePlanQuestions,
} from "../../../src/nklein-agent/decomposition/plan-task-validation";
import type { NKleinPlanQuestion, NKleinPlanQuestionOption } from "../../../src/nklein-agent/nklein-plan-artifacts";

function option(over: Partial<NKleinPlanQuestionOption> = {}): NKleinPlanQuestionOption {
	return { id: "o1", label: "Postgres", description: null, recommended: false, ...over };
}

function question(over: Partial<NKleinPlanQuestion> = {}): NKleinPlanQuestion {
	return {
		id: "q1",
		question: "Which database?",
		status: "open",
		options: [],
		answer: null,
		assumption: null,
		...over,
	};
}

describe("deriveOpenQuestionDefaults (parse-and-recover for open questions)", () => {
	it("supplies a default from the recommended option, labeled as recommended", () => {
		const [out] = deriveOpenQuestionDefaults([
			question({
				options: [option({ label: "MySQL" }), option({ id: "o2", label: "Postgres", recommended: true })],
			}),
		]);
		expect(out?.status).toBe("open"); // stays open for later clarification
		expect(out?.assumption).toContain("Postgres");
		expect(out?.assumption).toContain("(recommended option)");
	});

	it("falls back to the first option when none is recommended (no recommended label)", () => {
		const [out] = deriveOpenQuestionDefaults([
			question({ options: [option({ label: "MySQL" }), option({ id: "o2", label: "Postgres" })] }),
		]);
		expect(out?.assumption).toContain("MySQL");
		expect(out?.assumption).not.toContain("(recommended option)");
	});

	it("leaves untouched: questions with no options, an existing default, or a non-open status", () => {
		expect(deriveOpenQuestionDefaults([question({ options: [] })])[0]?.assumption).toBeNull();
		const withDefault = question({ options: [option()], assumption: "already decided" });
		expect(deriveOpenQuestionDefaults([withDefault])[0]?.assumption).toBe("already decided");
		const answered = question({ status: "answered", answer: "Postgres", options: [option()] });
		expect(deriveOpenQuestionDefaults([answered])[0]?.assumption).toBeNull();
	});
});

describe("validatePlanQuestions", () => {
	it("accepts an open question that carries a working default (assumption or answer)", () => {
		expect(() => validatePlanQuestions([question({ assumption: "use Postgres" })])).not.toThrow();
		expect(() => validatePlanQuestions([question({ answer: "Postgres" })])).not.toThrow();
	});

	it("rejects an open question with no working default at all", () => {
		expect(() => validatePlanQuestions([question()])).toThrow(/open with no working default/u);
	});

	it("rejects an answered question missing its answer and an assumed-default missing its assumption", () => {
		expect(() => validatePlanQuestions([question({ status: "answered", answer: null })])).toThrow(
			/missing an answer/u,
		);
		expect(() => validatePlanQuestions([question({ status: "assumed-default", assumption: null })])).toThrow(
			/missing an assumption/u,
		);
	});

	it("accepts well-formed answered + assumed-default questions", () => {
		expect(() => validatePlanQuestions([question({ status: "answered", answer: "Postgres" })])).not.toThrow();
		expect(() =>
			validatePlanQuestions([question({ status: "assumed-default", assumption: "default to Postgres" })]),
		).not.toThrow();
	});
});
