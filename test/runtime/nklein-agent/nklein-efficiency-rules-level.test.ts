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

	it("planner scope drops the write/run rules a read-only decompose seed cannot use (G6.8a)", () => {
		// Planning seeds are read-only + decompose_project (§5.B); the full worker rule text linted at 116
		// instruction units against a cap of 60 on every architect start, and real 27–31B architects kept
		// failing decompose under it. Rules about absent tools are budget noise + pink-elephant bait.
		const planner = buildKanbanEfficiencyRules({ ...base, plannerScope: true });
		expect(planner).not.toContain("`run_commands`");
		expect(planner).not.toContain("`write_file`");
		expect(planner).not.toContain("write_files");
		expect(planner).not.toContain("stitching areas"); // deep large-file protocol dropped
		expect(planner).not.toContain("## Adaptive Prompt Selection");
		expect(planner).not.toContain("## Requirements Extraction Rules");
		// What a planner still needs: discipline, its plan tracker, discovery/read rules, budgets, the
		// anti-re-read rail, and the file-size discipline reshaped as card-sizing guidance.
		expect(planner).toContain("## Response Length And Reasoning Discipline");
		expect(planner).toContain("## Focus Chain");
		expect(planner).toContain("list_files");
		expect(planner).toContain("never re-read covered ranges");
		expect(planner).toContain("Model context window");
		expect(planner).toContain("When sizing cards");
		const full = buildKanbanEfficiencyRules({ ...base, level: "full" });
		expect(planner.length).toBeLessThan(full.length * 0.5);
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
