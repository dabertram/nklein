import { describe, expect, it } from "vitest";
import type { LmsPsModel } from "../../../src/core/lms-ps-json";
import { buildResidentSetGuidance, residentModelCapForRam } from "../../../src/core/resident-set-guidance";

const GIB = 1024 ** 3;

function loaded(overrides: Partial<LmsPsModel> = {}): LmsPsModel {
	return {
		identifier: "qwen-runtime",
		modelKey: "qwen/qwen3-8b",
		indexedModelIdentifier: null,
		path: null,
		machineId: "local",
		isEmbedding: false,
		status: "loaded",
		queued: 0,
		parallel: 1,
		trainedForToolUse: true,
		contextLength: 32_000,
		...overrides,
	};
}

describe("buildResidentSetGuidance (F12.77b)", () => {
	it("aggregates real fitness cells once and emits copy-only, no-TTL warm guidance", () => {
		const [host] = buildResidentSetGuidance({
			fitnessRows: [
				{ modelKey: "lmstudio:qwen/qwen3-8b:http://127.0.0.1:1234", successCount: 5, sampleCount: 7 },
				{ modelKey: "lmstudio:qwen/qwen3-8b:default", successCount: 3, sampleCount: 5 },
			],
			catalog: [{ modelKey: "qwen/qwen3-8b", device: "local", sizeGB: 5 }],
			loadedModels: [],
			deviceRamBytes: { local: 64 * GIB },
		});
		const model = host?.recommended[0];
		expect(model).toMatchObject({
			modelId: "qwen/qwen3-8b",
			measuredFitness: 8 / 12,
			observationCount: 12,
			requestCount: 12,
			alreadyLoaded: false,
			ttlSeconds: null,
		});
		expect(model?.loadCommand).toBe("lms load 'qwen/qwen3-8b' --context-length 32000");
		expect(model?.loadCommand).not.toContain("--ttl");
		expect(model?.ttlGuidance).toContain("preserves weights and prompt caches");
	});

	it("does not suggest reloading a model already resident on that host", () => {
		const [host] = buildResidentSetGuidance({
			fitnessRows: [{ modelKey: "qwen/qwen3-8b", successCount: 8, sampleCount: 10 }],
			catalog: [{ modelKey: "qwen/qwen3-8b", device: "local", sizeGB: 5 }],
			loadedModels: [loaded()],
			deviceRamBytes: { local: 64 * GIB },
		});
		expect(host?.recommended[0]).toMatchObject({ alreadyLoaded: true, loadCommand: null });
	});

	it("joins LM Link's opaque loaded-device id to the catalog's friendly host name", () => {
		const [host] = buildResidentSetGuidance({
			fitnessRows: [{ modelKey: "qwen/qwen3-8b", successCount: 8, sampleCount: 10 }],
			catalog: [{ modelKey: "qwen/qwen3-8b", device: "legion5pro", sizeGB: 5 }],
			loadedModels: [loaded({ machineId: "opaque-device-id" })],
			deviceNamesById: new Map([["opaque-device-id", "legion5pro"]]),
			deviceRamBytes: { legion5pro: 8 * GIB },
		});
		expect(host?.recommended[0]).toMatchObject({ alreadyLoaded: true, loadCommand: null });
	});

	it("uses the same one-model/small-host and three-model/large-host caps as production retention", () => {
		expect(residentModelCapForRam(32 * GIB)).toBe(1);
		expect(residentModelCapForRam(64 * GIB)).toBe(3);
		const rows = ["a", "b"].map((modelKey, index) => ({
			modelKey,
			successCount: 8,
			sampleCount: 10 - index,
		}));
		const [small] = buildResidentSetGuidance({
			fitnessRows: rows,
			catalog: [
				{ modelKey: "a", device: "small", sizeGB: 2 },
				{ modelKey: "b", device: "small", sizeGB: 2 },
			],
			loadedModels: [],
			deviceRamBytes: { small: 32 * GIB },
		});
		expect(small?.recommended).toHaveLength(1);
		expect(small?.excluded).toContainEqual(expect.objectContaining({ reason: "host_cap" }));
	});

	it("fails closed for a linked host without an explicit RAM budget", () => {
		expect(
			buildResidentSetGuidance({
				fitnessRows: [{ modelKey: "qwen", successCount: 8, sampleCount: 10 }],
				catalog: [{ modelKey: "qwen", device: "unknown-link", sizeGB: 5 }],
				loadedModels: [],
				deviceRamBytes: { local: 64 * GIB },
			}),
		).toEqual([]);
	});

	it("keeps one-off probe TTL guidance separate from the warm set", () => {
		const [host] = buildResidentSetGuidance({
			fitnessRows: [{ modelKey: "qwen", successCount: 8, sampleCount: 10 }],
			catalog: [{ modelKey: "qwen", device: "local", sizeGB: 5 }],
			loadedModels: [],
			deviceRamBytes: { local: 64 * GIB },
		});
		expect(host?.probeTtlSeconds).toBe(60);
		expect(host?.probeTtlGuidance).toContain("one-off probe only");
	});
});
