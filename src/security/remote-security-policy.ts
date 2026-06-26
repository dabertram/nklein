/**
 * Remote-mode transport & auth security policy (§5.Y security finding #7).
 *
 * Local loopback binds (the default `nklein` run) are intentionally
 * unauthenticated and plaintext — they are reachable only from the same
 * machine. A *non-loopback* (`--host`) bind, however, is reachable across the
 * network, so plaintext HTTP would put the access passcode, session cookie, and
 * all traffic on the wire in the clear, and `--no-passcode` would expose the
 * entire runtime API (including host actions) unauthenticated.
 *
 * This module is the single, pure decision point for that policy so the CLI
 * stays a thin wiring layer and the rules are exhaustively unit-testable
 * without booting a server. It does NOT read globals or the filesystem — the
 * caller passes the already-resolved facts in, and acts on the returned outcome.
 */

/** The facts the policy decides from. */
export interface RemoteSecurityPolicyInput {
	/** True when bound to a non-loopback host (`isKanbanRemoteHost()`). */
	isRemote: boolean;
	/** True when TLS/HTTPS is configured (valid `--cert` + `--key` / `--https`). */
	hasTls: boolean;
	/** True when the user passed `--insecure-remote-http` to opt out of the HTTPS requirement. */
	insecureRemoteHttp: boolean;
	/** True when the user passed `--no-passcode`. */
	noPasscode: boolean;
	/** True when the user passed `--dangerously-disable-remote-auth`. */
	disableRemoteAuth: boolean;
}

/** A fatal policy violation: the runtime must refuse to start. */
export interface RemoteSecurityPolicyRefusal {
	kind: "refuse";
	/** Reason code for tests / programmatic handling. */
	reason: "remote-http-without-optout" | "remote-disable-auth-without-flag";
	/** Multi-line, user-facing error message explaining the risk and the fix. */
	message: string;
}

/** The runtime may start; `warnings` (if any) must be printed prominently. */
export interface RemoteSecurityPolicyAllow {
	kind: "ok";
	/**
	 * Whether the passcode should actually be disabled. `--no-passcode` only
	 * disables auth on a *remote* bind when the dangerous flag is also present;
	 * on a loopback bind `--no-passcode` is honoured as-is (it never gated auth
	 * that was protecting the network in the first place).
	 */
	disablePasscode: boolean;
	/** Prominent multi-line warning blocks to print before the server starts. */
	warnings: string[];
}

export type RemoteSecurityPolicyDecision = RemoteSecurityPolicyRefusal | RemoteSecurityPolicyAllow;

const REMOTE_HTTP_REFUSAL_MESSAGE = [
	"Refusing to start: binding to a non-loopback host over plain HTTP is insecure.",
	"",
	"You bound the server to a network-reachable address (--host) without TLS, so the",
	"access passcode, the session cookie, and ALL traffic would cross the network in",
	"cleartext and could be read or hijacked by anyone on the path.",
	"",
	"To proceed securely, enable HTTPS:",
	"  nklein --host <ip> --cert <path/to/cert.pem> --key <path/to/key.pem>",
	"",
	"Or, if a trusted TLS-terminating reverse proxy already fronts this server and you",
	"accept the risk on a private/trusted network, opt out explicitly:",
	"  nklein --host <ip> --insecure-remote-http",
].join("\n");

const REMOTE_DISABLE_AUTH_REFUSAL_MESSAGE = [
	"Refusing to start: --no-passcode on a non-loopback (--host) bind would expose the",
	"entire runtime API — including host actions — to the network with NO authentication.",
	"",
	"--no-passcode is meant for a loopback bind, or for a remote bind that already sits",
	"behind your own trusted auth layer (e.g. a reverse proxy that authenticates first).",
	"",
	"If that is genuinely your setup and you accept full responsibility, re-run with the",
	"explicit dangerous flag instead:",
	"  nklein --host <ip> --dangerously-disable-remote-auth",
].join("\n");

function buildInsecureHttpWarning(): string {
	return [
		"╔══════════════════════════════════════════════════════════════════════════╗",
		"║  ⚠️  INSECURE REMOTE HTTP (--insecure-remote-http)                         ║",
		"╠══════════════════════════════════════════════════════════════════════════╣",
		"║  This server is bound to a NON-LOOPBACK host over PLAIN HTTP.              ║",
		"║  The access passcode, session cookie, and all traffic are sent in         ║",
		"║  CLEARTEXT and can be intercepted by anyone on the network path.          ║",
		"║  Only do this behind a trusted TLS-terminating proxy on a private net.    ║",
		"╚══════════════════════════════════════════════════════════════════════════╝",
	].join("\n");
}

function buildDisabledRemoteAuthWarning(): string {
	return [
		"╔══════════════════════════════════════════════════════════════════════════╗",
		"║  ⚠️  REMOTE AUTHENTICATION DISABLED (--dangerously-disable-remote-auth)    ║",
		"╠══════════════════════════════════════════════════════════════════════════╣",
		"║  The passcode is OFF on a network-reachable bind. The ENTIRE runtime API   ║",
		"║  — including host actions — is exposed UNAUTHENTICATED to the network.     ║",
		"║  Make sure your own auth layer (e.g. a reverse proxy) sits in front.       ║",
		"╚══════════════════════════════════════════════════════════════════════════╝",
	].join("\n");
}

/**
 * Decide the remote-mode transport/auth policy.
 *
 * Pure: no globals, no I/O. The CLI passes the resolved facts and then acts on
 * the result (throw the refusal message, or start the server after printing any
 * warnings and honouring `disablePasscode`).
 */
export function resolveRemoteSecurityPolicy(input: RemoteSecurityPolicyInput): RemoteSecurityPolicyDecision {
	// Loopback / local binds keep their existing behaviour entirely: no new
	// friction. --no-passcode there stays a plain (still honoured) toggle.
	if (!input.isRemote) {
		return { kind: "ok", disablePasscode: input.noPasscode, warnings: [] };
	}

	// Non-loopback over plain HTTP requires an explicit opt-out.
	if (!input.hasTls && !input.insecureRemoteHttp) {
		return { kind: "refuse", reason: "remote-http-without-optout", message: REMOTE_HTTP_REFUSAL_MESSAGE };
	}

	// Disabling auth on a remote bind requires the scarier, explicit flag.
	if (input.noPasscode && !input.disableRemoteAuth) {
		return {
			kind: "refuse",
			reason: "remote-disable-auth-without-flag",
			message: REMOTE_DISABLE_AUTH_REFUSAL_MESSAGE,
		};
	}

	const warnings: string[] = [];
	if (!input.hasTls && input.insecureRemoteHttp) {
		warnings.push(buildInsecureHttpWarning());
	}

	// Auth is only actually disabled on a remote bind when BOTH flags are present.
	const disablePasscode = input.noPasscode && input.disableRemoteAuth;
	if (disablePasscode) {
		warnings.push(buildDisabledRemoteAuthWarning());
	}

	return { kind: "ok", disablePasscode, warnings };
}

/**
 * Strict-Transport-Security is only meaningful — and only safe to assert — over
 * HTTPS: on plain HTTP browsers ignore it, and sending it when the connection
 * is not actually secure would be a lie. So we attach HSTS to served responses
 * exactly when TLS is configured, and nothing otherwise (§5.Y #7).
 *
 * Returns a spreadable header map so callers can `...buildTlsHardeningHeaders(...)`
 * into a `writeHead` object. 2 years + includeSubDomains is the standard strong value.
 */
export function buildTlsHardeningHeaders(hasTls: boolean): Record<string, string> {
	if (!hasTls) {
		return {};
	}
	return { "Strict-Transport-Security": "max-age=63072000; includeSubDomains" };
}

/**
 * Content-Security-Policy for the runtime-served app (§5.Y #12).
 *
 * Key decisions:
 * - `script-src 'self'` — the real XSS win. Vite externalises all scripts;
 *   the only inline script was the SW registration in index.html, which is now
 *   moved into main.tsx so this strict directive applies cleanly.
 * - `style-src 'self' 'unsafe-inline'` — React inline `style={{}}` and Tailwind
 *   need inline styles; there is no server-side nonce available here.
 * - `connect-src 'self' ws: wss:` — same-origin tRPC + both plain and TLS
 *   WebSocket (the runtime WS is same-origin, ws:/127… or wss://).
 * - `img-src 'self' data: blob:` — the SVG favicon uses a data: URI; blob: is
 *   for any dynamically created image URLs in the app.
 * - `font-src 'self' data:` — any data: embedded fonts in built CSS.
 * - (no `media-src`) — media falls back to `default-src 'self'`, so only
 *   self-hosted onboarding media is permitted. External demo videos are
 *   intentionally NOT whitelisted: GitHub user-attachments redirect to signed
 *   `*.s3.amazonaws.com` URLs, and opening the CSP to any S3 bucket for inherited
 *   marketing videos is not worth the exposure (see todo.md — !Klein onboarding media).
 * - `object-src 'none'` — no plugins.
 * - `base-uri 'self'` — prevents a <base> injection from hijacking relative URLs.
 * - `frame-ancestors 'none'` — redundant with X-Frame-Options: DENY but included
 *   for CSP-aware browsers (CSP2+).
 */
export const APP_CONTENT_SECURITY_POLICY =
	"default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; " +
	"font-src 'self' data:; " +
	"connect-src 'self' ws: wss:; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"frame-ancestors 'none'";
