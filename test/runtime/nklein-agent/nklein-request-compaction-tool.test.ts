import { describe, expect, it } from "vitest";
import {
	createRequestCompactionTool,
	forgetCompactionRequest,
	getCompactionRequest,
} from "../../../src/nklein-agent/nklein-request-compaction-tool";

describe("request_compaction tool (F12.6)", () => {
	it("records a fire verdict per task, readable at the turn boundary, and forgettable", async () => {
		const [tool] = createRequestCompactionTool("task-1", { getOccupancyFraction: () => 0.6 });
		expect(tool?.name).toBe("request_compaction");
		const result = (await tool?.execute({ subTaskResolved: true }, {} as never)) as { action: string };
		expect(result.action).toBe("fire");
		expect(getCompactionRequest("task-1")?.reason).toContain("dead weight");
		forgetCompactionRequest("task-1");
		expect(getCompactionRequest("task-1")).toBeNull();
	});

	it("holds an unsafe request with the reason, recording nothing", async () => {
		const [tool] = createRequestCompactionTool("task-2");
		const result = (await tool?.execute({ subTaskResolved: true, midDerivation: true }, {} as never)) as {
			action: string;
			note: string;
		};
		expect(result.action).toBe("hold");
		expect(result.note).toContain("load-bearing");
		expect(getCompactionRequest("task-2")).toBeNull();
	});
});
