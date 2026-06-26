import { normalizeRuntimeSwarmGuardrails, RUNTIME_SWARM_GUARDRAIL_BOUNDS } from "@runtime-contract";
import type { RuntimeSwarmGuardrails } from "@/runtime/types";

/**
 * Swarm-guardrail form conversion for the Settings dialog, extracted from the oversized
 * `runtime-settings-dialog.tsx` (§5.X #2 / anti-patterns #2). Pure, self-contained: converts the guardrails wire
 * shape to/from the editable string inputs (wall-time in hours), with per-field out-of-range detection so a row can
 * flag that it will be clamped on save. No React/state.
 */

export const WALL_TIME_BOUNDS_HOURS = {
	min: RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxAutonomousWallTimeMs.min / (60 * 60 * 1000),
	max: RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxAutonomousWallTimeMs.max / (60 * 60 * 1000),
} as const;

export interface SwarmGuardrailInputs {
	maxAutonomousTurnsPerTask: string;
	maxAutonomousWallTimeHours: string;
	maxRepeatedNoDiffCheckpoints: string;
	maxRepeatedToolCallsPerTask: string;
}

function formatHoursInput(ms: number): string {
	const hours = ms / (60 * 60 * 1000);
	return Number.isInteger(hours) ? `${hours}` : `${Number(hours.toFixed(3))}`;
}

export function swarmGuardrailsToInputs(guardrails: RuntimeSwarmGuardrails): SwarmGuardrailInputs {
	return {
		maxAutonomousTurnsPerTask: String(guardrails.maxAutonomousTurnsPerTask),
		maxAutonomousWallTimeHours: formatHoursInput(guardrails.maxAutonomousWallTimeMs),
		maxRepeatedNoDiffCheckpoints: String(guardrails.maxRepeatedNoDiffCheckpoints),
		maxRepeatedToolCallsPerTask: String(guardrails.maxRepeatedToolCallsPerTask),
	};
}

export function inputsToSwarmGuardrails(inputs: SwarmGuardrailInputs): RuntimeSwarmGuardrails {
	const wallTimeHours = Number.parseFloat(inputs.maxAutonomousWallTimeHours);
	return normalizeRuntimeSwarmGuardrails({
		maxAutonomousTurnsPerTask: Number.parseInt(inputs.maxAutonomousTurnsPerTask, 10),
		maxAutonomousWallTimeMs: Number.isFinite(wallTimeHours) ? Math.round(wallTimeHours * 60 * 60 * 1000) : Number.NaN,
		maxRepeatedNoDiffCheckpoints: Number.parseInt(inputs.maxRepeatedNoDiffCheckpoints, 10),
		maxRepeatedToolCallsPerTask: Number.parseInt(inputs.maxRepeatedToolCallsPerTask, 10),
	});
}

// True when the typed value is empty / not a number / outside its bound, so the row can flag that it will be
// clamped (or filled with the default) on save.
export function isGuardrailInputOutOfRange(value: string, bounds: { min: number; max: number }): boolean {
	const parsed = Number.parseFloat(value);
	return !Number.isFinite(parsed) || parsed < bounds.min || parsed > bounds.max;
}
