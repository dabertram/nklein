/**
 * Shared output/error helpers for the task CLI (§5.U-extracted from task.ts): stringify an unknown thrown value to a
 * user-facing message, and print a JSON payload to stdout. Kept in one place so the per-concern command modules can
 * reuse them without re-importing task.ts (which would create an import cycle).
 */

export function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return String(error);
}

export function printJson(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
