import { describe, expect, it } from "vitest";
import { buildAttemptEvent, buildSchedulerEvent } from "../../../src/core/agent-attempt-ledger";
import {
	buildMemoryLayers,
	projectEpisodicMemory,
	projectProceduralMemory,
	projectSemanticMemory,
	projectWorkingMemory,
} from "../../../src/core/memory-layers";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";

const base = { workflowId: "wf", taskId: "task-1", workspacePathHash: "ws" };

function attempt(modelId: string, outcome: ModelOutcomeKind, recordedAt: number, retriesBefore = 0) {
	return buildAttemptEvent({
		...base,
		attemptId: `${modelId}-${recordedAt}`,
		modelId,
		outcome,
		retriesBefore,
		recordedAt,
	});
}

describe("memory layers (§5.M working/episodic/semantic/procedural)", () => {
	describe("working layer", () => {
		it("projects the active goal + current step as the highest-salience records", () => {
			const records = projectWorkingMemory({
				taskId: "task-1",
				activeGoal: "ship the fix",
				currentStep: "write tests",
			});
			expect(records.map((r) => r.text)).toEqual(["Active goal: ship the fix", "Current step: write tests"]);
			expect(records[0]?.salience).toBe(1);
			expect(records.every((r) => r.layer === "working")).toBe(true);
		});

		it("drops empty/absent fields", () => {
			expect(projectWorkingMemory({})).toEqual([]);
			expect(projectWorkingMemory({ activeGoal: "   " })).toEqual([]);
		});
	});

	describe("episodic layer", () => {
		it("projects recent attempts newest-first, capped to the limit", () => {
			const events = [attempt("m", "success", 1), attempt("m", "timeout", 2), attempt("m", "success", 3)];
			const records = projectEpisodicMemory(events, { limit: 2 });
			expect(records).toHaveLength(2);
			expect(records[0]?.recordedAt).toBe(3); // newest first
			expect(records[1]?.recordedAt).toBe(2);
			expect(records[0]?.salience).toBeGreaterThan(records[1]?.salience ?? 1); // recency decay
		});

		it("ignores non-attempt events and gives a failure a small salience bump over a same-rank success", () => {
			const withScheduler = [buildSchedulerEvent({ ...base, event: "queued" }), attempt("m", "timeout", 5)];
			const records = projectEpisodicMemory(withScheduler);
			expect(records).toHaveLength(1);
			expect(records[0]?.text).toContain("→ timeout");
			// A failing outcome at rank 0 gets the +0.1 bump (clamped at 1).
			expect(records[0]?.salience).toBe(1);
		});

		it("notes retries in the episode text", () => {
			const records = projectEpisodicMemory([attempt("m", "success", 1, 2)]);
			expect(records[0]?.text).toContain("after 2 retries");
		});

		it("returns nothing for an empty ledger or a zero limit", () => {
			expect(projectEpisodicMemory([])).toEqual([]);
			expect(projectEpisodicMemory([attempt("m", "success", 1)], { limit: 0 })).toEqual([]);
		});
	});

	describe("semantic layer", () => {
		it("distills per-model facts from the episode stream (reusing the fitness projection)", () => {
			const events = [
				attempt("model-A", "success", 1),
				attempt("model-A", "success", 2),
				attempt("model-A", "timeout", 3),
			];
			const facts = projectSemanticMemory(events);
			expect(facts.length).toBeGreaterThan(0);
			expect(facts[0]?.layer).toBe("semantic");
			expect(facts[0]?.text).toContain("model-A");
			expect(facts[0]?.salience).toBeGreaterThan(0);
			expect(facts[0]?.salience).toBeLessThanOrEqual(1);
		});

		it("is empty when there are no attempts", () => {
			expect(projectSemanticMemory([])).toEqual([]);
		});
	});

	describe("procedural layer", () => {
		it("projects the skill registry as available procedures", () => {
			const records = projectProceduralMemory();
			expect(records.length).toBeGreaterThan(0);
			expect(records.every((r) => r.layer === "procedural" && r.recordedAt === null)).toBe(true);
			expect(records.some((r) => r.id === "procedural:code_editing")).toBe(true);
		});

		it("filters to a requested skill subset", () => {
			const records = projectProceduralMemory(["planning"]);
			expect(records).toHaveLength(1);
			expect(records[0]?.id).toBe("procedural:planning");
		});
	});

	describe("buildMemoryLayers", () => {
		it("assembles all four layers + a salience-ranked flat view", () => {
			const events = [attempt("model-A", "success", 1), attempt("model-A", "timeout", 2)];
			const layers = buildMemoryLayers({
				snapshot: { taskId: "task-1", activeGoal: "cap the score" },
				events,
				skillIds: ["code_editing"],
				episodicLimit: 5,
			});
			expect(layers.working).toHaveLength(1);
			expect(layers.episodic).toHaveLength(2);
			expect(layers.semantic.length).toBeGreaterThan(0);
			expect(layers.procedural).toHaveLength(1);
			// The flat view is a superset, sorted salience-descending (stable).
			expect(layers.all).toHaveLength(
				layers.working.length + layers.episodic.length + layers.semantic.length + layers.procedural.length,
			);
			for (let i = 1; i < layers.all.length; i += 1) {
				expect(layers.all[i - 1]?.salience).toBeGreaterThanOrEqual(layers.all[i]?.salience ?? 0);
			}
			// The working goal (salience 1) leads the flat view.
			expect(layers.all[0]?.layer).toBe("working");
		});

		it("is total over an empty input", () => {
			const layers = buildMemoryLayers();
			expect(layers.working).toEqual([]);
			expect(layers.episodic).toEqual([]);
			expect(layers.semantic).toEqual([]);
			expect(layers.procedural.length).toBeGreaterThan(0); // skills are always available
			expect(layers.all).toEqual(layers.procedural);
		});
	});
});
