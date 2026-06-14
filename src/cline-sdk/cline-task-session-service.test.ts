import { describe, expect, it } from "vitest";

import { buildKanbanEfficiencyRules } from "./cline-task-session-service";

describe("buildKanbanEfficiencyRules", () => {
	it("requires EOF coverage before summarizing large files", () => {
		const rules = buildKanbanEfficiencyRules({
			contextScope: "smart",
			contextWindow: 256_000,
			timeoutMode: "unlimited",
		});

		expect(rules).toContain("coverage ledger");
		expect(rules).toContain("record `wc -l` and `wc -c` before reading");
		expect(rules).toContain("unread line ranges");
		expect(rules).toContain("If a tool output is truncated, clipped, summarized, or hits an output limit");
		expect(rules).toContain("final line is confirmed");
		expect(rules).toContain(
			"Never summarize, infer a spec, or move on from a source file until the ledger shows the file has been read through EOF.",
		);
		expect(rules).toContain("every included file has EOF-confirmed coverage");
		expect(rules).toContain("resume from the last confirmed line");
		expect(rules).toContain("Treat an incomplete pass as incomplete work");
		expect(rules).toContain("Treat this as the authoritative upper bound for prompt planning");
		expect(rules).toContain("Smaller slices are still better unless the task truly needs more context");
		expect(rules).toContain("Prefer the smallest slice that fully answers the immediate question");
	});
});
