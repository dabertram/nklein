/**
 * Loopback-only network-access info (§ desktop app #2 — LAN serving). The desktop Settings
 * dialog (and a host-machine browser) needs to SHOW the live LAN-serving state: whether the
 * runtime is on a non-loopback bind, the browse-to public host, and — when the passcode gate
 * is active — the passcode itself so the operator can type it on a second device.
 *
 * SECURITY: the passcode must never cross the network. This resolver answers ONLY when the
 * request's socket peer address is loopback; every other caller gets a 404 (not 403 — the
 * endpoint should not even advertise its existence to the LAN). Same-machine callers already
 * bypass the passcode gate entirely (see remote-request-auth.ts), so revealing the passcode
 * to them grants nothing they don't already have. Pure decision + injected facts, so the
 * whole surface is unit-testable without booting the server.
 */
import { isLoopbackAddress } from "../security/remote-request-auth";

export interface NetworkAccessInfoFacts {
	/** The SOCKET peer address of the caller (`req.socket.remoteAddress`). */
	remoteAddress: string | null | undefined;
	/** True when the runtime is bound to a non-loopback host (`isKanbanRemoteHost()`). */
	isRemoteMode: boolean;
	/** True when passcode enforcement is active (`isPasscodeEnabled()`). */
	passcodeEnabled: boolean;
	/** The active passcode for local display, or null (`getPasscodeForLocalDisplay()`). */
	passcode: string | null;
	/** The advertised browse-to host (`getKanbanRuntimePublicHost()`), or null when none is set. */
	publicHost: string | null;
	/** The runtime port (`getKanbanRuntimePort()`). */
	port: number;
	/** The advertised runtime origin (`getKanbanRuntimeOrigin()`). */
	origin: string;
}

/** The JSON body served to loopback callers. */
export interface NetworkAccessInfoBody {
	/** True when the runtime listens on a non-loopback host (LAN serving is live). */
	lanServing: boolean;
	/** True when LAN callers must pass the passcode gate. */
	passcodeRequired: boolean;
	/** The active passcode — present ONLY when `passcodeRequired` (and only ever over loopback). */
	passcode: string | null;
	/** The browse-to host for LAN devices, or null when none was advertised/detected. */
	publicHost: string | null;
	port: number;
	/** The advertised runtime origin (what LAN users should open when `lanServing`). */
	origin: string;
}

export type NetworkAccessInfoResolution = { kind: "ok"; body: NetworkAccessInfoBody } | { kind: "not-found" };

/** Resolve the `/api/network-access` response from already-gathered facts. */
export function resolveNetworkAccessInfo(facts: NetworkAccessInfoFacts): NetworkAccessInfoResolution {
	if (!isLoopbackAddress(facts.remoteAddress)) {
		return { kind: "not-found" };
	}
	const passcodeRequired = facts.isRemoteMode && facts.passcodeEnabled;
	return {
		kind: "ok",
		body: {
			lanServing: facts.isRemoteMode,
			passcodeRequired,
			passcode: passcodeRequired ? facts.passcode : null,
			publicHost: facts.publicHost,
			port: facts.port,
			origin: facts.origin,
		},
	};
}
