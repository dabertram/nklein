/**
 * Remote-mode request authentication — the single decision point for the passcode gate
 * (HTTP requests, runtime WebSocket upgrades, and terminal WebSocket upgrades all call this
 * instead of re-implementing the cookie/bearer checks inline).
 *
 * LOOPBACK TRUST (§ desktop app #2 — LAN serving): requests arriving FROM a loopback address
 * are authenticated unconditionally, even on a non-loopback bind. Rationale: the passcode
 * protects the NETWORK surface that a `--host` bind newly exposes; same-machine callers were
 * always fully trusted (the default loopback bind is intentionally unauthenticated, and local
 * CLI sub-processes hold the internal token anyway). Without this, the desktop shell — which
 * loads the UI via 127.0.0.1 while the runtime listens on a wildcard — would face its own
 * passcode prompt and fail the §5.Y #10 nonce handshake. The check uses the SOCKET peer
 * address only; forwarding headers (X-Forwarded-For etc.) are deliberately ignored because a
 * network client controls them.
 */
import {
	extractBearerToken,
	extractSessionTokenFromCookie,
	validateInternalToken,
	validateSession,
} from "./passcode-manager";

/**
 * True when a socket peer address is a loopback address: IPv4 `127.0.0.0/8`, IPv6 `::1`, or
 * the IPv4-mapped form Node reports on dual-stack sockets (`::ffff:127.x.x.x`).
 */
export function isLoopbackAddress(remoteAddress: string | null | undefined): boolean {
	if (!remoteAddress) {
		return false;
	}
	const normalized = remoteAddress.startsWith("::ffff:") ? remoteAddress.slice("::ffff:".length) : remoteAddress;
	return normalized === "::1" || normalized.startsWith("127.");
}

export interface RemoteRequestAuthInput {
	/** The gate switch: `isKanbanRemoteHost() && isPasscodeEnabled()`. False ⇒ everything is allowed. */
	passcodeActive: boolean;
	/** The SOCKET peer address (`req.socket.remoteAddress`) — never a forwarding header. */
	remoteAddress: string | null | undefined;
	/** The raw `Cookie` request header (browser session flow). */
	cookieHeader: string | undefined;
	/** The raw `Authorization` request header (internal CLI bearer-token flow). */
	authorizationHeader: string | undefined;
}

export type RemoteRequestAuthVia = "gate-inactive" | "loopback" | "session" | "internal-token";

export type RemoteRequestAuthDecision = { authenticated: true; via: RemoteRequestAuthVia } | { authenticated: false };

/** Decide whether a request may pass the remote-mode passcode gate. Pure aside from the in-memory session/token stores. */
export function evaluateRemoteRequestAuth(input: RemoteRequestAuthInput): RemoteRequestAuthDecision {
	if (!input.passcodeActive) {
		return { authenticated: true, via: "gate-inactive" };
	}
	if (isLoopbackAddress(input.remoteAddress)) {
		return { authenticated: true, via: "loopback" };
	}
	const sessionToken = extractSessionTokenFromCookie(input.cookieHeader);
	if (sessionToken !== null && validateSession(sessionToken)) {
		return { authenticated: true, via: "session" };
	}
	const bearerToken = extractBearerToken(input.authorizationHeader);
	if (bearerToken !== null && validateInternalToken(bearerToken)) {
		return { authenticated: true, via: "internal-token" };
	}
	return { authenticated: false };
}
