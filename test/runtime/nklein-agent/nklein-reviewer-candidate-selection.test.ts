import { describe, expect, it } from "vitest";
import type { LoadedModelDescriptor } from "../../../src/core/lmstudio-loaded-model-descriptors";
import {
	buildReviewerCandidates,
	resolveWorkerRealId,
} from "../../../src/nklein-agent/nklein-reviewer-candidate-selection";

const desc = (over: Partial<LoadedModelDescriptor>): LoadedModelDescriptor => ({
	runtimeId: "rt",
	modelKey: "key",
	isEmbedding: false,
	...over,
});

describe("resolveWorkerRealId (§5.U extraction)", () => {
	it("resolves the worker's real key from a loaded descriptor (matched by runtimeId or modelKey)", () => {
		const descriptors = [desc({ runtimeId: "worker-alias", modelKey: "publisher/worker" })];
		expect(resolveWorkerRealId(descriptors, "worker-alias")).toBe("publisher/worker");
		expect(resolveWorkerRealId(descriptors, "publisher/worker")).toBe("publisher/worker");
	});

	it("falls back to the given model id (or empty string) when not loaded", () => {
		expect(resolveWorkerRealId([], "worker-x")).toBe("worker-x");
		expect(resolveWorkerRealId([], null)).toBe("");
		expect(resolveWorkerRealId([], undefined)).toBe("");
	});
});

describe("buildReviewerCandidates (§5.U extraction)", () => {
	it("excludes embeddings and the worker's own model (by served alias or real key)", () => {
		const descriptors = [
			desc({ runtimeId: "worker-alias", modelKey: "publisher/worker" }), // worker itself → excluded
			desc({ runtimeId: "emb", modelKey: "publisher/emb", isEmbedding: true }), // embedding → excluded
			desc({ runtimeId: "rev-a", modelKey: "publisher/a" }),
			desc({ runtimeId: "rev-b", modelKey: "publisher/b" }),
		];
		const candidates = buildReviewerCandidates(descriptors, "worker-alias", "publisher/worker");
		expect(candidates).toEqual([
			{ modelKey: "rev-a", modelId: "publisher/a", score: 50 },
			{ modelKey: "rev-b", modelId: "publisher/b", score: 50 },
		]);
	});

	it("also excludes a descriptor whose modelKey matches the worker's real key", () => {
		const descriptors = [
			desc({ runtimeId: "served-dup", modelKey: "publisher/worker" }), // same real key as worker → excluded
			desc({ runtimeId: "rev-a", modelKey: "publisher/a" }),
		];
		expect(buildReviewerCandidates(descriptors, "worker-alias", "publisher/worker").map((c) => c.modelKey)).toEqual([
			"rev-a",
		]);
	});

	it("returns an empty list when only the worker / embeddings are loaded", () => {
		const descriptors = [
			desc({ runtimeId: "worker-alias", modelKey: "publisher/worker" }),
			desc({ runtimeId: "emb", modelKey: "publisher/emb", isEmbedding: true }),
		];
		expect(buildReviewerCandidates(descriptors, "worker-alias", "publisher/worker")).toEqual([]);
	});
});
