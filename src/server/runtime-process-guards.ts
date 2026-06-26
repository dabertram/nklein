export interface RuntimeUnhandledRejectionDeps {
	/** Route the rejection to telemetry (defaults to the Node Sentry capture). */
	capture: (error: Error, options: { area: string }) => void;
	/** Emit a visible log line (defaults to console.error). */
	logError: (message: string) => void;
}

/**
 * Handle an unhandled promise rejection in the long-lived runtime: normalise it to an Error, capture
 * it to telemetry, and log it LOUDLY — but never re-throw. A long-lived server hosts many agent
 * sessions; a stray rejection (e.g. a vendored-SDK `session_stop` surfacing from a stopped/long
 * session — observed crashing the verify-decompose harness at a 6-minute budget) must not take the
 * whole process — and every other session — down with it. Logging + telemetry keep it VISIBLE, so
 * this is resilience, not silent swallowing. (§5.V robustness finding #3.)
 *
 * Pure + dependency-injected so it is unit-testable without touching the real process or telemetry.
 */
export function handleRuntimeUnhandledRejection(reason: unknown, deps: RuntimeUnhandledRejectionDeps): void {
	// A resilience guard must never itself throw (it runs from process.on("unhandledRejection")). Log
	// first (visibility is the priority), then capture; a logging/telemetry failure must not escalate.
	try {
		const error = reason instanceof Error ? reason : new Error(String(reason));
		deps.logError(`[!Klein] unhandled promise rejection — runtime continues: ${error.stack ?? error.message}`);
		deps.capture(error, { area: "unhandledRejection" });
	} catch {
		// Intentionally swallowed.
	}
}

/**
 * Install the unhandled-rejection resilience guard on the current process. Call this ONLY from the
 * long-lived server path (cli.ts serve branch) — short-lived CLI commands intentionally keep Node's
 * fail-fast default, and tests must not accumulate a process-level listener.
 */
export function installRuntimeUnhandledRejectionGuard(deps: RuntimeUnhandledRejectionDeps): void {
	process.on("unhandledRejection", (reason) => {
		handleRuntimeUnhandledRejection(reason, deps);
	});
}
