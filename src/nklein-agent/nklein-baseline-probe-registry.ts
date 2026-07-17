/**
 * F12.60(a) clean-baseline probe registry.
 *
 * The attribution problem: when a card's acceptance check fails at review time, nobody knows whether the failure
 * is the WORKER's or was already red on the base tree before any work happened. The probe runs the card's
 * acceptance command against the BASE tree (`useBaseTree: true`) at card start (opt-in — it costs a full sandbox
 * acceptance run per start) and parks the verdict here; the review runner reads it to label a red acceptance as
 * pre-existing or newly-introduced. Module-level registry like predict-output/live-usage: keyed by task id,
 * forgotten on session teardown.
 */

export interface BaselineProbeResult {
	/** Whether the card even has an acceptance command (a probe of a command-less card proves nothing). */
	readonly present: boolean;
	/** The BASE tree's verdict; null when the command exists but could not produce one. */
	readonly passed: boolean | null;
}

const baselineByTaskId = new Map<string, BaselineProbeResult>();

export function recordBaselineProbe(taskId: string, result: BaselineProbeResult): void {
	baselineByTaskId.set(taskId, result);
}

export function getBaselineProbe(taskId: string): BaselineProbeResult | null {
	return baselineByTaskId.get(taskId) ?? null;
}

export function forgetBaselineProbe(taskId: string): void {
	baselineByTaskId.delete(taskId);
}
