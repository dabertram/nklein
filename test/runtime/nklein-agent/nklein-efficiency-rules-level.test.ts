import { describe, expect, it } from "vitest";
import { buildKanbanEfficiencyRules } from "../../../src/nklein-agent/nklein-kanban-efficiency-rules";

const base = { contextScope: "smart" as const, timeoutMode: "normal" as const, contextWindow: 32_000 };

describe("buildKanbanEfficiencyRules level gating (W2.4a — the small-model prompt tax)", () => {
	it("full level (and the default) keeps the historical text: packs + deep large-file protocol", () => {
		const full = buildKanbanEfficiencyRules({ ...base, level: "full" });
		expect(full).toContain("## Adaptive Prompt Selection");
		expect(full).toContain("## Requirements Extraction Rules");
		expect(full).toContain("workflow cursor");
		expect(buildKanbanEfficiencyRules(base)).toBe(full); // default = full
	});

	it("lean drops the optional packs + deep protocol but keeps discipline, focus chain, basics, and budgets", () => {
		const lean = buildKanbanEfficiencyRules({ ...base, level: "lean" });
		expect(lean).not.toContain("## Adaptive Prompt Selection");
		expect(lean).not.toContain("## Requirements Extraction Rules");
		expect(lean).not.toContain("stitching areas");
		expect(lean).toContain("## Response Length And Reasoning Discipline");
		expect(lean).toContain("## Focus Chain");
		expect(lean).toContain("## Tool And Context Rules");
		expect(lean).toContain("nextCursor"); // the compact large-file one-liner survives
		expect(lean).toContain("Model context window"); // budget numbers survive
		// The whole point: materially smaller.
		const full = buildKanbanEfficiencyRules({ ...base, level: "full" });
		expect(lean.length).toBeLessThan(full.length * 0.6);
	});

	it("minimal behaves like lean", () => {
		expect(buildKanbanEfficiencyRules({ ...base, level: "minimal" })).toBe(
			buildKanbanEfficiencyRules({ ...base, level: "lean" }),
		);
	});

	it("warns that read_files line numbers are one-based and never 0 — at EVERY level", () => {
		// Sweep run 1 (2026-07-08) root cause: a worker emitted `start_line: 0`; the SDK schema is
		// `.positive()` (>=1), so it rejected the call with a bare "Invalid input" and the weak model burned
		// its whole turn budget flailing on read_files retries, never editing. The guidance must be present
		// regardless of level (the failure is not large-file specific).
		for (const level of ["full", "lean", "minimal"] as const) {
			const rules = buildKanbanEfficiencyRules({ ...base, level });
			expect(rules).toContain("ONE-BASED");
			expect(rules).toContain("never pass `0`");
		}
	});
});
