import { describe, expect, it } from "vitest";
import type { RuntimeSwarmGuardrails } from "@/runtime/types";
import {
	inputsToSwarmGuardrails,
	isGuardrailInputOutOfRange,
	swarmGuardrailsToInputs,
	WALL_TIME_BOUNDS_HOURS,
} from "./runtime-settings-swarm-guardrails";

describe("WALL_TIME_BOUNDS_HOURS", () => {
	it("derives a positive min < max in hours", () => {
		expect(WALL_TIME_BOUNDS_HOURS.min).toBeGreaterThan(0);
		expect(WALL_TIME_BOUNDS_HOURS.max).toBeGreaterThan(WALL_TIME_BOUNDS_HOURS.min);
	});
});

describe("swarmGuardrailsToInputs", () => {
	it("stringifies counts and converts wall-time ms→hours (integer + fractional)", () => {
		const guardrails = {
			maxAutonomousTurnsPerTask: 50,
			maxAutonomousWallTimeMs: 2 * 60 * 60 * 1000,
			maxRepeatedNoDiffCheckpoints: 5,
			maxRepeatedToolCallsPerTask: 20,
		} as RuntimeSwarmGuardrails;
		expect(swarmGuardrailsToInputs(guardrails)).toEqual({
			maxAutonomousTurnsPerTask: "50",
			maxAutonomousWallTimeHours: "2",
			maxRepeatedNoDiffCheckpoints: "5",
			maxRepeatedToolCallsPerTask: "20",
		});
		expect(
			swarmGuardrailsToInputs({ ...guardrails, maxAutonomousWallTimeMs: 5_400_000 }).maxAutonomousWallTimeHours,
		).toBe("1.5");
	});
});

describe("inputsToSwarmGuardrails", () => {
	it("parses inputs into normalized numeric guardrails (round-trip is idempotent)", () => {
		const g1 = inputsToSwarmGuardrails({
			maxAutonomousTurnsPerTask: "50",
			maxAutonomousWallTimeHours: "2",
			maxRepeatedNoDiffCheckpoints: "5",
			maxRepeatedToolCallsPerTask: "20",
		});
		for (const value of Object.values(g1)) {
			expect(Number.isFinite(value)).toBe(true);
		}
		// Re-deriving the inputs and converting back yields the same normalized guardrails.
		expect(inputsToSwarmGuardrails(swarmGuardrailsToInputs(g1))).toEqual(g1);
	});
});

describe("isGuardrailInputOutOfRange", () => {
	it("flags empty / non-numeric / below-min / above-max values", () => {
		const bounds = { min: 1, max: 10 };
		expect(isGuardrailInputOutOfRange("5", bounds)).toBe(false);
		expect(isGuardrailInputOutOfRange("1", bounds)).toBe(false);
		expect(isGuardrailInputOutOfRange("", bounds)).toBe(true);
		expect(isGuardrailInputOutOfRange("abc", bounds)).toBe(true);
		expect(isGuardrailInputOutOfRange("0", bounds)).toBe(true);
		expect(isGuardrailInputOutOfRange("11", bounds)).toBe(true);
	});
});
