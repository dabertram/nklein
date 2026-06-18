import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildClineModelRegistryKey,
	ClineModelRegistry,
	extractClineModelRegistryObservationFromEvent,
} from "../../../src/cline-sdk/cline-model-registry";

async function createRegistryPath(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "kanban-model-registry-"));
	return join(dir, "model-registry.json");
}

describe("cline model registry", () => {
	it("normalizes model keys with provider, model, and endpoint", () => {
		expect(
			buildClineModelRegistryKey({
				providerId: " Ollama ",
				modelId: " qwen3.5-9b ",
				endpoint: " http://localhost:11434 ",
			}),
		).toBe("ollama:qwen3.5-9b:http://localhost:11434");
	});

	it("records request speed using EWMA and persists the registry", async () => {
		let now = 1_000;
		const registryPath = await createRegistryPath();
		const registry = new ClineModelRegistry({
			registryPath,
			ewmaAlpha: 0.5,
			now: () => now,
		});

		await registry.recordRequest({
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			endpoint: "http://localhost:11434",
			contextWindow: 16_000,
			promptTokens: 2_000,
			outputTokens: 100,
			wallTimeMs: 5_000,
			ttftMs: 1_000,
			promptEvalMs: 2_000,
			decodeMs: 2_000,
		});
		now = 2_000;
		const entry = await registry.recordRequest({
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			endpoint: "http://localhost:11434",
			contextWindow: 8_000,
			promptTokens: 1_000,
			outputTokens: 50,
			wallTimeMs: 2_000,
			ttftMs: 500,
			promptEvalMs: 1_000,
			decodeMs: 1_000,
		});

		expect(entry.contextWindow.effective).toBe(8_000);
		expect(entry.speed.samples).toBe(2);
		expect(entry.speed.promptTokensEwma).toBe(1_500);
		expect(entry.speed.outputTokensEwma).toBe(75);
		expect(entry.speed.prefillTokensPerSecondEwma).toBe(1_000);
		expect(entry.speed.decodeTokensPerSecondEwma).toBe(50);
		expect(entry.speed.wallTimeMsPer1kPromptTokensEwma).toBe(2_250);

		await registry.flush();
		const persisted = JSON.parse(await readFile(registryPath, "utf8")) as {
			models: Record<string, { speed: { samples: number } }>;
		};
		expect(persisted.models["ollama:qwen3.5-9b:http://localhost:11434"]?.speed.samples).toBe(2);
	});

	it("defers registry persistence until flush while keeping the in-memory snapshot current", async () => {
		const registryPath = await createRegistryPath();
		const registry = new ClineModelRegistry({
			registryPath,
			persistDebounceMs: 60_000,
		});

		await registry.recordRequest({
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			endpoint: "http://localhost:11434",
			contextWindow: 16_000,
			promptTokens: 1_000,
			outputTokens: 50,
			wallTimeMs: 2_000,
		});
		await registry.recordCapability({
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			endpoint: "http://localhost:11434",
			passed: true,
			score: 90,
		});

		const snapshot = await registry.getSnapshot();
		const entry = snapshot.models["ollama:qwen3.5-9b:http://localhost:11434"];
		expect(entry?.speed.samples).toBe(1);
		expect(entry?.capability.samples).toBe(1);
		await expect(readFile(registryPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

		await registry.flush();
		const persisted = JSON.parse(await readFile(registryPath, "utf8")) as {
			models: Record<string, { speed: { samples: number }; capability: { samples: number } }>;
		};
		expect(persisted.models["ollama:qwen3.5-9b:http://localhost:11434"]?.speed.samples).toBe(1);
		expect(persisted.models["ollama:qwen3.5-9b:http://localhost:11434"]?.capability.samples).toBe(1);
	});

	it("preserves fractional EWMA speed fields when loading persisted registries", async () => {
		const registryPath = await createRegistryPath();
		await writeFile(
			registryPath,
			JSON.stringify({
				schemaVersion: 1,
				updatedAt: 2_000,
				models: {
					"ollama:qwen:http://localhost:11434": {
						key: "ollama:qwen:http://localhost:11434",
						providerId: "ollama",
						modelId: "qwen",
						endpoint: "http://localhost:11434",
						contextWindow: {
							advertised: null,
							observed: 80_000,
							userOverride: null,
							effective: 80_000,
						},
						speed: {
							samples: 2,
							promptTokensEwma: 1234.5,
							outputTokensEwma: 67.25,
							totalTokensEwma: 1301.75,
							prefillTokensPerSecondEwma: 987.65,
							decodeTokensPerSecondEwma: 43.21,
							ttftMsEwma: 456.78,
							wallTimeMsEwma: 3456.7,
							wallTimeMsPer1kPromptTokensEwma: 2222.22,
							lastPromptTokens: 1_200,
							lastOutputTokens: 80,
							lastWallTimeMs: 3_000,
							lastObservedAt: 2_000,
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
							sharedEndpointId: "http://localhost:11434",
							inputCostPerMillionTokens: null,
							outputCostPerMillionTokens: null,
						},
						createdAt: 1_000,
						updatedAt: 2_000,
					},
				},
			}),
			"utf8",
		);

		const snapshot = await new ClineModelRegistry({ registryPath }).load();
		const speed = snapshot.models["ollama:qwen:http://localhost:11434"]?.speed;

		expect(speed?.promptTokensEwma).toBe(1234.5);
		expect(speed?.outputTokensEwma).toBe(67.25);
		expect(speed?.prefillTokensPerSecondEwma).toBe(987.65);
		expect(speed?.wallTimeMsPer1kPromptTokensEwma).toBe(2222.22);
	});

	it("blends capability observations conservatively", async () => {
		const registry = new ClineModelRegistry({
			registryPath: await createRegistryPath(),
			ewmaAlpha: 0.5,
			now: () => 5_000,
		});

		await registry.recordCapability({
			providerId: "openrouter",
			modelId: "mid-coder",
			passed: true,
			score: 80,
		});
		const entry = await registry.recordCapability({
			providerId: "openrouter",
			modelId: "mid-coder",
			passed: false,
			score: 40,
		});

		expect(entry.capability.samples).toBe(2);
		expect(entry.capability.observedPassRate).toBe(0.5);
		expect(entry.capability.evalScore).toBe(60);
		expect(entry.capability.effectiveScore).toBe(52);
	});

	it("does not default cloud models into a serialized shared endpoint", async () => {
		const registry = new ClineModelRegistry({
			registryPath: await createRegistryPath(),
		});

		const cloudEntry = await registry.recordRequest({
			providerId: "anthropic",
			modelId: "claude-sonnet",
			contextWindow: 200_000,
			promptTokens: 1_000,
			outputTokens: 100,
			wallTimeMs: 1_000,
		});
		const localEntry = await registry.recordRequest({
			providerId: "ollama",
			modelId: "qwen",
			endpoint: "http://127.0.0.1:11434",
			contextWindow: 16_000,
			promptTokens: 1_000,
			outputTokens: 100,
			wallTimeMs: 1_000,
		});
		const customLocalEntry = await registry.recordRequest({
			providerId: "openai-compatible",
			modelId: "local-qwen",
			endpoint: "http://127.0.0.1:1234/v1",
			contextWindow: 16_000,
			promptTokens: 1_000,
			outputTokens: 100,
			wallTimeMs: 1_000,
		});

		expect(cloudEntry.constraints.sharedEndpointId).toBeNull();
		expect(localEntry.constraints.sharedEndpointId).toBe("http://127.0.0.1:11434");
		expect(customLocalEntry.constraints.sharedEndpointId).toBe("http://127.0.0.1:1234/v1");
	});
});

describe("extractClineModelRegistryObservationFromEvent", () => {
	it("extracts run-finished usage and timing from SDK events", () => {
		const observation = extractClineModelRegistryObservationFromEvent(
			{
				type: "agent_event",
				payload: {
					event: {
						type: "run-finished",
						wallTimeMs: 6_000,
						result: {
							usage: {
								inputTokens: 3_000,
								outputTokens: 150,
								cacheReadTokens: 20,
								cacheWriteTokens: 10,
							},
							ttftMs: 1_000,
						},
					},
				},
			},
			{
				providerId: "cline",
				modelId: "default",
				contextWindow: 80_000,
			},
			10_000,
		);

		expect(observation).toMatchObject({
			providerId: "cline",
			modelId: "default",
			contextWindow: 80_000,
			promptTokens: 3_000,
			outputTokens: 150,
			cacheReadTokens: 20,
			cacheWriteTokens: 10,
			wallTimeMs: 6_000,
			ttftMs: 1_000,
			createdAt: 10_000,
		});
	});

	it("ignores events without complete usage and duration", () => {
		expect(
			extractClineModelRegistryObservationFromEvent(
				{
					type: "agent_event",
					payload: {
						event: {
							type: "run-finished",
							result: {
								usage: {
									inputTokens: 3_000,
								},
							},
						},
					},
				},
				{ providerId: "cline", modelId: "default" },
				10_000,
			),
		).toBeNull();
	});

	it("uses a Kanban-measured wall-time fallback when the SDK event omits duration", () => {
		const observation = extractClineModelRegistryObservationFromEvent(
			{
				type: "agent_event",
				payload: {
					event: {
						type: "run-finished",
						result: {
							usage: {
								inputTokens: 3_000,
								outputTokens: 150,
							},
						},
					},
				},
			},
			{ providerId: "cline", modelId: "default" },
			10_000,
			4_500,
		);

		expect(observation?.wallTimeMs).toBe(4_500);
	});
});
