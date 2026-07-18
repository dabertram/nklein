/**
 * Acceptance-evidence reuse across review cycles (live-found on the rig 2026-07-18): a verdict-less review retry
 * re-ran the FULL sandbox acceptance for byte-identical work — three no-submission cycles = three identical
 * docker runs before the no-verdict park. Acceptance is a function of the work tree, so the result is keyed by
 * the review's own work fingerprint and reused until the diff actually changes. In-process only (a runtime
 * restart re-verifies — the conservative direction), and an unavailable (null) run is never cached so a sandbox
 * outage retries next cycle.
 */

import type { RuntimeTaskAcceptanceResult } from "../core/task-lifecycle-api-contract";

const acceptanceEvidenceByTaskId = new Map<string, { fingerprint: string; acceptance: RuntimeTaskAcceptanceResult }>();

/** The cached run for this task, or null when none exists or the work fingerprint has changed. */
export function getReusableAcceptanceEvidence(taskId: string, fingerprint: string): RuntimeTaskAcceptanceResult | null {
	const entry = acceptanceEvidenceByTaskId.get(taskId);
	return entry && entry.fingerprint === fingerprint ? entry.acceptance : null;
}

export function storeAcceptanceEvidence(
	taskId: string,
	fingerprint: string,
	acceptance: RuntimeTaskAcceptanceResult,
): void {
	acceptanceEvidenceByTaskId.set(taskId, { fingerprint, acceptance });
}

/** Drop cached acceptance evidence for a task (call from session teardown beside the other per-task forgets). */
export function forgetAcceptanceEvidence(taskId: string): void {
	acceptanceEvidenceByTaskId.delete(taskId);
}
