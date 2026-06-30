/**
 * Shared output helpers for the task CLI (§5.U-extracted from task.ts): print a JSON payload to stdout. Kept in one place
 * so the per-concern command modules can reuse them without re-importing task.ts (which would create an import cycle).
 *
 * `toErrorMessage` is re-exported from the shared `src/core/error-message` (the one cross-codebase implementation) so the
 * task CLI's existing import path keeps working.
 */

export { toErrorMessage } from "../../core/error-message";

export function printJson(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
