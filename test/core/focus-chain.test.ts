import { describe, expect, it } from "vitest";
import {
	applyFocusChainStepTiming,
	formatFocusChainForPrompt,
	MAX_FOCUS_CHAIN_STEP_TEXT,
	MAX_FOCUS_CHAIN_STEPS,
	normalizeFocusChain,
	summarizeFocusChain,
} from "../../src/core/focus-chain";

describe("normalizeFocusChain", () => {
	it("trims text, drops empties, coerces unknown status, stamps updatedAt", () => {
		const chain = normalizeFocusChain(
			[
				{ text: "  Read the spec  ", status: "done" },
				{ text: "", status: "pending" },
				{ text: "Write the parser", status: "bogus" },
				{ text: "   ", status: "in_progress" },
			],
			1234,
		);
		expect(chain).not.toBeNull();
		expect(chain?.updatedAt).toBe(1234);
		expect(chain?.steps).toEqual([
			{ text: "Read the spec", status: "done" },
			{ text: "Write the parser", status: "pending" },
		]);
	});

	it("returns null for missing, non-array, or all-empty input", () => {
		expect(normalizeFocusChain(null)).toBeNull();
		expect(normalizeFocusChain(undefined)).toBeNull();
		expect(normalizeFocusChain("nope" as unknown as never)).toBeNull();
		expect(normalizeFocusChain([{ text: "  " }, { text: "" }])).toBeNull();
	});

	it("caps the number of steps and the text length", () => {
		const many = Array.from({ length: MAX_FOCUS_CHAIN_STEPS + 10 }, (_, i) => ({
			text: `step ${i}`,
			status: "pending" as const,
		}));
		expect(normalizeFocusChain(many)?.steps).toHaveLength(MAX_FOCUS_CHAIN_STEPS);

		const long = normalizeFocusChain([{ text: "x".repeat(MAX_FOCUS_CHAIN_STEP_TEXT + 100), status: "pending" }]);
		expect(long?.steps[0]?.text.length).toBe(MAX_FOCUS_CHAIN_STEP_TEXT);
	});
});

describe("summarizeFocusChain", () => {
	it("counts statuses and reports completion when all done/skipped", () => {
		const chain = normalizeFocusChain([
			{ text: "a", status: "done" },
			{ text: "b", status: "skipped" },
			{ text: "c", status: "in_progress" },
			{ text: "d", status: "pending" },
		]);
		expect(summarizeFocusChain(chain)).toMatchObject({
			total: 4,
			done: 1,
			skipped: 1,
			inProgress: 1,
			pending: 1,
			complete: false,
		});
		const finished = normalizeFocusChain([
			{ text: "a", status: "done" },
			{ text: "b", status: "skipped" },
		]);
		expect(summarizeFocusChain(finished).complete).toBe(true);
	});

	it("treats an absent chain as empty + incomplete", () => {
		expect(summarizeFocusChain(null)).toEqual({
			total: 0,
			done: 0,
			inProgress: 0,
			pending: 0,
			skipped: 0,
			complete: false,
		});
	});
});

describe("formatFocusChainForPrompt", () => {
	it("renders a markdown checklist with per-status marks", () => {
		const chain = normalizeFocusChain([
			{ text: "Done step", status: "done" },
			{ text: "Active step", status: "in_progress" },
			{ text: "Todo step", status: "pending" },
			{ text: "Dropped step", status: "skipped" },
		]);
		expect(formatFocusChainForPrompt(chain)).toBe(
			["[x] Done step", "[~] Active step", "[ ] Todo step", "[-] Dropped step"].join("\n"),
		);
	});

	it("notes when there is no chain yet", () => {
		expect(formatFocusChainForPrompt(null)).toBe("(no focus chain yet)");
	});
});

describe("applyFocusChainStepTiming", () => {
	it("stamps startedAt when a step first becomes active and completedAt when it finishes", () => {
		const first = applyFocusChainStepTiming(
			null,
			{ steps: [{ text: "A", status: "in_progress" }], updatedAt: 10 },
			100,
		);
		expect(first.steps[0]).toMatchObject({ status: "in_progress", startedAt: 100 });
		expect(first.steps[0]?.completedAt).toBeUndefined();

		// Next emission marks it done at a later time — startedAt carried forward, completedAt stamped.
		const second = applyFocusChainStepTiming(first, { steps: [{ text: "A", status: "done" }], updatedAt: 20 }, 250);
		expect(second.steps[0]).toMatchObject({ status: "done", startedAt: 100, completedAt: 250 });
	});

	it("carries timings across reordering (matched by text) and clears completedAt when a step is re-opened", () => {
		const prior = applyFocusChainStepTiming(
			null,
			{
				steps: [
					{ text: "A", status: "done" },
					{ text: "B", status: "in_progress" },
				],
				updatedAt: 1,
			},
			100,
		);
		// Reorder + re-open A back to in_progress.
		const next = applyFocusChainStepTiming(
			prior,
			{
				steps: [
					{ text: "B", status: "done" },
					{ text: "A", status: "in_progress" },
				],
				updatedAt: 2,
			},
			300,
		);
		const byText = new Map(next.steps.map((step) => [step.text, step]));
		expect(byText.get("B")).toMatchObject({ startedAt: 100, completedAt: 300 });
		expect(byText.get("A")?.startedAt).toBe(100); // preserved
		expect(byText.get("A")?.completedAt).toBeUndefined(); // re-opened → cleared
	});

	it("leaves pending steps untimed", () => {
		const chain = applyFocusChainStepTiming(null, { steps: [{ text: "A", status: "pending" }], updatedAt: 1 }, 100);
		expect(chain.steps[0]?.startedAt).toBeUndefined();
		expect(chain.steps[0]?.completedAt).toBeUndefined();
	});
});
