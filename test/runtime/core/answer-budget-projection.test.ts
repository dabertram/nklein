import { describe, expect, it } from "vitest";
import { type AnswerSizeObservation, buildAnswerSizesByModel } from "../../../src/core/answer-budget-projection";

const obs = (modelId: string | null, outputTokens: number | null): AnswerSizeObservation => ({
	modelId,
	usage: outputTokens === null ? null : { outputTokens },
});

describe("buildAnswerSizesByModel (F4.10)", () => {
	it("groups output-token counts by model", () => {
		const byModel = buildAnswerSizesByModel([obs("m1", 200), obs("m1", 350), obs("m2", 100)]);
		expect(byModel.get("m1")).toEqual([200, 350]);
		expect(byModel.get("m2")).toEqual([100]);
	});

	it("skips observations without usage or a model id", () => {
		const byModel = buildAnswerSizesByModel([obs("m", null), obs(null, 100), obs("m", 500)]);
		expect(byModel.get("m")).toEqual([500]);
		expect([...byModel.keys()]).toEqual(["m"]);
	});
});
