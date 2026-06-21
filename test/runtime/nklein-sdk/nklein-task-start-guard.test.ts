import { describe, expect, it } from "vitest";
import {
	buildNKleinSandboxStartBlock,
	buildNKleinStartGuardCandidate,
} from "../../../src/nklein-sdk/nklein-task-start-guard";

const EMPTY_REGISTRY = {
	schemaVersion: 1 as const,
	updatedAt: 0,
	models: {},
};

describe("buildNKleinStartGuardCandidate", () => {
	it("allows NKlein starts when the sandbox preflight is ready or unavailable to the caller", () => {
		expect(buildNKleinSandboxStartBlock(undefined)).toBeNull();
		expect(
			buildNKleinSandboxStartBlock({
				state: "ready",
				message: null,
			}),
		).toBeNull();
	});

	it("blocks NKlein starts while the sandbox preflight is unavailable", () => {
		expect(
			buildNKleinSandboxStartBlock({
				state: "blocked",
				message: "Docker daemon is unavailable.",
			}),
		).toEqual({
			error: "Docker daemon is unavailable.",
			errorCode: "agent_sandbox_unavailable",
		});
		expect(
			buildNKleinSandboxStartBlock({
				state: "checking",
				message: null,
			}),
		).toEqual({
			error: "Docker is required for !Klein agent isolation, but the sandbox is unavailable.",
			errorCode: "agent_sandbox_unavailable",
		});
	});

	it("rejects launch candidates below the !Klein minimum context window", () => {
		expect(() =>
			buildNKleinStartGuardCandidate({
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

	it("accepts launch candidates at the !Klein minimum context window", () => {
		const candidate = buildNKleinStartGuardCandidate({
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
