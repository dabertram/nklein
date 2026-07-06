import { describe, expect, it } from "vitest";
import type { RuntimeBoardCard, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { deriveTaskFitnessRecord } from "../../../src/nklein-agent/task-fitness-recording";

const summary = (over: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary =>
	({
		taskId: "task-1",
		providerId: "lmstudio",
		modelId: "coder",
		endpoint: null,
		state: "awaiting_review",
		startedAt: 1000,
		updatedAt: 4000,
		...over,
	}) as RuntimeTaskSessionSummary;

const card = (over: Partial<RuntimeBoardCard> = {}): RuntimeBoardCard =>
	({ id: "task-1", title: "Add a widget", ...over }) as RuntimeBoardCard;

describe("deriveTaskFitnessRecord (§5.AB write side)", () => {
	it("awaiting_review ⇒ a success record with the model×role×difficulty cell + wall time", () => {
		const r = deriveTaskFitnessRecord({ summary: summary(), card: card() });
		expect(r).not.toBeNull();
		expect(r?.key.modelKey).toBe("lmstudio:coder:default");
		expect(r?.key.role).toBe("worker");
		expect(["easy", "medium", "hard"]).toContain(r?.key.difficultyTier);
		expect(r?.outcome.success).toBe(true);
		expect(r?.outcome.wallTimeMs).toBe(3000); // 4000 - 1000
		expect(r?.outcome.failureMode).toBeUndefined();
	});

	it("§5.BG: keys off the STABLE modelKey when present (fitness is display/inert — safe to key stably)", () => {
		// A model measured under two renamed instances (`coder`, `coder-gpu`) must land in ONE fitness cell — keyed by the
		// stable publisher key, so the fitness browser shows merged history instead of two fragments after a rename.
		const a = deriveTaskFitnessRecord({
			summary: summary({ modelId: "coder", modelKey: "qwen2.5-coder-14b" }),
			card: card(),
		});
		const b = deriveTaskFitnessRecord({
			summary: summary({ modelId: "coder-gpu", modelKey: "qwen2.5-coder-14b" }),
			card: card(),
		});
		expect(a?.key.modelKey).toBe("lmstudio:qwen2.5-coder-14b:default");
		expect(b?.key.modelKey).toBe(a?.key.modelKey);
	});

	it("§5.BG: falls back to the runtime modelId when no stable modelKey (cloud / legacy summary)", () => {
		const r = deriveTaskFitnessRecord({ summary: summary({ modelId: "coder", modelKey: null }), card: card() });
		expect(r?.key.modelKey).toBe("lmstudio:coder:default");
	});

	it("failed ⇒ a failure record with a failure mode", () => {
		const r = deriveTaskFitnessRecord({ summary: summary({ state: "failed" }), card: card() });
		expect(r?.outcome.success).toBe(false);
		expect(r?.outcome.failureMode).toBe("task_failed");
	});

	it("a decomposition card ⇒ role architect", () => {
		const r = deriveTaskFitnessRecord({
			summary: summary(),
			card: card({ generatedFromPlan: { artifactKind: "decomposition" } } as Partial<RuntimeBoardCard>),
		});
		expect(r?.key.role).toBe("architect");
	});

	it("skips synthetic sessions (:: in taskId)", () => {
		expect(deriveTaskFitnessRecord({ summary: summary({ taskId: "task-1::review" }), card: null })).toBeNull();
	});

	it("skips a session with no model coordinates", () => {
		expect(deriveTaskFitnessRecord({ summary: summary({ providerId: null, modelId: null }), card: null })).toBeNull();
	});

	it("skips non-terminal / unclassifiable states", () => {
		for (const state of ["running", "queued", "idle", "interrupted"] as const) {
			expect(deriveTaskFitnessRecord({ summary: summary({ state }), card: null })).toBeNull();
		}
	});
});
