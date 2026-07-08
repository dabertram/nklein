import { describe, expect, it } from "vitest";
import {
	countConfiguredSwarmRoleModels,
	resolveRuntimeSwarmGuardrailsForModelRoles,
	shouldUseParallelSwarmGuardrails,
} from "../../../src/core/parallel-swarm-guardrails";
import {
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	normalizeRuntimeSwarmGuardrails,
	PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS,
	RUNTIME_SWARM_GUARDRAIL_BOUNDS,
} from "../../../src/core/runtime-config-api-contract";

describe("PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS (§5.AB swarm profile — long waits accepted)", () => {
	it("stays inside the guardrail bounds (normalizes UNCHANGED — a profile can't disable/clamp a guardrail)", () => {
		expect(normalizeRuntimeSwarmGuardrails(PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS)).toEqual(
			PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS,
		);
		for (const [key, bounds] of Object.entries(RUNTIME_SWARM_GUARDRAIL_BOUNDS)) {
			const value =
				PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS[key as keyof typeof PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS];
			expect(value).toBeGreaterThanOrEqual(bounds.min);
			expect(value).toBeLessThanOrEqual(bounds.max);
		}
	});

	it("is MORE lenient than the interactive default on the slow-progress guards (queueing, not looping, is the cost)", () => {
		expect(PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS.maxAutonomousTurnsPerTask).toBeGreaterThan(
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxAutonomousTurnsPerTask,
		);
		expect(PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS.maxAutonomousWallTimeMs).toBeGreaterThan(
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxAutonomousWallTimeMs,
		);
		expect(PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS.maxRepeatedNoDiffCheckpoints).toBeGreaterThan(
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxRepeatedNoDiffCheckpoints,
		);
	});

	it("keeps the LOOP guard protective — repeated-tool-calls not maxed out (a stuck/looping agent still parks)", () => {
		expect(PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS.maxRepeatedToolCallsPerTask).toBeGreaterThanOrEqual(
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxRepeatedToolCallsPerTask,
		);
		expect(PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS.maxRepeatedToolCallsPerTask).toBeLessThanOrEqual(
			RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedToolCallsPerTask.max / 2,
		);
	});

	it("counts distinct configured role models across primaries and role pools", () => {
		expect(countConfiguredSwarmRoleModels({})).toBe(0);
		expect(
			countConfiguredSwarmRoleModels({
				worker: {
					providerId: "lmstudio",
					modelId: "coder",
					additionalModels: [{ providerId: "lmstudio", modelId: "coder" }],
				},
				architect: { providerId: "lmstudio", modelId: "reasoner" },
			}),
		).toBe(2);
	});

	it("applies the parallel profile only for multi-model role configs that still use default guardrails", () => {
		const roles = {
			worker: { providerId: "lmstudio", modelId: "coder" },
			architect: { providerId: "lmstudio", modelId: "reasoner" },
		};

		expect(
			shouldUseParallelSwarmGuardrails({
				configuredGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
				effectiveModelRoles: roles,
			}),
		).toBe(true);
		expect(
			resolveRuntimeSwarmGuardrailsForModelRoles({
				configuredGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
				effectiveModelRoles: roles,
			}),
		).toEqual(PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS);
	});

	it("does not override single-model setups or explicit user guardrail edits", () => {
		const singleModelRoles = {
			worker: { providerId: "lmstudio", modelId: "coder" },
			architect: { providerId: "lmstudio", modelId: "coder" },
		};
		const customGuardrails = {
			...DEFAULT_RUNTIME_SWARM_GUARDRAILS,
			maxAutonomousWallTimeMs: DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxAutonomousWallTimeMs + 1_000,
		};
		const multiModelRoles = {
			worker: { providerId: "lmstudio", modelId: "coder" },
			architect: { providerId: "lmstudio", modelId: "reasoner" },
		};

		expect(
			resolveRuntimeSwarmGuardrailsForModelRoles({
				configuredGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
				effectiveModelRoles: singleModelRoles,
			}),
		).toEqual(DEFAULT_RUNTIME_SWARM_GUARDRAILS);
		expect(
			resolveRuntimeSwarmGuardrailsForModelRoles({
				configuredGuardrails: customGuardrails,
				effectiveModelRoles: multiModelRoles,
			}),
		).toEqual(customGuardrails);
	});
});
