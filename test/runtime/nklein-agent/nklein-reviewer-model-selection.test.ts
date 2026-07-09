import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fetchLoadedModelDescriptors: vi.fn(async (_baseUrl: string) => [] as Array<Record<string, unknown>>),
	recordSelfObservation: vi.fn(),
}));
vi.mock("../../../src/core/lmstudio-loaded-model-descriptors", () => ({
	fetchLoadedModelDescriptors: mocks.fetchLoadedModelDescriptors,
}));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: mocks.recordSelfObservation,
}));

import { buildPromptShellKey } from "../../../src/core/cache-warmth";
import { pickDiverseReviewerModel } from "../../../src/nklein-agent/nklein-reviewer-model-selection";

const workerLaunch = { providerId: "lmstudio", modelId: "worker-m", baseUrl: "http://127.0.0.1:1234/v1" } as never;
const deps = { lastShellKeyByModel: new Map() };

beforeEach(() => vi.clearAllMocks());

describe("pickDiverseReviewerModel", () => {
	it("returns null when no models are loaded (empty descriptors)", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce([]);
		expect(await pickDiverseReviewerModel(workerLaunch, "t1", "review", deps)).toBeNull();
	});

	it("returns null when the only loaded model is the worker's own (no reviewer candidate)", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce([
			{ runtimeId: "worker-m", modelKey: "worker-m", isEmbedding: false },
		]);
		expect(await pickDiverseReviewerModel(workerLaunch, "t1", "review", deps)).toBeNull();
	});

	it("swallows a descriptor-fetch failure and returns null (best-effort, never throws)", async () => {
		mocks.fetchLoadedModelDescriptors.mockRejectedValueOnce(new Error("lmstudio down"));
		await expect(pickDiverseReviewerModel(workerLaunch, "t1", "review", deps)).resolves.toBeNull();
	});

	it("a WARM shallow diverse model does NOT displace a COLD deep diverse judge (warmth capability-margin-bounded)", async () => {
		// Worker is qwen; two diverse candidates: a DEEP reasoning judge (cold) and a SHALLOW chat model (warm).
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce([
			{ runtimeId: "phi-rt", modelKey: "phi-4-reasoning-plus", isEmbedding: false }, // reasoning → high reviewer-fit, COLD
			{ runtimeId: "gemma-rt", modelKey: "gemma-3-12b-it", isEmbedding: false }, // chat → low reviewer-fit, WARM
		]);
		const qwenWorker = {
			providerId: "lmstudio",
			modelId: "qwen3.6-27b",
			baseUrl: "http://127.0.0.1:1234/v1",
		} as never;
		// Make the shallow gemma HOT for the review shell (its ledger is keyed by the candidate's servable id = runtimeId).
		const warmDeps = {
			lastShellKeyByModel: new Map([
				[
					"gemma-rt",
					{
						shellKey: buildPromptShellKey({ sessionKind: "review", workspacePath: "", modelId: "gemma-rt" }),
						at: Date.now(),
					},
				],
			]),
		};
		const pick = await pickDiverseReviewerModel(qwenWorker, "t2", "review", warmDeps);
		// Depth wins: the 60-pt reviewer-fit gap exceeds the 10-pt warmth margin, so warmth can't promote the shallow model.
		// (Under the old flat score:50, the margin was inert and the warm shallow model would have been picked.)
		expect(pick?.modelId).toBe("phi-rt");
	});

	it("labels auto-picked escalation workers as escalation workers, not reviewers", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce([
			{ runtimeId: "worker-m", modelKey: "qwen/qwen3-8b", isEmbedding: false },
			{ runtimeId: "devstral-rt", modelKey: "mistralai/devstral-small-2-2512", isEmbedding: false },
		]);

		const pick = await pickDiverseReviewerModel(workerLaunch, "t3", "worker", deps);

		expect(pick?.modelId).toBe("devstral-rt");
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("Auto-picked lineage-diverse escalation worker devstral-rt"),
				metadata: expect.objectContaining({ category: "escalation_worker_auto_diverse" }),
			}),
		);
	});
});
