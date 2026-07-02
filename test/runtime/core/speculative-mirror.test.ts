import { describe, expect, it } from "vitest";
import { decideSpeculativeMirror, type SpeculativeMirrorDecisionInput } from "../../../src/core/speculative-mirror";

/** A healthy mirror-ready snapshot: one hard card on a qwen worker, a diverse gpt-oss model idle. */
const READY: SpeculativeMirrorDecisionInput = {
	enabled: true,
	maxConcurrentSpecs: 1,
	maxSpecsPerRun: 3,
	runningSpecCount: 0,
	specsStartedThisRun: 0,
	queuedRealStartCount: 0,
	deferredRealCardCount: 0,
	runningWorkers: [{ taskId: "t1", modelId: "qwen9-m4", difficulty: 60, startedAt: 1000 }],
	idleModels: [{ modelId: "gptoss120-m5" }],
	alreadyMirroredTaskIds: new Set(),
};

describe("decideSpeculativeMirror (§5.AW opportunistic best-of-N)", () => {
	it("mirrors the running card onto a lineage-diverse idle model", () => {
		const decision = decideSpeculativeMirror(READY);
		expect(decision).toMatchObject({ action: "mirror", taskId: "t1", mirrorModelId: "gptoss120-m5" });
	});

	it("does nothing when disabled", () => {
		expect(decideSpeculativeMirror({ ...READY, enabled: false }).action).toBe("none");
	});

	it("respects the concurrent-spec ceiling and the per-run budget", () => {
		expect(decideSpeculativeMirror({ ...READY, runningSpecCount: 1 }).action).toBe("none");
		expect(decideSpeculativeMirror({ ...READY, specsStartedThisRun: 3 }).action).toBe("none");
	});

	it("real work outranks speculation: queued or deferred real cards veto mirroring", () => {
		expect(decideSpeculativeMirror({ ...READY, queuedRealStartCount: 1 }).action).toBe("none");
		expect(decideSpeculativeMirror({ ...READY, deferredRealCardCount: 2 }).action).toBe("none");
	});

	it("never mirrors onto a same-lineage or unknown-lineage idle model (correlated waste)", () => {
		// qwen worker + qwen idle → same family; a made-up id has unknown lineage.
		expect(decideSpeculativeMirror({ ...READY, idleModels: [{ modelId: "qwen3.5-9b-mlx" }] }).action).toBe("none");
		expect(decideSpeculativeMirror({ ...READY, idleModels: [{ modelId: "mystery-model-x" }] }).action).toBe("none");
	});

	it("picks the hardest running card first, falling back when it was already mirrored", () => {
		const twoCards: SpeculativeMirrorDecisionInput = {
			...READY,
			runningWorkers: [
				{ taskId: "easy", modelId: "qwen9-m4", difficulty: 20, startedAt: 1000 },
				{ taskId: "hard", modelId: "qwen9-m4", difficulty: 80, startedAt: 2000 },
			],
		};
		expect(decideSpeculativeMirror(twoCards)).toMatchObject({ action: "mirror", taskId: "hard" });
		expect(decideSpeculativeMirror({ ...twoCards, alreadyMirroredTaskIds: new Set(["hard"]) })).toMatchObject({
			action: "mirror",
			taskId: "easy",
		});
	});

	it("unknown difficulty sorts last; longest-running breaks ties deterministically", () => {
		const decision = decideSpeculativeMirror({
			...READY,
			runningWorkers: [
				{ taskId: "unknown", modelId: "qwen9-m4", difficulty: null, startedAt: 500 },
				{ taskId: "older", modelId: "qwen9-m4", difficulty: 40, startedAt: 1000 },
				{ taskId: "newer", modelId: "qwen9-m4", difficulty: 40, startedAt: 2000 },
			],
		});
		expect(decision).toMatchObject({ action: "mirror", taskId: "older" });
	});

	it("does nothing with no running worker or no idle model", () => {
		expect(decideSpeculativeMirror({ ...READY, runningWorkers: [] }).action).toBe("none");
		expect(decideSpeculativeMirror({ ...READY, idleModels: [] }).action).toBe("none");
	});
});
