import { describe, expect, it } from "vitest";
import {
	assessIntentMergeSafety,
	buildIntentMergePrompt,
	decideIntentMerge,
	MAX_INTENT_MERGE_CHARS,
	parseIntentMergeReply,
} from "../../src/core/intent-merge-rung";

describe("decideIntentMerge", () => {
	it("declines while cheaper rungs remain", () => {
		const decision = decideIntentMerge({ ladderExhausted: false, fileChars: 500 });
		expect(decision.kind).toBe("decline");
	});

	it("escalates on an exhausted ladder over a bounded file", () => {
		const decision = decideIntentMerge({ ladderExhausted: true, bestSimilarity: 0.7, fileChars: 2000 });
		expect(decision.kind).toBe("escalate");
	});

	it("sends the model back to RE-READ when the anchor was probably hallucinated", () => {
		// A very low best-similarity means the search block likely never existed. Merging here would launder a
		// hallucinated anchor into a whole-file rewrite.
		const decision = decideIntentMerge({ ladderExhausted: true, bestSimilarity: 0.1, fileChars: 2000 });
		expect(decision.kind).toBe("reread");
		expect(decision.reason).toContain("hallucinated");
	});

	it("declines a file too large to re-emit", () => {
		const decision = decideIntentMerge({
			ladderExhausted: true,
			bestSimilarity: 0.7,
			fileChars: MAX_INTENT_MERGE_CHARS + 1,
		});
		expect(decision.kind).toBe("decline");
	});

	it("is a last step, not a retry loop", () => {
		const decision = decideIntentMerge({
			ladderExhausted: true,
			bestSimilarity: 0.7,
			fileChars: 2000,
			priorAttempts: 1,
		});
		expect(decision.kind).toBe("decline");
		expect(decision.reason).toContain("retry loop");
	});
});

describe("buildIntentMergePrompt", () => {
	it("forbids changes beyond the intended edit — the failure mode this rung introduces", () => {
		const prompt = buildIntentMergePrompt({
			filePath: "src/login.ts",
			currentContent: "const a = 1;",
			attemptedSearch: "const a = 0;",
			attemptedReplace: "const a = 2;",
		});
		expect(prompt).toContain("Change ONLY what the intended edit requires");
		expect(prompt).toContain("do not remove code you believe is unused");
		expect(prompt).toContain("COMPLETE merged file");
	});
});

describe("parseIntentMergeReply", () => {
	it("extracts a fenced merged file", () => {
		expect(parseIntentMergeReply("Sure:\n```ts\nconst a = 2;\n```\nDone.")).toBe("const a = 2;");
	});

	it("returns null for an unfenced reply — an unparseable answer must not become a file write", () => {
		expect(parseIntentMergeReply("I think you should change line 3.")).toBeNull();
	});

	it("returns null for an empty fence", () => {
		expect(parseIntentMergeReply("```\n\n```")).toBeNull();
	});
});

describe("assessIntentMergeSafety", () => {
	const original = ["function a() {", "  return 1;", "}", "", "function b() {", "  return 2;", "}"].join("\n");

	it("accepts a merge scoped to the intended edit", () => {
		const merged = original.replace("  return 1;", "  return 42;");
		const safety = assessIntentMergeSafety({ original, merged, attemptedReplace: "  return 42;" });
		expect(safety.accepted).toBe(true);
	});

	it("REJECTS an over-broad rewrite even though it looks like a valid file", () => {
		// The model "helpfully" reformatted and dropped a function while merging a one-line change.
		const merged = ["function a() { return 42; }", "// removed unused helper b"].join("\n");
		const safety = assessIntentMergeSafety({ original, merged, attemptedReplace: "  return 42;" });
		expect(safety.accepted).toBe(false);
		expect(safety.reason).toContain("over-broad rewrite");
	});

	it("refuses to blank the file", () => {
		const safety = assessIntentMergeSafety({ original, merged: "   ", attemptedReplace: "  return 42;" });
		expect(safety.accepted).toBe(false);
		expect(safety.reason).toContain("blank");
	});

	it("rejects an unchanged file — the model declined, so there is nothing to apply", () => {
		const safety = assessIntentMergeSafety({ original, merged: original, attemptedReplace: "  return 42;" });
		expect(safety.accepted).toBe(false);
		expect(safety.reason).toContain("identical");
	});

	it("scales the allowance with the size of the intended edit", () => {
		// A genuinely large intended replacement legitimately changes more lines.
		const bigReplace = Array.from({ length: 10 }, (_, i) => `  line${i};`).join("\n");
		const merged = original.replace("  return 1;", bigReplace);
		const safety = assessIntentMergeSafety({ original, merged, attemptedReplace: bigReplace });
		expect(safety.accepted).toBe(true);
	});
});
