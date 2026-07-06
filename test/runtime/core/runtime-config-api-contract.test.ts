import { describe, expect, it } from "vitest";
import {
	areRuntimeSwarmGuardrailsEqual,
	BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS,
	clampRuntimeSwarmCardStartBatchSize,
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	normalizeRuntimeSwarmGuardrails,
	PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS,
	RUNTIME_SWARM_GUARDRAIL_BOUNDS,
	RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH,
	type RuntimeSwarmGuardrails,
} from "../../../src/core/runtime-config-api-contract";

describe("clampRuntimeSwarmCardStartBatchSize", () => {
	it("returns 0 for non-positive or non-finite input (never starts a negative/NaN batch)", () => {
		expect(clampRuntimeSwarmCardStartBatchSize(0)).toBe(0);
		expect(clampRuntimeSwarmCardStartBatchSize(-5)).toBe(0);
		expect(clampRuntimeSwarmCardStartBatchSize(Number.NaN)).toBe(0);
		expect(clampRuntimeSwarmCardStartBatchSize(Number.POSITIVE_INFINITY)).toBe(0);
	});

	it("truncates fractional values toward zero", () => {
		expect(clampRuntimeSwarmCardStartBatchSize(3.9)).toBe(3);
	});

	it("caps at RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH", () => {
		expect(clampRuntimeSwarmCardStartBatchSize(100)).toBe(RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH);
		expect(clampRuntimeSwarmCardStartBatchSize(RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH)).toBe(
			RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH,
		);
	});

	it("passes a normal in-range value through", () => {
		expect(clampRuntimeSwarmCardStartBatchSize(5)).toBe(5);
	});
});

describe("normalizeRuntimeSwarmGuardrails", () => {
	it("null / undefined input ⇒ the full defaults", () => {
		expect(normalizeRuntimeSwarmGuardrails(null)).toEqual(DEFAULT_RUNTIME_SWARM_GUARDRAILS);
		expect(normalizeRuntimeSwarmGuardrails(undefined)).toEqual(DEFAULT_RUNTIME_SWARM_GUARDRAILS);
		expect(normalizeRuntimeSwarmGuardrails({})).toEqual(DEFAULT_RUNTIME_SWARM_GUARDRAILS);
	});

	it("a missing or non-numeric field falls back to that field's default (a typo can't disable a guardrail)", () => {
		expect(normalizeRuntimeSwarmGuardrails({ maxAutonomousTurnsPerTask: Number.NaN }).maxAutonomousTurnsPerTask).toBe(
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxAutonomousTurnsPerTask,
		);
		// biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard against a non-number leaking in.
		expect(normalizeRuntimeSwarmGuardrails({ maxAutonomousWallTimeMs: "nope" as any }).maxAutonomousWallTimeMs).toBe(
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxAutonomousWallTimeMs,
		);
	});

	it("clamps below-min and above-max to the bounds", () => {
		expect(normalizeRuntimeSwarmGuardrails({ maxAutonomousTurnsPerTask: 0 }).maxAutonomousTurnsPerTask).toBe(
			RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxAutonomousTurnsPerTask.min,
		);
		expect(normalizeRuntimeSwarmGuardrails({ maxAutonomousTurnsPerTask: 99_999 }).maxAutonomousTurnsPerTask).toBe(
			RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxAutonomousTurnsPerTask.max,
		);
	});

	it("enforces the maxRepeatedToolCallsPerTask hard floor of 2 (a limit of 1 would park every task on its first tool use)", () => {
		expect(normalizeRuntimeSwarmGuardrails({ maxRepeatedToolCallsPerTask: 1 }).maxRepeatedToolCallsPerTask).toBe(2);
		expect(RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedToolCallsPerTask.min).toBe(2);
	});

	it("truncates a fractional in-range value", () => {
		expect(normalizeRuntimeSwarmGuardrails({ maxRepeatedNoDiffCheckpoints: 10.9 }).maxRepeatedNoDiffCheckpoints).toBe(
			10,
		);
	});

	it("passes a fully-valid, in-range config through unchanged and is idempotent", () => {
		const valid: RuntimeSwarmGuardrails = {
			maxAutonomousTurnsPerTask: 20,
			maxAutonomousWallTimeMs: 3_600_000,
			maxRepeatedNoDiffCheckpoints: 5,
			maxRepeatedToolCallsPerTask: 4,
		};
		expect(normalizeRuntimeSwarmGuardrails(valid)).toEqual(valid);
		expect(normalizeRuntimeSwarmGuardrails(normalizeRuntimeSwarmGuardrails(valid))).toEqual(valid);
	});
});

describe("shipped guardrail profiles stay within bounds (a profile must never disable a guardrail)", () => {
	const profiles: Array<[string, RuntimeSwarmGuardrails]> = [
		["default", DEFAULT_RUNTIME_SWARM_GUARDRAILS],
		["background-eval", BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS],
		["parallel-swarm", PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS],
	];
	for (const [name, profile] of profiles) {
		it(`${name} survives normalization unchanged (already in-bounds)`, () => {
			// If a future edit pushes any field out of RUNTIME_SWARM_GUARDRAIL_BOUNDS, normalize would clamp it and this
			// equality breaks — catching a profile that would silently weaken/disable a guardrail.
			expect(normalizeRuntimeSwarmGuardrails(profile)).toEqual(profile);
		});
	}
});

describe("areRuntimeSwarmGuardrailsEqual", () => {
	it("true for identical guardrails, false when any field differs", () => {
		expect(
			areRuntimeSwarmGuardrailsEqual(DEFAULT_RUNTIME_SWARM_GUARDRAILS, { ...DEFAULT_RUNTIME_SWARM_GUARDRAILS }),
		).toBe(true);
		expect(
			areRuntimeSwarmGuardrailsEqual(DEFAULT_RUNTIME_SWARM_GUARDRAILS, {
				...DEFAULT_RUNTIME_SWARM_GUARDRAILS,
				maxAutonomousTurnsPerTask: DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxAutonomousTurnsPerTask + 1,
			}),
		).toBe(false);
	});
});
