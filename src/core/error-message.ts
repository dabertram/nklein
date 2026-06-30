/**
 * Stringify an unknown thrown value to a human-readable message — the ONE shared implementation (previously copy-pasted
 * across `nklein-provider-service` / `nklein-task-session-service` / `nklein-mcp-runtime-service` / the task CLI). Pure.
 *
 * Order of preference: a real `Error`'s trimmed message (when non-empty) → a duck-typed `{ message: string }`'s trimmed
 * message (when non-empty) → the caller's `fallback`. `fallback` defaults to `String(error)` (the raw stringification);
 * callers that want a friendly catch-all (e.g. "An unexpected error occurred.") pass it explicitly.
 */
export function toErrorMessage(error: unknown, fallback?: string): string {
	if (error instanceof Error) {
		const message = error.message.trim();
		if (message.length > 0) {
			return message;
		}
	}
	if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
		const message = error.message.trim();
		if (message.length > 0) {
			return message;
		}
	}
	return fallback ?? String(error);
}
