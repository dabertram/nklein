import { describe, expect, it } from "vitest";
import { buildKanbanEfficiencyRules } from "../../../src/nklein-agent/nklein-kanban-efficiency-rules";

const base = {
	contextScope: "full" as const,
	timeoutMode: "normal" as const,
	contextWindow: 32768,
};

describe("buildKanbanEfficiencyRules (§5.U / W2.4a)", () => {
	it("always emits the core discipline + focus-chain + one-based read rule", () => {
		const text = buildKanbanEfficiencyRules(base);
		expect(text).toContain("# !Klein Efficiency Rules");
		expect(text).toContain("Focus Chain");
		expect(text).toContain("ONE-BASED"); // the read_files start_line guidance that saves weak models a wasted turn
	});

	it("includes the optional packs + deep large-file protocol at full depth", () => {
		const text = buildKanbanEfficiencyRules({ ...base, level: "full" });
		expect(text).toContain("Adaptive Prompt Selection");
		expect(text).toContain("Requirements Extraction Rules");
	});

	it("drops the optional packs at minimal/lean depth (small-window models keep only the essentials)", () => {
		for (const level of ["minimal", "lean"] as const) {
			const text = buildKanbanEfficiencyRules({ ...base, level });
			expect(text).not.toContain("Adaptive Prompt Selection");
			expect(text).not.toContain("Requirements Extraction Rules");
			// ...but the core discipline survives.
			expect(text).toContain("Focus Chain");
		}
	});

	it("interpolates the scope and timeout mode into the tool rules", () => {
		const text = buildKanbanEfficiencyRules({ ...base, contextScope: "smart", timeoutMode: "extended" });
		expect(text).toContain("Scope: smart");
		expect(text).toContain("Timeout: extended");
	});
});
