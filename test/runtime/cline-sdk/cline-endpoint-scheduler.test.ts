import { describe, expect, it } from "vitest";

import { scheduleClineEndpointStart } from "../../../src/cline-sdk/cline-endpoint-scheduler";
import type { ClineModelRegistrySnapshot } from "../../../src/cline-sdk/cline-model-registry";

function createSnapshot(sharedEndpointId: string | null = "gpu-0"): ClineModelRegistrySnapshot {
	return {
		schemaVersion: 1,
		updatedAt: 1,
		models: {
			"ollama:qwen:local": {
				key: "ollama:qwen:local",
				providerId: "ollama",
				modelId: "qwen",
				endpoint: "local",
				contextWindow: {
					advertised: null,
					observed: 16_000,
					userOverride: null,
					effective: 16_000,
				},
				speed: {
					samples: 0,
					promptTokensEwma: null,
					outputTokensEwma: null,
					totalTokensEwma: null,
					prefillTokensPerSecondEwma: null,
					decodeTokensPerSecondEwma: null,
					ttftMsEwma: null,
					wallTimeMsEwma: null,
					wallTimeMsPer1kPromptTokensEwma: null,
					lastPromptTokens: null,
					lastOutputTokens: null,
					lastWallTimeMs: null,
					lastObservedAt: null,
				},
				capability: {
					samples: 0,
					staticPrior: 35,
					evalScore: null,
					externalScore: null,
					observedPassRate: null,
					effectiveScore: 35,
					lastObservedAt: null,
				},
				constraints: {
					sharedEndpointId,
					inputCostPerMillionTokens: null,
					outputCostPerMillionTokens: null,
				},
				createdAt: 1,
				updatedAt: 1,
			},
		},
	};
}

describe("cline endpoint scheduler", () => {
	it("blocks a second running task on the same shared endpoint", () => {
		const decision = scheduleClineEndpointStart({
			taskId: "task-2",
			providerId: "ollama",
			modelId: "qwen",
			endpoint: "local",
			modelRegistry: createSnapshot("gpu-0"),
			runningSessions: [
				{
					taskId: "task-1",
					state: "running",
					providerId: "ollama",
					modelId: "qwen",
					endpoint: "local",
				},
			],
		});

		expect(decision).toMatchObject({
			ok: false,
			blockedByTaskId: "task-1",
			sharedEndpointId: "gpu-0",
		});
	});

	it("allows cloud providers without an explicit shared endpoint", () => {
		const decision = scheduleClineEndpointStart({
			taskId: "task-2",
			providerId: "anthropic",
			modelId: "claude-sonnet",
			endpoint: null,
			modelRegistry: createSnapshot(null),
			runningSessions: [
				{
					taskId: "task-1",
					state: "running",
					providerId: "anthropic",
					modelId: "claude-sonnet",
					endpoint: null,
				},
			],
		});

		expect(decision).toEqual({ ok: true });
	});

	it("does not serialize cloud providers even when old registry data has a default shared endpoint", () => {
		const modelRegistry: ClineModelRegistrySnapshot = {
			schemaVersion: 1,
			updatedAt: 1,
			models: {
				"anthropic:claude-sonnet:default": {
					...createSnapshot(null).models["ollama:qwen:local"],
					key: "anthropic:claude-sonnet:default",
					providerId: "anthropic",
					modelId: "claude-sonnet",
					endpoint: null,
					constraints: {
						sharedEndpointId: "anthropic:default",
						inputCostPerMillionTokens: null,
						outputCostPerMillionTokens: null,
					},
				},
			},
		};

		const decision = scheduleClineEndpointStart({
			taskId: "task-2",
			providerId: "anthropic",
			modelId: "claude-sonnet",
			endpoint: null,
			modelRegistry,
			runningSessions: [
				{
					taskId: "task-1",
					state: "running",
					providerId: "anthropic",
					modelId: "claude-sonnet",
					endpoint: null,
				},
			],
		});

		expect(decision).toEqual({ ok: true });
	});

	it("uses conservative local-provider fallback when registry data is cold", () => {
		const decision = scheduleClineEndpointStart({
			taskId: "task-2",
			providerId: "ollama",
			modelId: "qwen",
			endpoint: "http://127.0.0.1:11434",
			modelRegistry: {
				schemaVersion: 1,
				updatedAt: 0,
				models: {},
			},
			runningSessions: [
				{
					taskId: "task-1",
					state: "running",
					providerId: "ollama",
					modelId: "llama",
					endpoint: "http://127.0.0.1:11434",
				},
			],
		});

		expect(decision).toMatchObject({
			ok: false,
			blockedByTaskId: "task-1",
			sharedEndpointId: "http://127.0.0.1:11434",
		});
	});

	it("serializes custom local providers by endpoint when registry data is cold", () => {
		const decision = scheduleClineEndpointStart({
			taskId: "task-2",
			providerId: "openai-compatible",
			modelId: "qwen",
			endpoint: "http://127.0.0.1:1234/v1",
			modelRegistry: {
				schemaVersion: 1,
				updatedAt: 0,
				models: {},
			},
			runningSessions: [
				{
					taskId: "task-1",
					state: "running",
					providerId: "openai-compatible",
					modelId: "llama",
					endpoint: "http://127.0.0.1:1234/v1",
				},
			],
		});

		expect(decision).toMatchObject({
			ok: false,
			blockedByTaskId: "task-1",
			sharedEndpointId: "http://127.0.0.1:1234/v1",
		});
	});

	it("allows custom local providers on distinct endpoints to run in parallel", () => {
		const decision = scheduleClineEndpointStart({
			taskId: "task-2",
			providerId: "openai-compatible",
			modelId: "qwen",
			endpoint: "http://127.0.0.1:1235/v1",
			modelRegistry: {
				schemaVersion: 1,
				updatedAt: 0,
				models: {},
			},
			runningSessions: [
				{
					taskId: "task-1",
					state: "running",
					providerId: "openai-compatible",
					modelId: "llama",
					endpoint: "http://127.0.0.1:1234/v1",
				},
			],
		});

		expect(decision).toEqual({ ok: true });
	});
});
