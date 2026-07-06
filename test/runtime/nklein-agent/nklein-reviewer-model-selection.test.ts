import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fetchLoadedModelDescriptors: vi.fn(async (_baseUrl: string) => [] as Array<Record<string, unknown>>),
}));
vi.mock("../../../src/core/lmstudio-loaded-model-descriptors", () => ({
	fetchLoadedModelDescriptors: mocks.fetchLoadedModelDescriptors,
}));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: vi.fn() }));

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
});
