/**
 * Synthetic task-id conventions (todo §5.U — consolidates a `::` magic-string check that had drifted across ~5 files).
 * A primary work card owns a plain task id; DERIVED sessions encode their kind after a `::` separator — today that is
 * the speculative mirror (`<primary>::spec`), with room for other sub-sessions. Operations that only make sense for a
 * real work card (fitness recording, chat feedback, retrieval gating, plan critique, worker-session counting) skip
 * derived ids; the speculative preemption path specifically targets `::spec`. Centralizing the convention keeps those
 * call sites from each re-encoding the raw `"::"` / `"::spec"` string.
 */

const SPECULATIVE_MIRROR_SUFFIX = "::spec";
const DERIVED_TASK_ID_SEPARATOR = "::";

/** True for a DERIVED session id (a speculative mirror or any other `::`-suffixed sub-session), not a primary work card. */
export function isDerivedTaskSessionId(taskId: string): boolean {
	return taskId.includes(DERIVED_TASK_ID_SEPARATOR);
}

/** True for a speculative-mirror session id (`<primary>::spec`). */
export function isSpeculativeMirrorTaskId(taskId: string): boolean {
	return taskId.endsWith(SPECULATIVE_MIRROR_SUFFIX);
}

/** The primary work-card id a speculative mirror shadows (strips the `::spec` suffix; a no-op for a non-mirror id). */
export function primaryTaskIdOfSpeculativeMirror(taskId: string): string {
	return isSpeculativeMirrorTaskId(taskId) ? taskId.slice(0, -SPECULATIVE_MIRROR_SUFFIX.length) : taskId;
}
