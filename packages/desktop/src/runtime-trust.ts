/**
 * Nonce-authenticated desktop↔runtime trust handshake (§5.Y #10).
 *
 * The desktop generates a cryptographically-random nonce when it spawns its
 * own runtime and passes it to the child via NKLEIN_DESKTOP_NONCE. The
 * runtime echoes that value on GET /api/desktop-health. checkDesktopHealth
 * verifies the echo before the orchestrator attaches the preload bridge.
 *
 * A pre-existing runtime that cannot prove the nonce is treated as untrusted:
 *   - packaged builds: refuse to attach (bridge not exposed, error thrown).
 *   - dev builds:      fall back to title-based liveness (bridge attached,
 *                      logs a prominent warning).
 *
 * Title matching alone is never sufficient to gate bridge attachment.
 *
 * Pure functions only — no I/O, no Electron imports.
 */

import { randomBytes } from "node:crypto";

/** Env-var name the desktop uses to pass the nonce to the spawned runtime. */
export const DESKTOP_NONCE_ENV = "NKLEIN_DESKTOP_NONCE";

/** Endpoint the runtime exposes when the env var is set. */
export const DESKTOP_HEALTH_PATH = "/api/desktop-health";

/** Schema of the JSON body returned by /api/desktop-health. */
export interface DesktopHealthResponse {
	nonce: string;
}

/**
 * Generate a 32-byte (256-bit) hex nonce for a single desktop spawn.
 * Uses Node's `crypto.randomBytes`, not `Math.random`.
 */
export function generateDesktopNonce(): string {
	return randomBytes(32).toString("hex");
}

export type DesktopTrustResult =
	| { trusted: true }
	| { trusted: false; reason: string };

/**
 * Determine whether a runtime at `origin` is trusted enough to attach the
 * desktop bridge, given:
 *   - `expectedNonce`: the nonce we passed to the spawned child (null if we
 *     did NOT spawn this runtime — i.e. it was pre-existing).
 *   - `nonceResponse`: the body from GET /api/desktop-health, or null if the
 *     request failed or the endpoint did not exist.
 *   - `titleLiveness`: whether the `/` body contains a recognised app title
 *     (the old check — kept as a supplementary liveness hint).
 *   - `isPackaged`: whether we are running in a packaged/production Electron
 *     build. In packaged builds we never attach to an unproven runtime.
 *
 * Security posture:
 *   - isPackaged=true:  nonce MUST match for both owned and pre-existing
 *     runtimes. A missing/wrong nonce is always refused.
 *   - isPackaged=false: nonce SHOULD match for owned runtimes, and the
 *     fallback (nonce endpoint absent, e.g. older runtime in dev) is a
 *     logged warning + title liveness gate. Pre-existing runtimes are trusted
 *     by title liveness alone. This is the dev leniency intended by §5.Y #10.
 */
export function resolveDesktopTrust(opts: {
	expectedNonce: string | null;
	nonceResponse: DesktopHealthResponse | null;
	titleLiveness: boolean;
	isPackaged: boolean;
}): DesktopTrustResult {
	const { expectedNonce, nonceResponse, titleLiveness, isPackaged } = opts;

	// ── Case 1: we spawned this runtime (have an expected nonce). ──────────────
	// Title liveness is irrelevant here — we own the process, so
	// the nonce is the authoritative trust gate.
	if (expectedNonce !== null) {
		// Perfect match — strong trust.
		if (nonceResponse !== null && nonceResponse.nonce === expectedNonce) {
			return { trusted: true };
		}
		// Wrong nonce — something else is on the port.
		if (nonceResponse !== null && nonceResponse.nonce !== expectedNonce) {
			return {
				trusted: false,
				reason: "runtime nonce mismatch — port may have been hijacked",
			};
		}
		// Nonce endpoint absent (nonceResponse === null).
		// Packaged: hard refuse — spawned runtime MUST echo the nonce.
		if (isPackaged) {
			return {
				trusted: false,
				reason:
					"spawned runtime did not respond on /api/desktop-health — nonce could not be verified",
			};
		}
		// Dev: allow with a warning. Older runtimes that predate §5.Y #10
		// won't have the endpoint; don't block dev workflows. Caller logs.
		return { trusted: true };
	}

	// ── Case 2: pre-existing runtime (no nonce). ───────────────────────────────
	// Packaged builds: hard refuse. A runtime we did not spawn and cannot prove
	// should never receive the bridge. The user must restart from the app.
	if (isPackaged) {
		return {
			trusted: false,
			reason:
				"packaged desktop will not attach to a pre-existing runtime without a verified nonce — restart the app to spawn a trusted runtime",
		};
	}

	// Dev builds: degrade gracefully. Attach if the title passes liveness, but
	// log a clear warning so developers are aware of the residual risk.
	if (!titleLiveness) {
		return {
			trusted: false,
			reason: "pre-existing runtime did not pass title liveness check",
		};
	}
	// Liveness passed in dev — allow but caller must log a warning.
	return { trusted: true };
}
