import { describe, expect, it } from "vitest";
import {
	buildEscalationSuggestionContext,
	buildEscalationSuggestions,
	type EscalationSuggestionKind,
} from "../../../src/core/escalation-suggestions";
import type { OperatorTaskSignals } from "../../../src/core/operator-task-state";

function operatorSignals(overrides: Partial<OperatorTaskSignals> = {}): OperatorTaskSignals {
	return {
		sessionState: "running",
		columnId: "in_progress",
		paused: false,
		heartbeatLost: false,
		blockedKind: null,
		awaitingHostActionAck: false,
		deliveryGateHeld: false,
		clarifyingQuestionPending: false,
		noProgressOrLoop: false,
		approachingBudgetCeiling: false,
		...overrides,
	};
}

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

describe("buildEscalationSuggestionContext", () => {
	it("maps no blocking signals to an all-false context", () => {
		expect(buildEscalationSuggestionContext(operatorSignals())).toEqual({
			clarifyPending: false,
			blockedActionPending: false,
			environmentBlocked: false,
		});
	});

	it("maps a pending clarifying question → clarifyPending (promotes clarify first)", () => {
		const context = buildEscalationSuggestionContext(operatorSignals({ clarifyingQuestionPending: true }));
		expect(context.clarifyPending).toBe(true);
		expect(buildEscalationSuggestions(context).map((s) => s.kind)[0]).toBe<EscalationSuggestionKind>(
			"clarify_ambiguity",
		);
	});

	it("maps an awaiting host-action ack → blockedActionPending (promotes approve first)", () => {
		const context = buildEscalationSuggestionContext(operatorSignals({ awaitingHostActionAck: true }));
		expect(context.blockedActionPending).toBe(true);
		expect(buildEscalationSuggestions(context).map((s) => s.kind)[0]).toBe<EscalationSuggestionKind>(
			"approve_blocked_action",
		);
	});

	it("maps a sandbox-unavailable block → environmentBlocked (promotes fix-environment first)", () => {
		const context = buildEscalationSuggestionContext(operatorSignals({ blockedKind: "agent_sandbox_unavailable" }));
		expect(context.environmentBlocked).toBe(true);
		expect(buildEscalationSuggestions(context).map((s) => s.kind)[0]).toBe<EscalationSuggestionKind>(
			"fix_environment",
		);
	});

	it("does not treat other blockedKind values as an environment blocker", () => {
		expect(
			buildEscalationSuggestionContext(operatorSignals({ blockedKind: "needs_decomposition" })).environmentBlocked,
		).toBe(false);
	});
});
