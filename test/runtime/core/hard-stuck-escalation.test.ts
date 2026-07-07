import { describe, expect, it } from "vitest";
import type { AgentStucknessSignals } from "../../../src/core/agent-stuckness";
import type { EscalationSuggestionKind } from "../../../src/core/escalation-suggestions";
import { assessHardStuckEscalation } from "../../../src/core/hard-stuck-escalation";
import type { OperatorTaskSignals } from "../../../src/core/operator-task-state";

/** A hard-stuck attempt stream: capability-class failures (`timeout`), ≥3 trailing, ≥2 approaches, retry budget burned. */
function hardStuckSignals(overrides: Partial<AgentStucknessSignals> = {}): AgentStucknessSignals {
	return {
		recentOutcomes: ["timeout", "timeout", "timeout"],
		distinctApproachesTried: 2,
		loopUncleared: false,
		retryBudgetExhausted: true,
		hadProgressSinceStuck: false,
		...overrides,
	};
}

/** A progressing stream: forward progress was observed since the stuck-point began. */
function progressingSignals(overrides: Partial<AgentStucknessSignals> = {}): AgentStucknessSignals {
	return {
		recentOutcomes: ["timeout", "timeout"],
		distinctApproachesTried: 3,
		loopUncleared: true,
		retryBudgetExhausted: true,
		hadProgressSinceStuck: true,
		...overrides,
	};
}

/** A transient stream: still failing, but format-only slips with recovery budget remaining — never escalates. */
function transientSignals(overrides: Partial<AgentStucknessSignals> = {}): AgentStucknessSignals {
	return {
		recentOutcomes: ["malformed", "no_tool_call", "narrated"],
		distinctApproachesTried: 3,
		loopUncleared: false,
		retryBudgetExhausted: true,
		hadProgressSinceStuck: false,
		...overrides,
	};
}

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
		escalatedToOperator: false,
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

/** The default order the suggestions come in when NO operator context promotes anything. */
const DEFAULT_ORDER: EscalationSuggestionKind[] = ALL_KINDS;

describe("assessHardStuckEscalation", () => {
	describe("(a) CENTERPIECE — hard-stuck escalates with CONTEXT-derived, ordered suggestions", () => {
		it("escalates a hard-stuck agent: hardStuck true and a non-empty ordered suggestion set", () => {
			const result = assessHardStuckEscalation({
				stucknessSignals: hardStuckSignals(),
				operatorSignals: operatorSignals(),
			});
			expect(result.stuckness).toBe("hard_stuck");
			expect(result.hardStuck).toBe(true);
			expect(result.suggestions.length).toBeGreaterThan(0);
			// Full set, no duplicates — the user might know a fix we can't detect.
			expect(new Set(result.suggestions.map((s) => s.kind))).toEqual(new Set(ALL_KINDS));
			expect(result.suggestions).toHaveLength(ALL_KINDS.length);
		});

		it("a pending clarification keeps clarify at the FRONT (context-promoted, gate opened)", () => {
			const result = assessHardStuckEscalation({
				stucknessSignals: hardStuckSignals(),
				operatorSignals: operatorSignals({ clarifyingQuestionPending: true }),
			});
			expect(result.hardStuck).toBe(true);
			const order = result.suggestions.map((s) => s.kind);
			// clarify is FIRST in the default set too, so its promotion is order-preserving here — the ordering
			// difference is proven by the blocked-action / environment cases below, which genuinely reorder.
			expect(order[0]).toBe<EscalationSuggestionKind>("clarify_ambiguity");
			expect(new Set(order)).toEqual(new Set(ALL_KINDS));
		});

		it("a blocked (denied host) action promotes approve to the FRONT — NOT the generic default order", () => {
			const result = assessHardStuckEscalation({
				stucknessSignals: hardStuckSignals(),
				operatorSignals: operatorSignals({ awaitingHostActionAck: true }),
			});
			const order = result.suggestions.map((s) => s.kind);
			expect(order[0]).toBe<EscalationSuggestionKind>("approve_blocked_action");
			expect(order).not.toEqual(DEFAULT_ORDER);
		});

		it("a sandbox/setup blocker promotes fix-environment to the FRONT — not the generic default order", () => {
			const result = assessHardStuckEscalation({
				stucknessSignals: hardStuckSignals(),
				operatorSignals: operatorSignals({ blockedKind: "agent_sandbox_unavailable" }),
			});
			const order = result.suggestions.map((s) => s.kind);
			expect(order[0]).toBe<EscalationSuggestionKind>("fix_environment");
			expect(order).not.toEqual(DEFAULT_ORDER);
		});

		it("multiple contexts promote in priority order, and more-capable-model always stays last", () => {
			const result = assessHardStuckEscalation({
				stucknessSignals: hardStuckSignals({ loopUncleared: true, retryBudgetExhausted: false }),
				operatorSignals: operatorSignals({
					awaitingHostActionAck: true,
					blockedKind: "agent_sandbox_unavailable",
					clarifyingQuestionPending: true,
				}),
			});
			const order = result.suggestions.map((s) => s.kind);
			expect(order.slice(0, 3)).toEqual<EscalationSuggestionKind[]>([
				"clarify_ambiguity",
				"approve_blocked_action",
				"fix_environment",
			]);
			expect(order.at(-1)).toBe<EscalationSuggestionKind>("provide_more_capable_model");
		});

		it("with no operator context, a hard-stuck agent falls back to the generic default order", () => {
			const result = assessHardStuckEscalation({
				stucknessSignals: hardStuckSignals(),
				operatorSignals: operatorSignals(),
			});
			expect(result.suggestions.map((s) => s.kind)).toEqual(DEFAULT_ORDER);
		});

		it("threads stuckModelId → the more-capable-model suggestion names the family to avoid (§5.AB diversity)", () => {
			const result = assessHardStuckEscalation({
				stucknessSignals: hardStuckSignals(),
				operatorSignals: operatorSignals(),
				stuckModelId: "qwen3.6-27b", // qwen lineage
			});
			const moreCapable = result.suggestions.find((s) => s.kind === "provide_more_capable_model");
			expect(moreCapable?.detail).toMatch(/different model family than qwen/i);
		});

		it("gives the generic family hint when no stuck model is threaded", () => {
			const result = assessHardStuckEscalation({
				stucknessSignals: hardStuckSignals(),
				operatorSignals: operatorSignals(),
			});
			const moreCapable = result.suggestions.find((s) => s.kind === "provide_more_capable_model");
			expect(moreCapable?.detail).toMatch(/different model family than the ones that just failed/i);
		});
	});

	describe("(b) progressing agents do not escalate", () => {
		it("returns progressing with an EMPTY suggestion set", () => {
			const result = assessHardStuckEscalation({
				stucknessSignals: progressingSignals(),
				// Even a screaming operator context must not conjure suggestions when not hard-stuck.
				operatorSignals: operatorSignals({ clarifyingQuestionPending: true, awaitingHostActionAck: true }),
			});
			expect(result.stuckness).toBe("progressing");
			expect(result.hardStuck).toBe(false);
			expect(result.suggestions).toEqual([]);
		});
	});

	describe("(c) transient agents do not escalate — only hard_stuck does", () => {
		it("returns transient with an EMPTY suggestion set (recoverable format slips)", () => {
			const result = assessHardStuckEscalation({
				stucknessSignals: transientSignals(),
				operatorSignals: operatorSignals({ blockedKind: "agent_sandbox_unavailable" }),
			});
			expect(result.stuckness).toBe("transient");
			expect(result.hardStuck).toBe(false);
			expect(result.suggestions).toEqual([]);
		});

		it("capability failures that have NOT yet crossed the approach threshold stay transient (no escalation)", () => {
			const result = assessHardStuckEscalation({
				// timeout is capability-class and retry budget is burned, but only ONE approach tried → not hard-stuck yet.
				stucknessSignals: hardStuckSignals({ distinctApproachesTried: 1 }),
				operatorSignals: operatorSignals({ clarifyingQuestionPending: true }),
			});
			expect(result.stuckness).toBe("transient");
			expect(result.suggestions).toEqual([]);
		});
	});

	describe("determinism", () => {
		it("is deterministic — same input yields an equal result across calls", () => {
			const input = {
				stucknessSignals: hardStuckSignals(),
				operatorSignals: operatorSignals({ clarifyingQuestionPending: true }),
			};
			expect(assessHardStuckEscalation(input)).toEqual(assessHardStuckEscalation(input));
		});

		it("honors non-default thresholds forwarded to the classifier", () => {
			// Raise minApproaches above what the signals provide → the same hard-stuck stream becomes transient.
			const result = assessHardStuckEscalation({
				stucknessSignals: hardStuckSignals({ distinctApproachesTried: 2 }),
				operatorSignals: operatorSignals(),
				thresholds: { minFailures: 3, minApproaches: 5 },
			});
			expect(result.stuckness).toBe("transient");
			expect(result.suggestions).toEqual([]);
		});
	});
});
