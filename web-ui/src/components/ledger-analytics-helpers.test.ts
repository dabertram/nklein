import { describe, expect, it } from "vitest";
import { formatKnowledgeLift, selectTopKnowledgeLift } from "./model-performance-stats-dialog";

type LiftRow = Parameters<typeof selectTopKnowledgeLift>[0][number];

function mkRow(modelId: string, role: string, knowledgeLift: number | null): LiftRow {
	return {
		modelId,
		role,
		attemptsWithKnowledge: 5,
		successesWithKnowledge: 3,
		attemptsWithoutKnowledge: 5,
		successesWithoutKnowledge: 2,
		knowledgeLift,
	};
}

describe("selectTopKnowledgeLift", () => {
	it("drops rows without paired evidence (null lift)", () => {
		const rows = [mkRow("a:m1:e", "worker", null), mkRow("a:m2:e", "worker", 0.2)];
		const top = selectTopKnowledgeLift(rows);
		expect(top).toHaveLength(1);
		expect(top[0]?.modelId).toBe("a:m2:e");
	});

	it("ranks by absolute lift so the clearest signals (help OR hurt) lead", () => {
		const rows = [
			mkRow("a:small:e", "worker", 0.05),
			mkRow("a:big:e", "worker", -0.4),
			mkRow("a:mid:e", "worker", 0.2),
		];
		const top = selectTopKnowledgeLift(rows, 2);
		expect(top.map((r) => r.modelId)).toEqual(["a:big:e", "a:mid:e"]);
	});

	it("respects the limit", () => {
		const rows = [mkRow("a:1:e", "w", 0.3), mkRow("a:2:e", "w", 0.2), mkRow("a:3:e", "w", 0.1)];
		expect(selectTopKnowledgeLift(rows, 2)).toHaveLength(2);
	});
});

describe("formatKnowledgeLift", () => {
	it("renders an em-dash when there is no paired evidence", () => {
		expect(formatKnowledgeLift(null)).toBe("—");
	});

	it("signs positive and negative lifts as whole percents", () => {
		expect(formatKnowledgeLift(0.123)).toBe("+12%");
		expect(formatKnowledgeLift(-0.2)).toBe("-20%");
		expect(formatKnowledgeLift(0)).toBe("+0%");
	});
});
