/**
 * Transient (retryable) network/inference error classification (todo §5.AF scout signal 3 — transient survivability).
 *
 * A live decompose scout died on an undici `Body Timeout Error` (a slow generation under Low Power), and the §5.AF
 * durable-scheduler note records a `fetch failed (HeadersTimeoutError)` killing a 30-min run. These are TRANSIENT —
 * the model/server is reachable but slow or briefly hiccuped — so the right response is a bounded RETRY, NOT to treat
 * the model as gone. This complements (does not duplicate) `isLocalModelRuntimeUnavailableError`
 * ([nklein-session-state.ts](../nklein-agent/nklein-session-state.ts)), which answers the different question "should we
 * treat the model as UNLOADED?". A connection-drop matches both; a body/headers TIMEOUT is transient-only.
 *
 * Pure (message-based), so the durable scheduler + the `verify-*.mts` harnesses can wrap a model call in a
 * retry-on-transient without importing live machinery.
 */

/** Substrings (lowercased match) that mark a transient, retryable network/inference error. */
const TRANSIENT_ERROR_PATTERNS = [
	// undici timeouts — the model/server is slow, not gone (the scout's "Body Timeout Error").
	"body timeout",
	"headers timeout",
	"headerstimeouterror",
	"bodytimeouterror",
	"und_err_body_timeout",
	"und_err_headers_timeout",
	"und_err_connect_timeout",
	"etimedout",
	"request timed out",
	"timeout error",
	// connection blips — briefly dropped, retry usually succeeds.
	"econnreset",
	"econnrefused",
	"socket hang up",
	"fetch failed",
	"premature close",
	"connection reset",
	"connection refused",
	"network error",
	"und_err_socket",
	// transient server-side states.
	"502",
	"503",
	"bad gateway",
	"service unavailable",
	"temporarily unavailable",
	"overloaded",
] as const;

/** Extract a lowercased message from an unknown error value (Error · string · object with `message`). */
function errorMessage(error: unknown): string {
	if (typeof error === "string") {
		return error.toLowerCase();
	}
	if (error instanceof Error) {
		// `error.cause` often carries the real undici code (e.g. UND_ERR_BODY_TIMEOUT) — include it.
		const cause = (error as { cause?: unknown }).cause;
		const causeText = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
		return `${error.message} ${causeText}`.toLowerCase();
	}
	if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
		return error.message.toLowerCase();
	}
	return "";
}

/** True for a transient, RETRYABLE network/inference error (timeout / connection blip / transient server state). */
export function isTransientNetworkError(error: unknown): boolean {
	const message = errorMessage(error);
	if (message.length === 0) {
		return false;
	}
	return TRANSIENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}
