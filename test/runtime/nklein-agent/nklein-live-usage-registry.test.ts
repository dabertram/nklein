import { afterEach, describe, expect, it } from "vitest";
import {
	forgetLiveTaskUsage,
	getLiveTaskUsage,
	recordLiveTaskUsage,
	sumLiveUsageTokens,
} from "../../../src/nklein-agent/nklein-live-usage-registry";

describe("nklein-live-usage-registry (F12.40)", () => {
	afterEach(() => {
		for (const taskId of ["a", "b", "nan"]) {
			forgetLiveTaskUsage(taskId);
		}
	});

	it("records, overwrites, sums across live sessions, and forgets", () => {
		recordLiveTaskUsage("a", { inputTokens: 100, outputTokens: 20 });
		recordLiveTaskUsage("a", { inputTokens: 300, outputTokens: 50 });
		recordLiveTaskUsage("b", { inputTokens: 10, outputTokens: 5 });
		expect(getLiveTaskUsage("a")).toEqual({ inputTokens: 300, outputTokens: 50 });
		expect(sumLiveUsageTokens()).toBe(365);
		forgetLiveTaskUsage("a");
		expect(getLiveTaskUsage("a")).toBeNull();
		expect(sumLiveUsageTokens()).toBe(15);
	});

	it("rejects non-finite counts and clamps negatives to zero", () => {
		recordLiveTaskUsage("nan", { inputTokens: Number.NaN, outputTokens: 5 });
		expect(getLiveTaskUsage("nan")).toBeNull();
		recordLiveTaskUsage("nan", { inputTokens: -7, outputTokens: 5 });
		expect(getLiveTaskUsage("nan")).toEqual({ inputTokens: 0, outputTokens: 5 });
	});
});
