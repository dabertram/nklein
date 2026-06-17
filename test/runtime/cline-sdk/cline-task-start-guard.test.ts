import { describe, expect, it } from "vitest";
import { buildClineStartGuardCandidate } from "../../../src/cline-sdk/cline-task-start-guard";

const EMPTY_REGISTRY = {
	schemaVersion: 1 as const,
	updatedAt: 0,
	models: {},
};

describe("buildClineStartGuardCandidate", () => {
	it("rejects launch candidates below the Kanban minimum context window", () => {
		expect(() =>
			buildClineStartGuardCandidate({
				launchConfig: {
					providerId: "ollama",
					modelId: "qwen",
					contextWindow: 16_000,
				},
				role: null,
				modelRegistry: EMPTY_REGISTRY,
			}),
		).toThrow("requires at least 32,000");
	});

	it("accepts launch candidates at the Kanban minimum context window", () => {
		const candidate = buildClineStartGuardCandidate({
			launchConfig: {
				providerId: "ollama",
				modelId: "qwen",
				contextWindow: 32_000,
			},
			role: "worker",
			modelRegistry: EMPTY_REGISTRY,
		});

		expect(candidate.entry.contextWindow.effective).toBe(32_000);
	});
});
