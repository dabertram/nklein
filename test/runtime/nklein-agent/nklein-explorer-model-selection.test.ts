import { describe, expect, it } from "vitest";
import type { LoadedModelDescriptor } from "../../../src/core/lmstudio-loaded-model-descriptors";
import {
	resolveExplorerLaunchConfig,
	selectSmallerExplorerModel,
} from "../../../src/nklein-agent/nklein-explorer-model-selection";

const GIB = 1024 ** 3;

function descriptor(over: Partial<LoadedModelDescriptor>): LoadedModelDescriptor {
	return {
		runtimeId: "model",
		modelKey: "model",
		isEmbedding: false,
		toolUse: true,
		loadedContextLength: 32_768,
		sizeBytes: 8 * GIB,
		...over,
	};
}

describe("selectSmallerExplorerModel", () => {
	it("picks the role-validated resident instead of a smaller model with only generic tool metadata", () => {
		const picked = selectSmallerExplorerModel(
			[
				descriptor({ runtimeId: "worker", modelKey: "qwen/qwen2.5-coder-14b", sizeBytes: 10 * GIB }),
				descriptor({
					runtimeId: "phi-small",
					modelKey: "phi-4-mini-instruct@4bit",
					sizeBytes: 2.1 * GIB,
					toolUse: false,
				}),
				descriptor({
					runtimeId: "qwopus3.5-9b-coder-mtp",
					modelKey: "qwopus3.5-9b-coder-mtp",
					sizeBytes: 6 * GIB,
				}),
			],
			"worker",
		);

		expect(picked).toMatchObject({
			runtimeId: "qwopus3.5-9b-coder-mtp",
			modelKey: "qwopus3.5-9b-coder-mtp",
		});
	});

	it("rejects sub-tier, under-context, embedding, tool-unsuitable, and non-cheaper residents", () => {
		const picked = selectSmallerExplorerModel(
			[
				descriptor({ runtimeId: "worker", modelKey: "qwen3.5-9b", sizeBytes: 6 * GIB }),
				descriptor({ runtimeId: "tiny", sizeBytes: 1 * GIB }),
				descriptor({ runtimeId: "short", sizeBytes: 2 * GIB, loadedContextLength: 16_384 }),
				descriptor({ runtimeId: "embed", sizeBytes: 2 * GIB, isEmbedding: true }),
				descriptor({ runtimeId: "chat", modelKey: "deepseek-r1-8b", sizeBytes: 4 * GIB, toolUse: false }),
				descriptor({ runtimeId: "large", sizeBytes: 7 * GIB }),
			],
			"worker",
		);

		expect(picked).toBeNull();
	});

	it("abstains when the worker footprint is unknown instead of guessing that another model is cheaper", () => {
		expect(
			selectSmallerExplorerModel(
				[
					descriptor({ runtimeId: "worker", sizeBytes: undefined }),
					descriptor({ runtimeId: "candidate", sizeBytes: 2 * GIB }),
				],
				"worker",
			),
		).toBeNull();
	});
});

describe("resolveExplorerLaunchConfig", () => {
	it("uses only already-loaded API descriptors and respects the loaded instance context", async () => {
		const fetchImpl = (async () =>
			new Response(
				JSON.stringify({
					models: [
						{
							type: "llm",
							key: "qwen/qwen2.5-coder-14b",
							size_bytes: 10 * GIB,
							max_context_length: 131_072,
							capabilities: { trained_for_tool_use: true },
							loaded_instances: [{ id: "worker", config: { context_length: 65_536 } }],
						},
						{
							type: "llm",
							key: "qwopus3.5-9b-coder-mtp",
							size_bytes: 6 * GIB,
							max_context_length: 131_072,
							capabilities: { trained_for_tool_use: true },
							loaded_instances: [{ id: "qwopus3.5-9b-coder-mtp", config: { context_length: 32_768 } }],
						},
					],
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;
		const launch = await resolveExplorerLaunchConfig(
			{
				providerId: "lmstudio",
				modelId: "worker",
				baseUrl: "http://local/v1",
				contextWindow: 65_536,
			},
			fetchImpl,
		);

		expect(launch).toMatchObject({ modelId: "qwopus3.5-9b-coder-mtp", contextWindow: 32_768 });
	});

	it("keeps the worker when the only cheaper resident has not passed the exact explorer-role gate", async () => {
		const fetchImpl = (async () =>
			new Response(
				JSON.stringify({
					models: [
						{
							type: "llm",
							key: "qwen/qwen2.5-coder-14b",
							size_bytes: 10 * GIB,
							capabilities: { trained_for_tool_use: true },
							loaded_instances: [{ id: "worker", config: { context_length: 32_768 } }],
						},
						{
							type: "llm",
							key: "phi-4-mini-instruct@4bit",
							size_bytes: 2.1 * GIB,
							capabilities: { trained_for_tool_use: true },
							loaded_instances: [{ id: "phi-small", config: { context_length: 32_768 } }],
						},
					],
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;
		const worker = {
			providerId: "lmstudio",
			modelId: "worker",
			baseUrl: "http://local/v1",
			contextWindow: 32_768,
		} as const;

		await expect(resolveExplorerLaunchConfig(worker, fetchImpl)).resolves.toEqual(worker);
	});
});
