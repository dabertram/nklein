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

export interface RetryableModelCallErrorOptions {
	/** The caller-owned cancellation signal. Once aborted, cancellation is terminal and must never be retried. */
	callerSignal?: AbortSignal;
	/** Whether this attempt already exposed output to the caller. Replaying it would duplicate visible stream content. */
	visibleOutput?: boolean;
}

/** Typed provenance for an abort owned by the model/runtime rather than by the outer caller. */
export class RetryableModelCallAbortError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "RetryableModelCallAbortError";
	}
}

/** True when an unknown error is an abort-shaped model/runtime failure rather than a regular network error. */
function isAbortLikeError(error: unknown): boolean {
	const name = error instanceof Error ? error.name.toLowerCase() : "";
	if (name === "aborterror" || name === "agentruntimeaborterror") {
		return true;
	}
	const message = errorMessage(error);
	return [
		"aborterror",
		"the operation was aborted",
		"request aborted",
		"runtime aborted",
		"agent runtime aborted",
	].some((pattern) => message.includes(pattern));
}

/**
 * Shared retry classifier for model-call seams. Provider/runtime aborts are transient when the caller did not request
 * cancellation and the attempt has not exposed output. The two terminal guards are intentionally checked first:
 * abort-shaped errors are also how fetch/provider adapters report an explicit user stop, and replaying an immediate
 * stream after its first visible delta would duplicate output. Otherwise the existing network classifier remains the
 * source of truth for timeout/connection/5xx retryability.
 */
export function isRetryableModelCallError(error: unknown, options: RetryableModelCallErrorOptions = {}): boolean {
	if (options.callerSignal?.aborted || options.visibleOutput) {
		return false;
	}
	if (error instanceof RetryableModelCallAbortError || isTransientNetworkError(error)) {
		return true;
	}
	// A plain AbortError is ambiguous when no caller signal exists: it may be an explicit endpoint/user cancellation.
	// Only a supplied, still-live caller signal proves that this abort came from below the caller boundary.
	return options.callerSignal !== undefined && isAbortLikeError(error);
}

export interface TransientRetryOptions {
	/** Max RETRIES after the first attempt (so total attempts ≤ maxRetries + 1). Default 3. */
	maxRetries?: number;
	/** Predicate for "is this worth retrying?". Default {@link isTransientNetworkError}. */
	isTransient?: (error: unknown) => boolean;
	/** Backoff before retry N (1-based). Default 0 (no wait). */
	delayMs?: (attempt: number) => number;
	/** Injectable sleep (for tests / custom timers). Default a real `setTimeout` promise. */
	sleep?: (ms: number) => Promise<void>;
	/** Observe each retry (attempt is 1-based) — e.g. log "retrying after transient". */
	onRetry?: (attempt: number, error: unknown) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, RETRYING it (bounded) when it throws a TRANSIENT error — the §5.AF transient-survivability wrapper so a
 * body/headers timeout or connection blip no longer kills a long run. A non-transient error rethrows immediately; a
 * transient error rethrows only after the retry budget is spent. Pure over the injected `fn`/`sleep`, so it's
 * unit-testable without real timers or network.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, options: TransientRetryOptions = {}): Promise<T> {
	const maxRetries = Math.max(0, options.maxRetries ?? 3);
	const isTransient = options.isTransient ?? isTransientNetworkError;
	const sleep = options.sleep ?? defaultSleep;
	let lastError: unknown;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			if (attempt >= maxRetries || !isTransient(error)) {
				throw error;
			}
			options.onRetry?.(attempt + 1, error);
			const waitMs = options.delayMs?.(attempt + 1) ?? 0;
			if (waitMs > 0) {
				await sleep(waitMs);
			}
		}
	}
	// Unreachable (the loop either returns or throws), but satisfies the type checker.
	throw lastError;
}
