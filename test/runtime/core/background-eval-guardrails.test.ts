import { describe, expect, it } from "vitest";
import {
	BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS,
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	normalizeRuntimeSwarmGuardrails,
	RUNTIME_SWARM_GUARDRAIL_BOUNDS,
} from "../../../src/core/runtime-config-api-contract";

describe("BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS (§5.AI generous rail profile)", () => {
	it("stays inside the guardrail bounds (normalizes UNCHANGED — a profile can't disable/clamp a guardrail)", () => {
		expect(normalizeRuntimeSwarmGuardrails(BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS)).toEqual(
			BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS,
		);
		for (const [key, bounds] of Object.entries(RUNTIME_SWARM_GUARDRAIL_BOUNDS)) {
			const value =
				BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS[key as keyof typeof BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS];
			expect(value).toBeGreaterThanOrEqual(bounds.min);
			expect(value).toBeLessThanOrEqual(bounds.max);
		}
	});

	it("is MORE lenient than the interactive default on the slow-progress guards (turns / wall-time / no-diff)", () => {
		expect(BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS.maxAutonomousTurnsPerTask).toBeGreaterThan(
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxAutonomousTurnsPerTask,
		);
		expect(BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS.maxAutonomousWallTimeMs).toBeGreaterThan(
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxAutonomousWallTimeMs,
		);
		expect(BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS.maxRepeatedNoDiffCheckpoints).toBeGreaterThan(
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxRepeatedNoDiffCheckpoints,
		);
	});

	it("keeps the LOOP guard protective — repeated-tool-calls not maxed out (a stuck/looping agent still parks)", () => {
		// More room than default (slow models legitimately retry) but nowhere near the max (loops must still park).
		expect(BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS.maxRepeatedToolCallsPerTask).toBeGreaterThanOrEqual(
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxRepeatedToolCallsPerTask,
		);
		expect(BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS.maxRepeatedToolCallsPerTask).toBeLessThanOrEqual(
			RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedToolCallsPerTask.max / 2,
		);
	});
});
