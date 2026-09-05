import { describe, expect, it } from "vitest";
import type { LoadedModelDescriptor } from "../../../src/core/lmstudio-loaded-model-descriptors";
import {
	buildReviewerCandidates,
	quantizationPenalty,
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
		// Uncatalogued ids resolve to the neutral unknown/UNKNOWN reviewer-fit (42); equal scores keep stable modelKey order.
		expect(candidates).toEqual([
			{ modelKey: "rev-a", modelId: "publisher/a", score: 42 },
			{ modelKey: "rev-b", modelId: "publisher/b", score: 42 },
		]);
	});

	it("scores by catalog REVIEWER-class fit and returns best-first: reasoning > unknown > chat (depth-aware judge)", () => {
		const descriptors = [
			desc({ runtimeId: "chat-rt", modelKey: "gemma-3-12b-it" }), // chat kind → weak reviewer fit
			desc({ runtimeId: "unk-rt", modelKey: "publisher/uncatalogued" }), // unknown → neutral 42
			desc({ runtimeId: "reason-rt", modelKey: "phi-4-reasoning-plus" }), // reasoning kind → strong reviewer fit
		];
		const candidates = buildReviewerCandidates(descriptors, "worker-alias", "publisher/worker");
		// Best-first regardless of descriptor order: the reasoning model judges, the chat model is last.
		expect(candidates.map((c) => c.modelKey)).toEqual(["reason-rt", "unk-rt", "chat-rt"]);
		const [reasoning, unknown, chat] = candidates;
		expect(reasoning.score).toBeGreaterThan(unknown.score);
		expect(unknown.score).toBeGreaterThan(chat.score);
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

describe("P0.REVRANK lite (live 2026-09-05): fit ties prefer the larger context and the lighter quantization", () => {
	const descriptor = (runtimeId: string, modelKey: string, loadedContextLength: number) =>
		({ runtimeId, modelKey, isEmbedding: false, loadedContextLength }) as never;

	it("orders three instances of the same 27B by quant penalty, then loaded context", () => {
		const candidates = buildReviewerCandidates(
			[
				descriptor("dirk-qwen3.8-27b@m4mini", "dirk-qwen3.8-27b@q2_k_xl", 32768),
				descriptor("dirk-qwen3.8-27b", "dirk-qwen3.8-27b@q4_k_s", 50432),
				descriptor("dirk-qwen3.8-27b@legion", "dirk-qwen3.8-27b@q6_k", 60160),
			],
			"qwen3.8-flash-next",
			"qwen3.8-flash-next",
		);
		expect(candidates.map((candidate) => candidate.modelKey)).toEqual([
			"dirk-qwen3.8-27b@legion",
			"dirk-qwen3.8-27b",
			"dirk-qwen3.8-27b@m4mini",
		]);
		expect(candidates[0]).not.toHaveProperty("contextLength");
	});

	it("reads the quantization from served ids and real keys", () => {
		expect(quantizationPenalty("dirk-qwen3.8-27b@q2_k_xl")).toBe(2);
		expect(quantizationPenalty("model iq2_xxs")).toBe(2);
		expect(quantizationPenalty("dirk-qwen3.8-27b@iq3_xs")).toBe(1);
		expect(quantizationPenalty("dirk-qwen3.8-27b@q4_k_s")).toBe(0);
		expect(quantizationPenalty("qwen3.8-flash-next")).toBe(0);
	});
});
