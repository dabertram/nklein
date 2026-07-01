/**
 * Per-MACHINE concurrency admission (§5.AB per-machine pools). LM Studio's LM Link shares several machines behind ONE
 * endpoint, so the existing per-ENDPOINT gate ([nklein-endpoint-scheduler] `evaluateEndpointPoolConcurrencyGate`) counts
 * all three as one pool. This pure core keys on the MACHINE instead — using the model→machine map from `lms ps --json`
 * ({@link groupModelsByMachine} / {@link LmsPsModel.machineId}) — so each machine admits up to its own cap and the swarm
 * can load-balance across the boxes without overloading one. Pure + deterministic ⇒ unit-testable; the scheduler feeds it
 * the live machine map + the running-session model ids.
 */

import { LOCAL_MACHINE_ID } from "./lms-ps-json";

export interface MachineConcurrencyGateInput {
	/** The runtime model id (alias) the task wants to start on. */
	taskModelId: string;
	/** The model ids (aliases) of all CURRENTLY-running sessions (across all machines). */
	runningModelIds: readonly string[];
	/** Map of runtime model id → owning machine id (from `lms ps`; a model not in the map ⇒ the LOCAL host). */
	machineByModelId: ReadonlyMap<string, string>;
	/** Max concurrent sessions allowed PER machine (the uniform cap). ≤0 disables the gate (always allowed). */
	perMachineCap: number;
}

export interface MachineConcurrencyGateResult {
	/** True ⇒ the task may start; false ⇒ hold (the task's machine is at its cap). */
	allowed: boolean;
	/** The machine the task would run on. */
	machineId: string;
	/** How many sessions are already running on that machine. */
	running: number;
	/** The cap in force. */
	cap: number;
}

/** Resolve a model id to its owning machine (LOCAL when unmapped — a local instance has no `lms ps` deviceIdentifier). */
function machineOf(modelId: string, machineByModelId: ReadonlyMap<string, string>): string {
	return machineByModelId.get(modelId) ?? LOCAL_MACHINE_ID;
}

/**
 * Decide whether starting the task on its model would exceed that model's MACHINE cap. Counts the running sessions whose
 * model lives on the same machine as the task's model; allows when that count is below the cap. A cap ≤ 0 is treated as
 * "no per-machine limit" (always allowed) so the gate is inert unless an operator opts in.
 */
export function evaluateMachineConcurrencyGate(input: MachineConcurrencyGateInput): MachineConcurrencyGateResult {
	const machineId = machineOf(input.taskModelId, input.machineByModelId);
	if (input.perMachineCap <= 0) {
		return { allowed: true, machineId, running: 0, cap: input.perMachineCap };
	}
	let running = 0;
	for (const modelId of input.runningModelIds) {
		if (machineOf(modelId, input.machineByModelId) === machineId) {
			running += 1;
		}
	}
	return { allowed: running < input.perMachineCap, machineId, running, cap: input.perMachineCap };
}
