import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const observationMocks = vi.hoisted(() => ({ recordSelfObservation: vi.fn() }));

vi.mock("../../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: observationMocks.recordSelfObservation,
}));

import { MODEL_USAGE_CATEGORY } from "../../../src/core/card-tracking-coverage";
import { createKanbanContextFocusExtension } from "../../../src/nklein-agent/nklein-context-focus-extension";
import type { AgentAfterModelContext, AgentBeforeModelContext } from "../../../src/nklein-agent/sdk-agent-types";

const TEMP_PREFIX = "nklein-model-request-tracking-";

function snapshot(iteration: number): AgentBeforeModelContext["snapshot"] {
	return {
		agentId: "agent-1",
		status: "running",
		iteration,
		messages: [],
		pendingToolCalls: [],
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
	};
}

function beforeModelContext(iteration: number): AgentBeforeModelContext {
	return { snapshot: snapshot(iteration), request: { messages: [], tools: [] } };
}

function afterModelContext(iteration: number, withMetrics = true): AgentAfterModelContext {
	return {
		snapshot: snapshot(iteration),
		assistantMessage: {
			id: `assistant-${iteration}`,
			role: "assistant",
			content: [{ type: "text", text: "done" }],
			createdAt: Date.now(),
			modelInfo: { provider: "actual-provider", id: "actual-model" },
			...(withMetrics
				? {
						metrics: {
							inputTokens: 120,
							outputTokens: 30,
							cacheReadTokens: 80,
							cacheWriteTokens: 4,
							reasoningTokenCount: 7,
							cost: 0.02,
						},
					}
				: {}),
		},
		finishReason: "stop",
	};
}

describe("createKanbanContextFocusExtension per-request model tracking", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		observationMocks.recordSelfObservation.mockReset();
		await Promise.all(tempDirs.map((path) => rm(path, { recursive: true, force: true })));
		tempDirs.length = 0;
	});

	it("records request-local usage, cache, reasoning, identity, and provider wall time", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		let now = 1_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const extension = createKanbanContextFocusExtension(
			"task-1",
			"/workspaces/task-1",
			workspacePath,
			undefined,
			undefined,
			undefined,
			undefined,
			{ providerId: "fallback-provider", modelId: "fallback-model" },
		);

		await extension.hooks?.beforeModel?.(beforeModelContext(3));
		now = 1_275;
		await extension.hooks?.afterModel?.(afterModelContext(3));

		const requestCall = observationMocks.recordSelfObservation.mock.calls.find(
			([event]) =>
				(event as { metadata?: { category?: unknown; granularity?: unknown } }).metadata?.category ===
					MODEL_USAGE_CATEGORY &&
				(event as { metadata?: { granularity?: unknown } }).metadata?.granularity === "perRequest",
		);
		expect(requestCall?.[0]).toEqual(
			expect.objectContaining({
				taskId: "task-1",
				providerId: "actual-provider",
				modelId: "actual-model",
				metadata: expect.objectContaining({
					requestSequence: 1,
					iteration: 3,
					finishReason: "stop",
					durationMs: 275,
					usageAvailable: true,
					inputTokens: 120,
					outputTokens: 30,
					cacheReadTokens: 80,
					cacheWriteTokens: 4,
					reasoningTokens: 7,
					cost: 0.02,
				}),
			}),
		);
	});

	it("still records a completed request when the provider omits usage", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const extension = createKanbanContextFocusExtension(
			"task-2",
			"/workspaces/task-2",
			workspacePath,
			undefined,
			undefined,
			undefined,
			undefined,
			{ providerId: "fallback-provider", modelId: "fallback-model" },
		);

		await extension.hooks?.afterModel?.(afterModelContext(1, false));

		expect(observationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					category: MODEL_USAGE_CATEGORY,
					granularity: "perRequest",
					durationMs: null,
					usageAvailable: false,
					inputTokens: null,
					outputTokens: null,
					reasoningTokens: null,
				}),
			}),
		);
	});
});
