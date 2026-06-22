import { describe, expect, it } from "vitest";

import {
	DEFAULT_MODEL_SELECTION_WEIGHTING,
	type RoleModelCandidate,
	selectRoleModel,
} from "../../../src/core/role-model-selection";

function candidate(overrides: Partial<RoleModelCandidate> & { modelKey: string }): RoleModelCandidate {
	return {
		capability: 50,
		contextWindow: 128_000,
		predictedWallTimeMs: 1000,
		isFree: true,
		...overrides,
	};
}

describe("selectRoleModel", () => {
	it("defaults to the efficient (smallest-sufficient) weighting", () => {
		expect(DEFAULT_MODEL_SELECTION_WEIGHTING).toBe("efficient");
	});

	it("returns no_fit when no candidate clears the difficulty floor", () => {
		const result = selectRoleModel({
			candidates: [candidate({ modelKey: "small", capability: 30 })],
			difficulty: 60,
			requiredContextTokens: 32_000,
		});
		expect(result.type).toBe("no_fit");
	});

	it("returns no_fit when no candidate holds the required context", () => {
		const result = selectRoleModel({
			candidates: [candidate({ modelKey: "small-ctx", capability: 90, contextWindow: 32_000 })],
			difficulty: 40,
			requiredContextTokens: 200_000,
		});
		expect(result.type).toBe("no_fit");
	});

	it("efficient weighting picks the smallest sufficient model (easy card → fast/small)", () => {
		const result = selectRoleModel({
			candidates: [
				candidate({ modelKey: "big", capability: 90 }),
				candidate({ modelKey: "small", capability: 45 }),
				candidate({ modelKey: "mid", capability: 65 }),
			],
			difficulty: 40,
			requiredContextTokens: 32_000,
		});
		expect(result).toMatchObject({ type: "assign", modelKey: "small", busyFallback: false });
	});

	it("a hard card is forced onto a capable model by the difficulty floor", () => {
		const result = selectRoleModel({
			candidates: [candidate({ modelKey: "small", capability: 45 }), candidate({ modelKey: "big", capability: 90 })],
			difficulty: 80,
			requiredContextTokens: 32_000,
		});
		expect(result).toMatchObject({ type: "assign", modelKey: "big" });
	});

	it("capability weighting picks the most capable feasible model", () => {
		const result = selectRoleModel({
			candidates: [candidate({ modelKey: "mid", capability: 65 }), candidate({ modelKey: "big", capability: 90 })],
			difficulty: 40,
			requiredContextTokens: 32_000,
			weighting: "capability",
		});
		expect(result).toMatchObject({ type: "assign", modelKey: "big" });
	});

	it("speed weighting picks the fastest feasible model regardless of size", () => {
		const result = selectRoleModel({
			candidates: [
				candidate({ modelKey: "slow-big", capability: 90, predictedWallTimeMs: 5000 }),
				candidate({ modelKey: "fast-mid", capability: 65, predictedWallTimeMs: 800 }),
			],
			difficulty: 50,
			requiredContextTokens: 32_000,
			weighting: "speed",
		});
		expect(result).toMatchObject({ type: "assign", modelKey: "fast-mid" });
	});

	it("never picks a busy model when a feasible free one exists", () => {
		const result = selectRoleModel({
			candidates: [
				candidate({ modelKey: "busy-small", capability: 50, isFree: false }),
				candidate({ modelKey: "free-big", capability: 90, isFree: true }),
			],
			difficulty: 40,
			requiredContextTokens: 32_000,
		});
		// Even though efficient weighting prefers the smaller model, the smaller one is busy.
		expect(result).toMatchObject({ type: "assign", modelKey: "free-big", busyFallback: false });
	});

	it("falls back to the best busy model (and flags it) when all feasible models are busy", () => {
		const result = selectRoleModel({
			candidates: [
				candidate({ modelKey: "busy-small", capability: 45, isFree: false }),
				candidate({ modelKey: "busy-mid", capability: 65, isFree: false }),
			],
			difficulty: 40,
			requiredContextTokens: 32_000,
		});
		expect(result).toMatchObject({ type: "assign", modelKey: "busy-small", busyFallback: true });
	});

	it("honors a pinned model whenever it is feasible, even if a free alternative exists", () => {
		const result = selectRoleModel({
			candidates: [
				candidate({ modelKey: "free-small", capability: 50, isFree: true }),
				candidate({ modelKey: "pinned-big", capability: 90, isFree: true }),
			],
			difficulty: 40,
			requiredContextTokens: 32_000,
			pinnedModelKey: "pinned-big",
		});
		expect(result).toMatchObject({ type: "assign", modelKey: "pinned-big" });
	});

	it("ignores a pinned model that is not feasible and selects from the rest", () => {
		const result = selectRoleModel({
			candidates: [
				candidate({ modelKey: "pinned-weak", capability: 30, isFree: true }),
				candidate({ modelKey: "ok", capability: 70, isFree: true }),
			],
			difficulty: 50,
			requiredContextTokens: 32_000,
			pinnedModelKey: "pinned-weak",
		});
		expect(result).toMatchObject({ type: "assign", modelKey: "ok" });
	});

	it("flags busyFallback when the pinned feasible model is busy", () => {
		const result = selectRoleModel({
			candidates: [candidate({ modelKey: "pinned", capability: 80, isFree: false })],
			difficulty: 50,
			requiredContextTokens: 32_000,
			pinnedModelKey: "pinned",
		});
		expect(result).toMatchObject({ type: "assign", modelKey: "pinned", busyFallback: true });
	});
});
