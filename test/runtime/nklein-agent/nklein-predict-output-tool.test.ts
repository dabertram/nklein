import { describe, expect, it } from "vitest";
import {
	createPredictOutputTool,
	forgetPredictedOutput,
	getPredictedOutput,
} from "../../../src/nklein-agent/nklein-predict-output-tool";

describe("predict_output tool (F12.96)", () => {
	it("records a prediction per task, readable at the acceptance seam, and forgettable", async () => {
		const [tool] = createPredictOutputTool("task-1");
		expect(tool?.name).toBe("predict_output");
		const result = (await tool?.execute({ predicted: "All 12 tests passed" }, {} as never)) as { ok: boolean };
		expect(result.ok).toBe(true);
		expect(getPredictedOutput("task-1")?.predicted).toBe("All 12 tests passed");
		expect(getPredictedOutput("task-2")).toBeNull();
		forgetPredictedOutput("task-1");
		expect(getPredictedOutput("task-1")).toBeNull();
	});

	it("rejects an empty prediction", async () => {
		const [tool] = createPredictOutputTool("task-3");
		const result = (await tool?.execute({ predicted: "   " }, {} as never)) as { ok: boolean };
		expect(result.ok).toBe(false);
		expect(getPredictedOutput("task-3")).toBeNull();
	});
});
