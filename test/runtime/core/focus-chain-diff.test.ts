import { describe, expect, it } from "vitest";
import type { FocusChain, FocusChainStep, FocusChainStepStatus } from "../../../src/core/focus-chain";
import { diffFocusChains } from "../../../src/core/focus-chain-diff";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function step(text: string, status: FocusChainStepStatus = "pending"): FocusChainStep {
	return { text, status };
}

function chain(steps: FocusChainStep[], updatedAt = 1_000): FocusChain {
	return { steps, updatedAt };
}

// ---------------------------------------------------------------------------
// Empty / missing chains
// ---------------------------------------------------------------------------

describe("diffFocusChains — empty & missing", () => {
	it("reports no change for two empty/absent chains", () => {
		for (const [prev, next] of [
			[null, null],
			[undefined, undefined],
			[null, chain([])],
			[chain([]), undefined],
		] as const) {
			const diff = diffFocusChains(prev, next);
			expect(diff.changed).toBe(false);
			expect(diff.added).toHaveLength(0);
			expect(diff.removed).toHaveLength(0);
			expect(diff.statusChanged).toHaveLength(0);
			expect(diff.reordered).toBe(false);
			expect(diff.progressed).toBe(false);
			expect(diff.regressed).toBe(false);
		}
	});

	it("treats 'no chain yet → first chain' as all-added", () => {
		const next = chain([step("read spec"), step("write parser", "in_progress")]);
		const diff = diffFocusChains(null, next);
		expect(diff.changed).toBe(true);
		expect(diff.added).toEqual(next.steps);
		expect(diff.removed).toHaveLength(0);
		expect(diff.statusChanged).toHaveLength(0);
		// New steps are not "status changes", so neither progressed nor regressed flips.
		expect(diff.progressed).toBe(false);
		expect(diff.regressed).toBe(false);
	});

	it("treats 'chain → cleared' as all-removed", () => {
		const prev = chain([step("a", "done"), step("b", "pending")]);
		const diff = diffFocusChains(prev, null);
		expect(diff.changed).toBe(true);
		expect(diff.removed).toEqual(prev.steps);
		expect(diff.added).toHaveLength(0);
		expect(diff.reordered).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// No-op re-emission
// ---------------------------------------------------------------------------

describe("diffFocusChains — identical re-emission", () => {
	it("reports no change when the agent re-emits the same list", () => {
		const steps = [step("a", "done"), step("b", "in_progress"), step("c")];
		const diff = diffFocusChains(chain(steps, 1), chain([...steps], 2));
		expect(diff.changed).toBe(false);
		expect(diff.added).toHaveLength(0);
		expect(diff.removed).toHaveLength(0);
		expect(diff.statusChanged).toHaveLength(0);
		expect(diff.reordered).toBe(false);
	});

	it("ignores updatedAt / timing fields (identity is text+status)", () => {
		const prev = chain([{ text: "a", status: "done", startedAt: 10, completedAt: 20 }], 1);
		const next = chain([{ text: "a", status: "done", startedAt: 99, completedAt: 199 }], 2);
		expect(diffFocusChains(prev, next).changed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Add / remove
// ---------------------------------------------------------------------------

describe("diffFocusChains — add & remove", () => {
	it("detects an appended step, preserving next-order", () => {
		const prev = chain([step("a", "done")]);
		const next = chain([step("a", "done"), step("b"), step("c")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.added).toEqual([step("b"), step("c")]);
		expect(diff.removed).toHaveLength(0);
		expect(diff.changed).toBe(true);
	});

	it("detects a removed step, preserving previous-order", () => {
		const prev = chain([step("a", "done"), step("b"), step("c")]);
		const next = chain([step("a", "done"), step("c")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.removed).toEqual([step("b")]);
		expect(diff.added).toHaveLength(0);
		expect(diff.reordered).toBe(false);
	});

	it("reads a reworded step as remove + add (text is the identity)", () => {
		const prev = chain([step("write the parser", "in_progress")]);
		const next = chain([step("write the JSON parser", "in_progress")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.added).toEqual([step("write the JSON parser", "in_progress")]);
		expect(diff.removed).toEqual([step("write the parser", "in_progress")]);
		expect(diff.statusChanged).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

describe("diffFocusChains — status changes", () => {
	it("classifies a forward transition as progress", () => {
		const prev = chain([step("a", "pending"), step("b", "in_progress")]);
		const next = chain([step("a", "in_progress"), step("b", "done")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.statusChanged).toEqual([
			{ text: "a", from: "pending", to: "in_progress", progressed: true, regressed: false },
			{ text: "b", from: "in_progress", to: "done", progressed: true, regressed: false },
		]);
		expect(diff.progressed).toBe(true);
		expect(diff.regressed).toBe(false);
	});

	it("classifies a re-opened step as regression", () => {
		const prev = chain([step("a", "done")]);
		const next = chain([step("a", "pending")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.statusChanged).toEqual([
			{ text: "a", from: "done", to: "pending", progressed: false, regressed: true },
		]);
		expect(diff.progressed).toBe(false);
		expect(diff.regressed).toBe(true);
	});

	it("does not report net-progress on a mixed turn (one forward, one backward)", () => {
		const prev = chain([step("a", "in_progress"), step("b", "done")]);
		const next = chain([step("a", "done"), step("b", "in_progress")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.progressed).toBe(false); // gated because something regressed
		expect(diff.regressed).toBe(true);
		expect(diff.statusChanged).toHaveLength(2);
	});

	it("treats done ↔ skipped as a change but neither progress nor regression (both terminal)", () => {
		const prev = chain([step("a", "done")]);
		const next = chain([step("a", "skipped")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.changed).toBe(true);
		expect(diff.statusChanged).toEqual([
			{ text: "a", from: "done", to: "skipped", progressed: false, regressed: false },
		]);
		expect(diff.progressed).toBe(false);
		expect(diff.regressed).toBe(false);
	});

	it("does not list an unchanged surviving step as a status change", () => {
		const prev = chain([step("a", "done"), step("b", "pending")]);
		const next = chain([step("a", "done"), step("b", "in_progress")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.statusChanged.map((c) => c.text)).toEqual(["b"]);
	});
});

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

describe("diffFocusChains — reorder", () => {
	it("detects a pure transposition of surviving steps", () => {
		const prev = chain([step("a"), step("b"), step("c")]);
		const next = chain([step("b"), step("a"), step("c")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.reordered).toBe(true);
		expect(diff.added).toHaveLength(0);
		expect(diff.removed).toHaveLength(0);
		expect(diff.statusChanged).toHaveLength(0);
		expect(diff.changed).toBe(true);
	});

	it("does NOT flag reorder when an add/remove merely shifts positions", () => {
		// Insert a new first step: a,b,c → x,a,b,c. Common steps (a,b,c) keep their relative order.
		const prev = chain([step("a"), step("b"), step("c")]);
		const next = chain([step("x"), step("a"), step("b"), step("c")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.reordered).toBe(false);
		expect(diff.added).toEqual([step("x")]);
	});

	it("flags reorder independently of a simultaneous status change", () => {
		const prev = chain([step("a", "pending"), step("b", "pending")]);
		const next = chain([step("b", "done"), step("a", "pending")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.reordered).toBe(true);
		expect(diff.statusChanged).toEqual([
			{ text: "b", from: "pending", to: "done", progressed: true, regressed: false },
		]);
		expect(diff.progressed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Combined / realistic re-emission
// ---------------------------------------------------------------------------

describe("diffFocusChains — combined", () => {
	it("captures add + remove + status change in one re-emission", () => {
		const prev = chain([step("read spec", "done"), step("draft api", "in_progress"), step("cleanup")]);
		const next = chain([
			step("read spec", "done"), // unchanged
			step("draft api", "done"), // progressed
			step("write tests"), // added
			// "cleanup" removed
		]);
		const diff = diffFocusChains(prev, next);
		expect(diff.added).toEqual([step("write tests")]);
		expect(diff.removed).toEqual([step("cleanup")]);
		expect(diff.statusChanged).toEqual([
			{ text: "draft api", from: "in_progress", to: "done", progressed: true, regressed: false },
		]);
		expect(diff.reordered).toBe(false);
		expect(diff.changed).toBe(true);
		expect(diff.progressed).toBe(true);
		expect(diff.regressed).toBe(false);
	});

	it("is a pure function — same inputs give a deep-equal result and do not mutate inputs", () => {
		const prev = chain([step("a", "done"), step("b", "pending")]);
		const next = chain([step("a", "done"), step("b", "in_progress"), step("c")]);
		const prevSnapshot = structuredClone(prev);
		const nextSnapshot = structuredClone(next);
		const first = diffFocusChains(prev, next);
		const second = diffFocusChains(prev, next);
		expect(first).toEqual(second);
		expect(prev).toEqual(prevSnapshot);
		expect(next).toEqual(nextSnapshot);
	});
});

// ---------------------------------------------------------------------------
// Duplicate-text edge case (normalizer doesn't dedupe)
// ---------------------------------------------------------------------------

describe("diffFocusChains — duplicate step text", () => {
	it("reports a repeated text as a single status change (first next-occurrence wins)", () => {
		const prev = chain([step("dup", "pending")]);
		// Two steps share text "dup" (a malformed chain — the normalizer does not dedupe). The diff keys on text, so
		// the text stays one identity: the first occurrence's transition is reported, the rest are ignored.
		const next = chain([step("dup", "in_progress"), step("dup", "done")]);
		const diff = diffFocusChains(prev, next);
		expect(diff.statusChanged).toEqual([
			{ text: "dup", from: "pending", to: "in_progress", progressed: true, regressed: false },
		]);
		expect(diff.added).toHaveLength(0);
	});
});
