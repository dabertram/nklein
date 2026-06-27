import { describe, expect, it } from "vitest";
import { buildEscalationSuggestions, type EscalationSuggestionKind } from "../../../src/core/escalation-suggestions";

const ALL_KINDS: EscalationSuggestionKind[] = [
	"clarify_ambiguity",
	"provide_context",
	"adjust_constraints",
	"approve_blocked_action",
	"fix_environment",
	"rescope_or_split",
	"provide_more_capable_model",
];

function kinds(context: Parameters<typeof buildEscalationSuggestions>[0] = {}): EscalationSuggestionKind[] {
	return buildEscalationSuggestions(context).map((suggestion) => suggestion.kind);
}

describe("buildEscalationSuggestions", () => {
	it("returns the full set with no duplicates, regardless of context", () => {
		const result = kinds();
		expect(new Set(result)).toEqual(new Set(ALL_KINDS));
		expect(result).toHaveLength(ALL_KINDS.length);
	});

	it("defaults to simplest-first order with the more-capable-model option last", () => {
		expect(kinds()[0]).toBe("clarify_ambiguity");
		expect(kinds().at(-1)).toBe("provide_more_capable_model");
	});

	it("always keeps 'make a more capable model available' last — it is only one of the options", () => {
		expect(kinds({ clarifyPending: true, blockedActionPending: true, environmentBlocked: true }).at(-1)).toBe(
			"provide_more_capable_model",
		);
	});

	it("promotes the clarify suggestion when a clarifying question is pending", () => {
		expect(kinds({ clarifyPending: true })[0]).toBe("clarify_ambiguity");
	});

	it("promotes the approve suggestion when a blocked action is pending", () => {
		expect(kinds({ blockedActionPending: true })[0]).toBe("approve_blocked_action");
	});

	it("promotes the environment-fix suggestion when an environment blocker was detected", () => {
		expect(kinds({ environmentBlocked: true })[0]).toBe("fix_environment");
	});

	it("promotes multiple matched suggestions in priority order without duplicating them", () => {
		const result = kinds({ blockedActionPending: true, environmentBlocked: true });
		expect(result.slice(0, 2)).toEqual<EscalationSuggestionKind[]>(["approve_blocked_action", "fix_environment"]);
		expect(new Set(result)).toEqual(new Set(ALL_KINDS));
		expect(result).toHaveLength(ALL_KINDS.length);
	});

	it("gives every suggestion a non-empty title and detail", () => {
		for (const suggestion of buildEscalationSuggestions()) {
			expect(suggestion.title.length).toBeGreaterThan(0);
			expect(suggestion.detail.length).toBeGreaterThan(0);
		}
	});
});
