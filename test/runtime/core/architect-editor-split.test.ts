import { describe, expect, it } from "vitest";
import {
	buildArchitectPrompt,
	buildEditorPrompt,
	decideArchitectEditorSplit,
	extractImplementationBrief,
	IMPLEMENTATION_BRIEF_HEADING,
	SOLO_CAPABLE_EFFECTIVE_SCORE,
} from "../../../src/core/architect-editor-split";

describe("decideArchitectEditorSplit (F12.62)", () => {
	const base = { modelEffectiveScore: 52, taskDifficulty: 45, isWriteScoped: true };

	it("splits a weak model on non-trivial write-scoped work", () => {
		const d = decideArchitectEditorSplit(base);
		expect(d.split).toBe(true);
		expect(d.reason).toContain("architect/editor");
	});

	it("stays solo for read-only cards, trivial work, strong models, and unknown capability", () => {
		expect(decideArchitectEditorSplit({ ...base, isWriteScoped: false }).split).toBe(false);
		expect(decideArchitectEditorSplit({ ...base, taskDifficulty: 15 }).split).toBe(false);
		expect(decideArchitectEditorSplit({ ...base, modelEffectiveScore: SOLO_CAPABLE_EFFECTIVE_SCORE }).split).toBe(
			false,
		);
		expect(decideArchitectEditorSplit({ ...base, modelEffectiveScore: null }).split).toBe(false);
	});

	it("a prior edit-format failure forces the split even for a strong model", () => {
		const d = decideArchitectEditorSplit({ ...base, modelEffectiveScore: 90, priorEditFailures: 1 });
		expect(d.split).toBe(true);
		expect(d.reason).toContain("failed to conform");
	});
});

describe("prompts + brief extraction", () => {
	it("architect prompt demands the brief and forbids mutation; editor prompt embeds the brief", () => {
		const a = buildArchitectPrompt({ taskPrompt: "Fix the off-by-one in pager.ts" });
		expect(a).toContain(IMPLEMENTATION_BRIEF_HEADING);
		expect(a).toContain("do NOT edit files");
		const e = buildEditorPrompt({ taskPrompt: "Fix the off-by-one", architectBrief: "1. pager.ts: change < to <=" });
		expect(e).toContain("1. pager.ts: change < to <=");
		expect(e).toContain("apply these edits");
	});

	it("extracts the LAST brief section and rejects absent/empty ones", () => {
		const text = `Thinking about the ${IMPLEMENTATION_BRIEF_HEADING} format...\n\n${IMPLEMENTATION_BRIEF_HEADING}\n1. pager.ts limit(): change < to <= at the loop bound.`;
		expect(extractImplementationBrief(text)).toBe("1. pager.ts limit(): change < to <= at the loop bound.");
		expect(extractImplementationBrief("no brief here")).toBeNull();
		expect(extractImplementationBrief(`${IMPLEMENTATION_BRIEF_HEADING}\n-`)).toBeNull();
	});
});
