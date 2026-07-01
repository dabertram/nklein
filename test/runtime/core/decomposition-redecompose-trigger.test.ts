import { describe, expect, it } from "vitest";
import {
	DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS,
	type DecompositionStructureSignals,
	decideRedecomposeTrigger,
	type RedecomposeTriggerInput,
	type SubtaskSizing,
} from "../../../src/core/decomposition-redecompose-trigger";

// ---------------------------------------------------------------------------
// Helpers — build the injected plain-value inputs concisely.
// ---------------------------------------------------------------------------

/** A clean structural signal: no blocking defect, one connected component, nothing disconnected. */
function soundStructure(subtaskCount: number): DecompositionStructureSignals {
	return {
		hasBlockingStructuralDefect: false,
		componentCount: 1,
		disconnectedSubtaskCount: 0,
		subtaskCount,
	};
}

/** A well-sized subtask (comfortably between the thin floor and the coarse ceiling). */
function sized(id: string, complexity = 40, likelyFileCount = 2): SubtaskSizing {
	return { id, complexity, likelyFileCount };
}

/** A full input with sound structure + well-sized cards, overridable per test. */
function baseInput(overrides: Partial<RedecomposeTriggerInput> = {}): RedecomposeTriggerInput {
	const sizing = overrides.sizing ?? [sized("a"), sized("b"), sized("c")];
	return {
		structure: overrides.structure ?? soundStructure(sizing.length),
		sizing,
		uncoveredGoalAspectCount: overrides.uncoveredGoalAspectCount,
		semanticViolationCount: overrides.semanticViolationCount,
		semanticWarningCount: overrides.semanticWarningCount,
		priorRedecomposeAttempts: overrides.priorRedecomposeAttempts,
	};
}

// ---------------------------------------------------------------------------
// accept — nothing actionable
// ---------------------------------------------------------------------------

describe("decideRedecomposeTrigger — accept", () => {
	it("accepts a sound, well-sized, fully-covered decomposition with no reasons", () => {
		const verdict = decideRedecomposeTrigger(baseInput());
		expect(verdict.action).toBe("accept");
		expect(verdict.reasons).toEqual([]);
		expect(verdict.oversizedSubtaskIds).toEqual([]);
		expect(verdict.undersizedSubtaskIds).toEqual([]);
		expect(verdict.shouldHaltRedecomposition).toBe(false);
	});

	it("accepts a single-card decomposition (component count 1, no fragmentation)", () => {
		const verdict = decideRedecomposeTrigger(baseInput({ sizing: [sized("only")] }));
		expect(verdict.action).toBe("accept");
	});

	it("does not treat a single trivially-thin card as a merge (below the merge threshold)", () => {
		// One undersized card, but minUndersizedForMerge defaults to 2.
		const verdict = decideRedecomposeTrigger(baseInput({ sizing: [sized("thin", 5, 1), sized("b"), sized("c")] }));
		expect(verdict.action).toBe("accept");
		expect(verdict.undersizedSubtaskIds).toEqual(["thin"]);
		expect(verdict.reasons).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// redo — fundamentally unsound
// ---------------------------------------------------------------------------

describe("decideRedecomposeTrigger — redo", () => {
	it("redoes when there is a blocking structural defect (e.g. a cycle)", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({ structure: { ...soundStructure(3), hasBlockingStructuralDefect: true } }),
		);
		expect(verdict.action).toBe("redo");
		expect(verdict.shouldHaltRedecomposition).toBe(false);
		expect(verdict.reasons.join(" ")).toMatch(/blocking structural defect/i);
	});

	it("redoes when the goal fragmented into disconnected islands (component count > 1)", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({
				structure: {
					hasBlockingStructuralDefect: false,
					componentCount: 2,
					disconnectedSubtaskCount: 1,
					subtaskCount: 3,
				},
			}),
		);
		expect(verdict.action).toBe("redo");
		expect(verdict.reasons.join(" ")).toMatch(/disconnected island/i);
	});

	it("does NOT treat a single-card graph as fragmented even if componentCount reads > 1", () => {
		// subtaskCount <= 1 short-circuits the island rule (a lone card is trivially its own component).
		const verdict = decideRedecomposeTrigger(
			baseInput({
				sizing: [sized("only")],
				structure: {
					hasBlockingStructuralDefect: false,
					componentCount: 2,
					disconnectedSubtaskCount: 0,
					subtaskCount: 1,
				},
			}),
		);
		expect(verdict.action).toBe("accept");
	});

	it("redoes when goal aspects are uncovered (completeness gap)", () => {
		const verdict = decideRedecomposeTrigger(baseInput({ uncoveredGoalAspectCount: 2 }));
		expect(verdict.action).toBe("redo");
		expect(verdict.reasons.join(" ")).toMatch(/not covered/i);
	});

	it("clamps a negative uncovered-aspect count to 0 (does not force a redo)", () => {
		const verdict = decideRedecomposeTrigger(baseInput({ uncoveredGoalAspectCount: -3 }));
		expect(verdict.action).toBe("accept");
	});
});

// ---------------------------------------------------------------------------
// split — some cards too coarse
// ---------------------------------------------------------------------------

describe("decideRedecomposeTrigger — split", () => {
	it("splits when a subtask breaches the complexity ceiling", () => {
		const verdict = decideRedecomposeTrigger(baseInput({ sizing: [sized("big", 90, 2), sized("b"), sized("c")] }));
		expect(verdict.action).toBe("split");
		expect(verdict.oversizedSubtaskIds).toEqual(["big"]);
		expect(verdict.reasons.join(" ")).toMatch(/exceed the sizing ceiling/i);
	});

	it("splits when a subtask breaches the file-count ceiling (complexity fine)", () => {
		const verdict = decideRedecomposeTrigger(baseInput({ sizing: [sized("wide", 30, 7), sized("b"), sized("c")] }));
		expect(verdict.action).toBe("split");
		expect(verdict.oversizedSubtaskIds).toEqual(["wide"]);
	});

	it("returns oversized ids sorted, and reports all of them", () => {
		const verdict = decideRedecomposeTrigger(baseInput({ sizing: [sized("z", 99), sized("a", 88), sized("m", 40)] }));
		expect(verdict.action).toBe("split");
		expect(verdict.oversizedSubtaskIds).toEqual(["a", "z"]);
	});

	it("does not mark a card exactly at the ceiling as oversized (strictly greater)", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({
				sizing: [
					sized(
						"edge",
						DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS.maxSubtaskComplexity,
						DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS.maxSubtaskLikelyFiles,
					),
					sized("b"),
				],
			}),
		);
		expect(verdict.action).toBe("accept");
		expect(verdict.oversizedSubtaskIds).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// merge — over-decomposed into thin cards
// ---------------------------------------------------------------------------

describe("decideRedecomposeTrigger — merge", () => {
	it("merges when enough subtasks are trivially thin", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({ sizing: [sized("t1", 5, 1), sized("t2", 3, 0), sized("real", 50, 2)] }),
		);
		expect(verdict.action).toBe("merge");
		expect(verdict.undersizedSubtaskIds).toEqual(["t1", "t2"]);
		expect(verdict.reasons.join(" ")).toMatch(/trivially thin/i);
	});

	it("requires BOTH the complexity floor AND the file floor to mark a card thin", () => {
		// Low complexity but 2 files → not thin (file count above the floor of 1).
		const verdict = decideRedecomposeTrigger(baseInput({ sizing: [sized("notThin", 5, 2), sized("b"), sized("c")] }));
		expect(verdict.action).toBe("accept");
		expect(verdict.undersizedSubtaskIds).toEqual([]);
	});

	it("treats a card at exactly the thin floor as undersized (≤ boundary)", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({
				sizing: [
					sized(
						"a",
						DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS.minSubtaskComplexity,
						DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS.minSubtaskLikelyFiles,
					),
					sized(
						"b",
						DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS.minSubtaskComplexity,
						DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS.minSubtaskLikelyFiles,
					),
				],
			}),
		);
		expect(verdict.action).toBe("merge");
		expect(verdict.undersizedSubtaskIds).toEqual(["a", "b"]);
	});
});

// ---------------------------------------------------------------------------
// refine — semantic-only concerns
// ---------------------------------------------------------------------------

describe("decideRedecomposeTrigger — refine", () => {
	it("refines on a semantic violation when structurally sound + well-sized", () => {
		const verdict = decideRedecomposeTrigger(baseInput({ semanticViolationCount: 1 }));
		expect(verdict.action).toBe("refine");
		expect(verdict.reasons.join(" ")).toMatch(/semantic violation/i);
		expect(verdict.shouldHaltRedecomposition).toBe(false);
	});

	it("refines on a semantic warning alone", () => {
		const verdict = decideRedecomposeTrigger(baseInput({ semanticWarningCount: 2 }));
		expect(verdict.action).toBe("refine");
		expect(verdict.reasons.join(" ")).toMatch(/semantic warning/i);
	});

	it("clamps negative semantic counts to 0 (no spurious refine)", () => {
		const verdict = decideRedecomposeTrigger(baseInput({ semanticViolationCount: -1, semanticWarningCount: -5 }));
		expect(verdict.action).toBe("accept");
	});
});

// ---------------------------------------------------------------------------
// Priority ordering — most disruptive wins, but reasons list everything.
// ---------------------------------------------------------------------------

describe("decideRedecomposeTrigger — action priority", () => {
	it("redo outranks split, merge, and refine (and lists all signals)", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({
				uncoveredGoalAspectCount: 1,
				sizing: [sized("big", 90), sized("thin1", 5, 1), sized("thin2", 4, 0)],
				semanticViolationCount: 1,
			}),
		);
		expect(verdict.action).toBe("redo");
		// The oversized/undersized ids are still surfaced for the caller even though redo won.
		expect(verdict.oversizedSubtaskIds).toEqual(["big"]);
		expect(verdict.undersizedSubtaskIds).toEqual(["thin1", "thin2"]);
		// reasons carry coverage (first) → sizing → semantic — the whole picture.
		expect(verdict.reasons[0]).toMatch(/not covered/i);
		expect(verdict.reasons.join(" ")).toMatch(/exceed the sizing ceiling/i);
		expect(verdict.reasons.join(" ")).toMatch(/trivially thin/i);
		expect(verdict.reasons.join(" ")).toMatch(/semantic violation/i);
	});

	it("split outranks merge and refine", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({
				sizing: [sized("big", 90), sized("thin1", 5, 1), sized("thin2", 4, 0)],
				semanticWarningCount: 3,
			}),
		);
		expect(verdict.action).toBe("split");
		expect(verdict.oversizedSubtaskIds).toEqual(["big"]);
		expect(verdict.undersizedSubtaskIds).toEqual(["thin1", "thin2"]);
	});

	it("merge outranks refine", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({
				sizing: [sized("thin1", 5, 1), sized("thin2", 4, 0), sized("real", 50, 2)],
				semanticViolationCount: 2,
			}),
		);
		expect(verdict.action).toBe("merge");
	});

	it("structure defect ordering: blocking-defect reason precedes island reason precedes sizing", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({
				structure: {
					hasBlockingStructuralDefect: true,
					componentCount: 2,
					disconnectedSubtaskCount: 1,
					subtaskCount: 3,
				},
				sizing: [sized("big", 90), sized("b"), sized("c")],
			}),
		);
		expect(verdict.action).toBe("redo");
		const blockingIdx = verdict.reasons.findIndex((r) => /blocking structural defect/i.test(r));
		const islandIdx = verdict.reasons.findIndex((r) => /disconnected island/i.test(r));
		const sizingIdx = verdict.reasons.findIndex((r) => /exceed the sizing ceiling/i.test(r));
		expect(blockingIdx).toBeGreaterThanOrEqual(0);
		expect(blockingIdx).toBeLessThan(islandIdx);
		expect(islandIdx).toBeLessThan(sizingIdx);
	});
});

// ---------------------------------------------------------------------------
// Loop-safety — redo budget exhaustion downgrades + halts.
// ---------------------------------------------------------------------------

describe("decideRedecomposeTrigger — loop safety (attempt budget)", () => {
	it("still redoes below the attempt cap", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({
				uncoveredGoalAspectCount: 1,
				priorRedecomposeAttempts: DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS.maxRedecomposeAttempts - 1,
			}),
		);
		expect(verdict.action).toBe("redo");
		expect(verdict.shouldHaltRedecomposition).toBe(false);
	});

	it("at the cap, downgrades a redo to accept when nothing else is actionable + flags halt", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({
				structure: { ...soundStructure(3), hasBlockingStructuralDefect: true },
				priorRedecomposeAttempts: DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS.maxRedecomposeAttempts,
			}),
		);
		expect(verdict.action).toBe("accept");
		expect(verdict.shouldHaltRedecomposition).toBe(true);
		expect(verdict.reasons.join(" ")).toMatch(/budget exhausted/i);
	});

	it("at the cap, downgrades a redo to split when there are also oversized cards", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({
				uncoveredGoalAspectCount: 1,
				sizing: [sized("big", 90), sized("b"), sized("c")],
				priorRedecomposeAttempts: 5,
			}),
		);
		expect(verdict.action).toBe("split");
		expect(verdict.shouldHaltRedecomposition).toBe(true);
		expect(verdict.oversizedSubtaskIds).toEqual(["big"]);
	});

	it("at the cap, downgrades a redo to merge when there are enough thin cards but no oversized", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({
				uncoveredGoalAspectCount: 1,
				sizing: [sized("t1", 5, 1), sized("t2", 4, 0), sized("real", 50, 2)],
				priorRedecomposeAttempts: 3,
			}),
		);
		expect(verdict.action).toBe("merge");
		expect(verdict.shouldHaltRedecomposition).toBe(true);
	});

	it("at the cap, downgrades a redo to refine when only semantic concerns remain", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({ uncoveredGoalAspectCount: 1, semanticViolationCount: 1, priorRedecomposeAttempts: 3 }),
		);
		expect(verdict.action).toBe("refine");
		expect(verdict.shouldHaltRedecomposition).toBe(true);
	});

	it("does NOT halt a non-redo action even at/over the attempt cap (split/merge/refine are not re-decomposes)", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({ sizing: [sized("big", 90), sized("b"), sized("c")], priorRedecomposeAttempts: 9 }),
		);
		// No redo was warranted (structure sound, goal covered) → the cap is irrelevant.
		expect(verdict.action).toBe("split");
		expect(verdict.shouldHaltRedecomposition).toBe(false);
	});

	it("clamps a negative priorRedecomposeAttempts to 0", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({ uncoveredGoalAspectCount: 1, priorRedecomposeAttempts: -4 }),
		);
		expect(verdict.action).toBe("redo");
		expect(verdict.shouldHaltRedecomposition).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Options overrides
// ---------------------------------------------------------------------------

describe("decideRedecomposeTrigger — custom options", () => {
	it("honours a custom complexity ceiling", () => {
		// Default ceiling 75 would accept complexity 60; a custom ceiling of 50 flags it.
		const verdict = decideRedecomposeTrigger(baseInput({ sizing: [sized("mid", 60, 2), sized("b")] }), {
			maxSubtaskComplexity: 50,
		});
		expect(verdict.action).toBe("split");
		expect(verdict.oversizedSubtaskIds).toEqual(["mid"]);
	});

	it("honours a custom merge threshold (require 3 thin cards)", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({ sizing: [sized("t1", 5, 1), sized("t2", 4, 0), sized("real", 50, 2)] }),
			{ minUndersizedForMerge: 3 },
		);
		// Only 2 thin cards, threshold is 3 → no merge.
		expect(verdict.action).toBe("accept");
		expect(verdict.undersizedSubtaskIds).toEqual(["t1", "t2"]);
	});

	it("honours a custom attempt cap of 1 (first redo already downgrades)", () => {
		const verdict = decideRedecomposeTrigger(
			baseInput({ uncoveredGoalAspectCount: 1, priorRedecomposeAttempts: 1 }),
			{ maxRedecomposeAttempts: 1 },
		);
		expect(verdict.action).toBe("accept");
		expect(verdict.shouldHaltRedecomposition).toBe(true);
	});

	it("exposes the documented default options", () => {
		expect(DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS).toEqual({
			maxSubtaskComplexity: 75,
			maxSubtaskLikelyFiles: 3,
			minSubtaskComplexity: 10,
			minSubtaskLikelyFiles: 1,
			minUndersizedForMerge: 2,
			maxRedecomposeAttempts: 3,
		});
	});
});

// ---------------------------------------------------------------------------
// Purity / immutability
// ---------------------------------------------------------------------------

describe("decideRedecomposeTrigger — purity", () => {
	it("does not mutate the input (sizing array + structure untouched)", () => {
		const input = baseInput({ sizing: [sized("big", 90), sized("thin", 5, 1)], uncoveredGoalAspectCount: 1 });
		const sizingSnapshot = JSON.parse(JSON.stringify(input.sizing));
		const structureSnapshot = JSON.parse(JSON.stringify(input.structure));
		decideRedecomposeTrigger(input);
		expect(input.sizing).toEqual(sizingSnapshot);
		expect(input.structure).toEqual(structureSnapshot);
	});

	it("is deterministic — same input yields an identical verdict", () => {
		const input = baseInput({ sizing: [sized("big", 90), sized("mid", 40)], semanticWarningCount: 1 });
		expect(decideRedecomposeTrigger(input)).toEqual(decideRedecomposeTrigger(input));
	});

	it("handles an empty decomposition (no sizing) as accept", () => {
		const verdict = decideRedecomposeTrigger({ structure: soundStructure(0), sizing: [] });
		expect(verdict.action).toBe("accept");
		expect(verdict.oversizedSubtaskIds).toEqual([]);
		expect(verdict.undersizedSubtaskIds).toEqual([]);
	});
});
