import { describe, expect, it } from "vitest";
import {
	decideOpenQuestionResolution,
	deriveQuestionDefault,
	estimateQuestionAssumption,
} from "../../../src/core/question-clarification-pass";
import type { NKleinPlanQuestion } from "../../../src/nklein-agent/nklein-plan-artifacts";

const question = (over: Partial<NKleinPlanQuestion> = {}): NKleinPlanQuestion => ({
	id: "q-1",
	question: "Which storage backend should the habit log use for local persistence?",
	status: "open",
	options: [],
	answer: null,
	assumption: null,
	blockedTaskId: null,
	...over,
});

describe("deriveQuestionDefault (F1.3c)", () => {
	it("prefers the stored assumption, then the recommended option, then a sole option; else null", () => {
		expect(deriveQuestionDefault(question({ assumption: "Assume SQLite." }))).toBe("Assume SQLite.");
		expect(
			deriveQuestionDefault(
				question({
					options: [
						{ id: "a", label: "SQLite", description: null, recommended: true },
						{ id: "b", label: "JSON", description: null, recommended: false },
					],
				}),
			),
		).toBe("SQLite");
		expect(
			deriveQuestionDefault(
				question({ options: [{ id: "a", label: "Only", description: null, recommended: false }] }),
			),
		).toBe("Only");
		expect(
			deriveQuestionDefault(
				question({
					options: [
						{ id: "a", label: "A", description: null, recommended: false },
						{ id: "b", label: "B", description: null, recommended: false },
					],
				}),
			),
		).toBeNull();
	});
});

describe("estimateQuestionAssumption (F1.3c deterministic estimates)", () => {
	it("raises confidence when assumption + recommended option agree, and stakes on destructive wording", () => {
		const agreeing = question({
			assumption: "Assume SQLite.",
			options: [{ id: "a", label: "SQLite", description: null, recommended: true }],
		});
		expect(estimateQuestionAssumption(agreeing, "Assume SQLite.")).toMatchObject({
			confidence: 0.75,
			impact: 0.35,
			reversibility: "reversible",
		});
		const destructive = question({ question: "Should the migration DROP the legacy auth table?" });
		expect(estimateQuestionAssumption(destructive, "Keep it.")).toMatchObject({
			impact: 0.7,
			reversibility: "irreversible",
		});
		const contractual = question({ question: "Which license header should new files carry?" });
		expect(estimateQuestionAssumption(contractual, "MIT.")).toMatchObject({
			impact: 0.7,
			reversibility: "costly",
		});
	});
});

describe("decideOpenQuestionResolution (F1.3c)", () => {
	it("adopts a safe default for an unambiguous question with an agreed assumption", () => {
		const decision = decideOpenQuestionResolution(
			question({
				assumption: "Assume SQLite (recommended).",
				options: [{ id: "a", label: "SQLite", description: null, recommended: true }],
			}),
		);
		expect(decision.action).toBe("assume_default");
		expect(decision.assumption).toBe("Assume SQLite (recommended).");
	});

	it("keeps a question open when there is no default to adopt", () => {
		const decision = decideOpenQuestionResolution(question());
		expect(decision.action).toBe("keep_open");
		expect(decision.assumption).toBeNull();
		expect(decision.reason).toMatch(/No default to adopt/);
	});

	it("keeps a high-stakes ambiguous question open in cautious mode (the §5.S pause)", () => {
		const decision = decideOpenQuestionResolution(
			question({
				question: "Not sure — should we maybe delete the legacy schema, or something else? Either could work.",
				assumption: "Assume we delete it.",
			}),
			"cautious",
		);
		expect(decision.action).toBe("keep_open");
		expect(decision.risk).toBeGreaterThan(0);
	});

	it("keeps an explicitly open high-stakes choice for model-backed clarification despite a working default", () => {
		const decision = decideOpenQuestionResolution(
			question({
				question: "Which authentication migration mode should this deployment use?",
				assumption: "oidc",
				options: [
					{ id: "oidc", label: "OIDC", description: "Modern authentication.", recommended: true },
					{ id: "password", label: "Password", description: "Legacy compatibility.", recommended: false },
				],
			}),
		);
		expect(decision.action).toBe("keep_open");
		expect(decision.reason).toMatch(/model-backed clarification/);
	});

	it("uses the stable question id when a model shortens the high-stakes question body", () => {
		const decision = decideOpenQuestionResolution(
			question({
				id: "auth-migration-mode",
				question:
					"Choosing OIDC versus password requires knowing whether the target deployment is new or existing, and that this external fact is absent and must not be inferred.",
				assumption: "oidc",
			}),
		);
		expect(decision.action).toBe("keep_open");
		expect(decision.reason).toMatch(/high-stakes boundary/);
	});

	it("does not treat unrelated words beginning with auth as a security boundary", () => {
		const decision = decideOpenQuestionResolution(
			question({ question: "Which author should own the changelog entry?", assumption: "Use the committer." }),
		);
		expect(decision.action).toBe("assume_default");
	});

	it("is deterministic — the same question yields the same verdict", () => {
		const probe = question({ assumption: "Assume defaults." });
		expect(decideOpenQuestionResolution(probe)).toEqual(decideOpenQuestionResolution(probe));
	});
});
