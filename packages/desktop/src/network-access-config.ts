/**
 * LAN-serving host resolution for the desktop app (§ desktop app — "serve the UI via a webserver, so that it can be
 * accessed from LAN"). PURE plan + a dependency-injected LAN-IP detector, so the bind decision is fully unit-testable
 * without a live OS or Electron — the same pattern as autostart-config.ts.
 *
 * SECURITY POSTURE — DEFAULT OFF, and this module never weakens auth:
 *   - Off (default) ⇒ the runtime binds loopback only (`127.0.0.1`), byte-identical to today: only this machine reaches it.
 *   - On (explicit opt-in) ⇒ the runtime binds a wildcard interface so LAN devices can reach it. The runtime's OWN guard
 *     then authenticates: a non-loopback bind auto-generates a passcode unless the operator explicitly passes the
 *     `--no-passcode`/`--dangerously-disable-remote-auth` escape hatches. This module only decides the bind HOST; it
 *     resolves `publicHost` (the browse-to address) purely for display and never touches the passcode/TLS guards.
 */
import type { NetworkInterfaceInfo } from "node:os";

/** Loopback — the safe default: only this machine can reach the runtime. */
export const LOOPBACK_HOST = "127.0.0.1";
/** Wildcard — bind every interface so LAN devices can reach the runtime (opt-in). */
export const WILDCARD_HOST = "0.0.0.0";

export interface DesktopBindPlan {
	/** The `--host` the runtime binds to. */
	host: string;
	/** The host/IP LAN users browse to (the runtime's `--public-host`), or null on loopback / when none is detectable. */
	publicHost: string | null;
	/**
	 * Whether to pass the runtime's `--insecure-remote-http` opt-out. The runtime refuses a non-loopback bind over
	 * plain HTTP without it (remote-security-policy.ts), and a packaged desktop app has no TLS cert to offer — so the
	 * LAN opt-in implies it. DECIDED (§ desktop app #2): passcode auth over plain LAN HTTP, not self-signed TLS —
	 * per-device certificate-trust friction outweighs the wire-privacy gain on a private network, and the Settings
	 * toggle carries the explicit cleartext warning instead. Always false on loopback (the flag would be meaningless).
	 */
	insecureRemoteHttp: boolean;
}

/**
 * Resolve the runtime bind host from the persisted network-access preference. Off ⇒ loopback (safe default). On ⇒
 * wildcard bind, advertising the detected LAN IPv4 as the browse-to address when one is known.
 */
export function resolveDesktopBindPlan(input: { enabled: boolean; lanIpv4: string | null }): DesktopBindPlan {
	if (!input.enabled) {
		return { host: LOOPBACK_HOST, publicHost: null, insecureRemoteHttp: false };
	}
	return { host: WILDCARD_HOST, publicHost: input.lanIpv4, insecureRemoteHttp: true };
}

/**
 * The host the DESKTOP itself dials (health checks, the BrowserWindow URL) for a given bind host. A wildcard bind is
 * not a dialable address — Windows cannot connect to 0.0.0.0 and Chromium ≥128 blocks it outright ("0.0.0.0-day"
 * mitigation) — so the desktop always talks to its own runtime over loopback; only LAN devices use the public host.
 */
export function resolveRuntimeConnectHost(bindHost: string): string {
	if (bindHost === WILDCARD_HOST || bindHost === "::" || bindHost === "[::]") {
		return LOOPBACK_HOST;
	}
	return bindHost;
}

/** Ranks the common private-LAN ranges so the most likely home-LAN address wins: 192.168 → 10 → 172.16-31. */
function lanRangeRank(addr: string): number {
	if (addr.startsWith("192.168.")) {
		return 0;
	}
	if (addr.startsWith("10.")) {
		return 1;
	}
	return 2;
}

/** True for RFC-1918 private IPv4 ranges (192.168/16, 10/8, 172.16/12). Public / CGNAT / VPN addresses are excluded. */
export function isPrivateLanIpv4(addr: string): boolean {
	if (addr.startsWith("192.168.") || addr.startsWith("10.")) {
		return true;
	}
	const match = /^172\.(\d{1,3})\./.exec(addr);
	if (match) {
		const secondOctet = Number(match[1]);
		return secondOctet >= 16 && secondOctet <= 31;
	}
	return false;
}

/**
 * Pick the primary private LAN IPv4 from a set of interfaces (used for the `--public-host` browse-to address). Skips
 * loopback, link-local, internal, and non-private addresses; prefers the common home-LAN range order. Returns null when
 * no private IPv4 is present (offline, or only a public/VPN address) — the caller still binds wildcard, just without an
 * advertisable URL.
 */
export function detectPrimaryLanIpv4(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
	const candidates: string[] = [];
	for (const infos of Object.values(interfaces)) {
		for (const info of infos ?? []) {
			if (info.internal) {
				continue;
			}
			// `family` is "IPv4" on modern Node but was the number 4 on older runtimes — accept both.
			const isIpv4 = info.family === "IPv4" || (info.family as unknown as number) === 4;
			if (!isIpv4) {
				continue;
			}
			if (isPrivateLanIpv4(info.address)) {
				candidates.push(info.address);
			}
		}
	}
	if (candidates.length === 0) {
		return null;
	}
	candidates.sort((a, b) => lanRangeRank(a) - lanRangeRank(b));
	return candidates[0] ?? null;
}

export interface DesktopStartupBindDeps {
	/** Reads the persisted opt-in (e.g. `() => loadNetworkAccessEnabled(app.getPath("userData"))`). */
	loadEnabled: () => boolean;
	/** The OS network-interface snapshot (e.g. `os.networkInterfaces`). Only consulted when the opt-in is ON. */
	networkInterfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
}

/**
 * Compose the persisted opt-in + live LAN-IP detection into the startup bind plan main.ts hands the runtime. LAN-IP
 * detection is skipped entirely when the opt-in is OFF (the default), so the common case never enumerates interfaces.
 */
export function resolveDesktopStartupBind(deps: DesktopStartupBindDeps): DesktopBindPlan {
	const enabled = deps.loadEnabled();
	const lanIpv4 = enabled ? detectPrimaryLanIpv4(deps.networkInterfaces()) : null;
	return resolveDesktopBindPlan({ enabled, lanIpv4 });
}
