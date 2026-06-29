import { describe, expect, it } from "vitest";

import { scheduleNKleinEndpointStart } from "../../../src/nklein-agent/nklein-endpoint-scheduler";
import type { NKleinModelRegistrySnapshot } from "../../../src/nklein-agent/nklein-model-registry";

function createSnapshot(sharedEndpointId: string | null = "gpu-0"): NKleinModelRegistrySnapshot {
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
					maxConcurrentRequests: null,
				},
				createdAt: 1,
				updatedAt: 1,
			},
		},
	};
}

describe("nklein endpoint scheduler", () => {
	it("blocks a second running task on the same shared endpoint", () => {
		const decision = scheduleNKleinEndpointStart({
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

	it("allows concurrent sessions up to a per-model maxConcurrentRequests, then blocks", () => {
		const runningSession = (taskId: string) => ({
			taskId,
			state: "running" as const,
			providerId: "ollama",
			modelId: "qwen",
			endpoint: "local",
		});
		const snapshotWithLimit = (limit: number): NKleinModelRegistrySnapshot => {
			const snapshot = createSnapshot("gpu-0");
			const entry = snapshot.models["ollama:qwen:local"];
			if (!entry) {
				throw new Error("Expected registry entry.");
			}
			entry.constraints.maxConcurrentRequests = limit;
			return snapshot;
		};

		// limit 2, one already running -> the second is allowed.
		expect(
			scheduleNKleinEndpointStart({
				taskId: "task-2",
				providerId: "ollama",
				modelId: "qwen",
				endpoint: "local",
				modelRegistry: snapshotWithLimit(2),
				runningSessions: [runningSession("task-1")],
			}),
		).toEqual({ ok: true });

		// limit 2, two already running -> at capacity, the third is blocked with a capacity note.
		expect(
			scheduleNKleinEndpointStart({
				taskId: "task-3",
				providerId: "ollama",
				modelId: "qwen",
				endpoint: "local",
				modelRegistry: snapshotWithLimit(2),
				runningSessions: [runningSession("task-1"), runningSession("task-2")],
			}),
		).toMatchObject({
			ok: false,
			sharedEndpointId: "gpu-0",
			reason: expect.stringContaining("2 concurrent-request capacity"),
		});
	});

	it("estimates remaining wait from observed model wall time", () => {
		const snapshot = createSnapshot("gpu-0");
		const entry = snapshot.models["ollama:qwen:local"];
		if (!entry) {
			throw new Error("Expected registry entry.");
		}
		entry.speed.wallTimeMsEwma = 120_000;
		const decision = scheduleNKleinEndpointStart({
			taskId: "task-2",
			providerId: "ollama",
			modelId: "qwen",
			endpoint: "local",
			modelRegistry: snapshot,
			now: 220_000,
			runningSessions: [
				{
					taskId: "task-1",
					state: "running",
					startedAt: 160_000,
					providerId: "ollama",
					modelId: "qwen",
					endpoint: "local",
				},
			],
		});

		expect(decision).toMatchObject({
			ok: false,
			estimatedWaitMs: 60_000,
			reason: expect.stringContaining("about 60s"),
		});
	});

	it("allows cloud providers without an explicit shared endpoint", () => {
		const decision = scheduleNKleinEndpointStart({
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
		const modelRegistry: NKleinModelRegistrySnapshot = {
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
						maxConcurrentRequests: null,
					},
				},
			},
		};

		const decision = scheduleNKleinEndpointStart({
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
		const decision = scheduleNKleinEndpointStart({
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
					modelId: "qwen",
					endpoint: "http://127.0.0.1:11434",
				},
			],
		});

		expect(decision).toMatchObject({
			ok: false,
			blockedByTaskId: "task-1",
			// Loopback hosts canonicalize to `localhost` so the cold-start fallback id matches the
			// registry's stored shared-endpoint id (todo §5.Q — telemetry/registry/scheduler agree).
			sharedEndpointId: "http://localhost:11434#qwen",
		});
	});

	it("allows different local models on one endpoint when registry data is cold", () => {
		const decision = scheduleNKleinEndpointStart({
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

		expect(decision).toEqual({ ok: true });
	});

	it("serializes the same custom local provider model when registry data is cold", () => {
		const decision = scheduleNKleinEndpointStart({
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
					modelId: "qwen",
					endpoint: "http://127.0.0.1:1234/v1",
				},
			],
		});

		expect(decision).toMatchObject({
			ok: false,
			blockedByTaskId: "task-1",
			sharedEndpointId: "http://localhost:1234/v1#qwen",
		});
	});

	it("allows custom local providers on distinct endpoints to run in parallel", () => {
		const decision = scheduleNKleinEndpointStart({
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

	// §5.W per-provider concurrency gate.
	const coldRegistry: NKleinModelRegistrySnapshot = { schemaVersion: 1, updatedAt: 0, models: {} };
	const ollamaSession = (taskId: string, endpoint: string, modelId = "qwen") => ({
		taskId,
		state: "running" as const,
		providerId: "ollama",
		modelId,
		endpoint,
	});

	it("holds a start when the per-provider cap is reached across distinct endpoints/models", () => {
		// Two ollama sessions on different endpoints/models: each passes the per-endpoint gate, but the PROVIDER is at
		// its cap of 2, so a third ollama start (on yet another endpoint) is held by the provider gate.
		const decision = scheduleNKleinEndpointStart({
			taskId: "task-3",
			providerId: "ollama",
			modelId: "qwen",
			endpoint: "http://127.0.0.1:1236/v1",
			modelRegistry: coldRegistry,
			providerConcurrencyCap: 2,
			runningSessions: [
				ollamaSession("task-1", "http://127.0.0.1:1234/v1", "qwen"),
				ollamaSession("task-2", "http://127.0.0.1:1235/v1", "llama"),
			],
		});
		expect(decision).toMatchObject({
			ok: false,
			blockedByTaskId: "task-1",
			sharedEndpointId: "provider:ollama",
			reason: expect.stringContaining('Provider "ollama" is at its 2 concurrent-session cap'),
		});
	});

	it("allows a start while the provider is under its cap", () => {
		const decision = scheduleNKleinEndpointStart({
			taskId: "task-2",
			providerId: "ollama",
			modelId: "qwen",
			endpoint: "http://127.0.0.1:1236/v1",
			modelRegistry: coldRegistry,
			providerConcurrencyCap: 2,
			runningSessions: [ollamaSession("task-1", "http://127.0.0.1:1234/v1", "llama")], // 1 < 2, different endpoint
		});
		expect(decision).toEqual({ ok: true });
	});

	it("lets an effective per-model cap override the registry maxConcurrentRequests", () => {
		const runningOnGpu = (taskId: string) => ({
			taskId,
			state: "running" as const,
			providerId: "ollama",
			modelId: "qwen",
			endpoint: "local",
		});
		// Registry default is 1 (would block a 2nd), but the effective per-model cap of 3 allows up to 3 on the endpoint.
		expect(
			scheduleNKleinEndpointStart({
				taskId: "task-3",
				providerId: "ollama",
				modelId: "qwen",
				endpoint: "local",
				modelRegistry: createSnapshot("gpu-0"),
				modelConcurrencyCap: 3,
				runningSessions: [runningOnGpu("task-1"), runningOnGpu("task-2")],
			}),
		).toEqual({ ok: true });
		// At the override cap of 2, a 3rd is blocked by the per-endpoint gate.
		expect(
			scheduleNKleinEndpointStart({
				taskId: "task-3",
				providerId: "ollama",
				modelId: "qwen",
				endpoint: "local",
				modelRegistry: createSnapshot("gpu-0"),
				modelConcurrencyCap: 2,
				runningSessions: [runningOnGpu("task-1"), runningOnGpu("task-2")],
			}),
		).toMatchObject({ ok: false, sharedEndpointId: "gpu-0" });
	});

	// §5.AB per-MACHINE pool gate (concurrency per LM-Studio-linked machine).
	it("holds a start when the per-MACHINE pool cap is reached, independent of the per-model cap", () => {
		const onGpu = (taskId: string, modelId: string) => ({
			taskId,
			state: "running" as const,
			providerId: "ollama",
			modelId,
			endpoint: "local",
		});
		// modelCap is generous (5) so the per-model gate has room; but the MACHINE pool cap of 2 is reached across
		// DIFFERENT models on the same endpoint, so the 3rd start is held by the pool gate.
		const decision = scheduleNKleinEndpointStart({
			taskId: "task-3",
			providerId: "ollama",
			modelId: "qwen",
			endpoint: "local",
			modelRegistry: createSnapshot("gpu-0"),
			modelConcurrencyCap: 5,
			endpointConcurrencyCap: 2,
			// Different models on the SAME machine still count toward the one pool (keyed by endpoint, not model).
			runningSessions: [onGpu("task-1", "qwen"), onGpu("task-2", "llama")],
		});
		expect(decision).toMatchObject({
			ok: false,
			blockedByTaskId: "task-1",
			sharedEndpointId: "pool:local",
			reason: expect.stringContaining("Machine pool"),
		});
	});

	it("allows a start while the machine pool is under its cap", () => {
		const onGpu = (taskId: string, modelId: string) => ({
			taskId,
			state: "running" as const,
			providerId: "ollama",
			modelId,
			endpoint: "local",
		});
		expect(
			scheduleNKleinEndpointStart({
				taskId: "task-3",
				providerId: "ollama",
				modelId: "qwen",
				endpoint: "local",
				modelRegistry: createSnapshot("gpu-0"),
				modelConcurrencyCap: 5,
				endpointConcurrencyCap: 3, // 2 running < 3 → pool allows; modelCap 5 also has room
				runningSessions: [onGpu("task-1", "qwen"), onGpu("task-2", "qwen")],
			}),
		).toEqual({ ok: true });
	});
});
