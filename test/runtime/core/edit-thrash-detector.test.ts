import { describe, expect, it } from "vitest";
import { detectEditThrashing } from "../../../src/core/edit-thrash-detector";

describe("detectEditThrashing", () => {
	it("flags A→B→A→B oscillation as thrashing", () => {
		const result = detectEditThrashing([
			{ path: "src/score.ts", content: "A" },
			{ path: "src/score.ts", content: "B" },
			{ path: "src/score.ts", content: "A" },
			{ path: "src/score.ts", content: "B" },
		]);
		expect(result.thrashing).toBe(true);
		expect(result.findings[0]).toMatchObject({
			path: "src/score.ts",
			edits: 4,
			distinctStates: 2,
			oscillations: 2,
			verdict: "thrashing",
		});
	});

	it("treats many edits reaching NEW states as busy, not thrashing (progress is not a fault)", () => {
		const result = detectEditThrashing(
			Array.from({ length: 6 }, (_, i) => ({ path: "a.ts", content: `state ${i}` })),
		);
		expect(result.thrashing).toBe(false);
		expect(result.findings[0]?.verdict).toBe("busy");
	});

	it("tolerates a single legitimate revert (one oscillation is below the default threshold)", () => {
		const result = detectEditThrashing([
			{ path: "a.ts", content: "A" },
			{ path: "a.ts", content: "B" },
			{ path: "a.ts", content: "A" }, // one revert — legitimate
		]);
		expect(result.findings[0]?.verdict).toBe("busy");
	});

	it("stays ok below the per-file edit floor and separates files", () => {
		const result = detectEditThrashing([
			{ path: "a.ts", content: "A" },
			{ path: "a.ts", content: "B" },
			{ path: "b.ts", content: "X" },
		]);
		expect(result.thrashing).toBe(false);
		expect(result.findings.every((finding) => finding.verdict === "ok")).toBe(true);
		expect(result.findings).toHaveLength(2);
	});

	it("sorts the worst offender first", () => {
		const result = detectEditThrashing([
			{ path: "calm.ts", content: "1" },
			{ path: "calm.ts", content: "2" },
			{ path: "calm.ts", content: "3" },
			{ path: "thrash.ts", content: "A" },
			{ path: "thrash.ts", content: "B" },
			{ path: "thrash.ts", content: "A" },
			{ path: "thrash.ts", content: "B" },
		]);
		expect(result.findings[0]?.path).toBe("thrash.ts");
	});
});
