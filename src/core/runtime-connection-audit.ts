/**
 * N15 — the LOCAL-ONLY assertion's pure core: classify OBSERVED outbound TCP connections of the runtime's
 * process tree and fail on any non-loopback destination.
 *
 * This deliberately overlaps nothing with the egress broker family (`egress-policy-decision.ts`, receipts,
 * proxy audit): those gate requests at the seams !Klein CONTROLS — the decider is asked before a socket
 * opens. This audit is the INDEPENDENT cross-check from outside the process: it reads what the OS says
 * actually connected (`lsof -nP -iTCP -sTCP:ESTABLISHED` samples), so an unfenced code path — a dependency
 * phoning home, a tool bypassing the broker — still shows up. Prime directive #1 as a TESTED guarantee
 * rather than a design intention (feeds the trust-center posture table).
 *
 * Sampling honesty: an lsof poll can MISS short-lived connections between samples. The verdict therefore
 * only ever says "no violation OBSERVED", never "no connection happened" — and the harness half records
 * every sample so a pass is auditable. The in-product receipts remain the complete record for fenced paths;
 * this catches the paths receipts cannot see.
 *
 * Strictness: loopback passes; EVERYTHING else — including private/LAN ranges — is a violation unless the
 * caller allowlists it explicitly (the returning fleet's LM-Link hosts will be passed in by name/address
 * when cross-host runs resume; today's single-host cell passes an empty allowlist).
 */

export interface ObservedTcpConnection {
	/** Process command name as lsof reports it (column 1). */
	readonly command: string;
	readonly pid: number;
	/** Remote host as text — IPv4, bracketed IPv6, or a name when lsof ran without -n. */
	readonly remoteHost: string;
	readonly remotePort: number;
}

/**
 * Parse one `lsof -nP -iTCP -sTCP:ESTABLISHED` output line into an observed connection.
 * Returns null for the header, malformed rows, and rows without a `local->remote` NAME column.
 */
export function parseLsofEstablishedLine(line: string): ObservedTcpConnection | null {
	const trimmed = line.trim();
	if (trimmed.length === 0 || trimmed.startsWith("COMMAND")) {
		return null;
	}
	const columns = trimmed.split(/\s+/);
	if (columns.length < 9) {
		return null;
	}
	const pid = Number(columns[1]);
	if (!Number.isInteger(pid) || pid <= 0) {
		return null;
	}
	const name =
		columns[columns.length - 1] === "(ESTABLISHED)" ? columns[columns.length - 2] : columns[columns.length - 1];
	const arrow = name.indexOf("->");
	if (arrow < 0) {
		return null;
	}
	const remote = name.slice(arrow + 2);
	// Forms: "1.2.3.4:443", "[2001:db8::1]:443", "host.example:8080".
	const v6 = remote.match(/^\[([^\]]+)\]:(\d+)$/);
	if (v6) {
		return { command: columns[0], pid, remoteHost: v6[1], remotePort: Number(v6[2]) };
	}
	const lastColon = remote.lastIndexOf(":");
	if (lastColon <= 0) {
		return null;
	}
	const port = Number(remote.slice(lastColon + 1));
	if (!Number.isInteger(port) || port <= 0) {
		return null;
	}
	return { command: columns[0], pid, remoteHost: remote.slice(0, lastColon), remotePort: port };
}

/** Loopback = the ONLY destinations that pass without an explicit allowlist entry. */
export function isLoopbackRemoteHost(host: string): boolean {
	const normalized = host.trim().toLowerCase();
	if (normalized === "localhost" || normalized === "::1") {
		return true;
	}
	if (/^127(\.\d{1,3}){3}$/.test(normalized)) {
		return true;
	}
	// IPv4-mapped IPv6 loopback (::ffff:127.0.0.1) — same wire destination, different spelling.
	const mapped = normalized.match(/^::ffff:(127(\.\d{1,3}){3})$/);
	return mapped !== null;
}

export interface ConnectionAuditViolation {
	readonly command: string;
	readonly pid: number;
	readonly remoteHost: string;
	readonly remotePort: number;
	/** How many samples observed this (command, remote) pair — repeat sightings are one violation, counted. */
	readonly observations: number;
}

export interface ConnectionAuditVerdict {
	readonly ok: boolean;
	/** Distinct non-loopback, non-allowlisted destinations observed, most-observed first. */
	readonly violations: readonly ConnectionAuditViolation[];
	/** Total parsed connection observations (loopback included) — 0 total means the sampler saw NOTHING, which
	 *  a caller must treat as "sampler broken", never as a pass (silence is not success). */
	readonly observedConnections: number;
}

/**
 * The assertion: every observed connection is loopback or explicitly allowlisted (exact host match after
 * trim/lowercase — names and addresses are distinct entries; the harness passes both spellings when it
 * allowlists a fleet host).
 */
export function buildConnectionAuditVerdict(
	observations: readonly ObservedTcpConnection[],
	options: { readonly allowedRemoteHosts?: readonly string[] } = {},
): ConnectionAuditVerdict {
	const allowed = new Set((options.allowedRemoteHosts ?? []).map((host) => host.trim().toLowerCase()));
	const byKey = new Map<string, ConnectionAuditViolation>();
	for (const observation of observations) {
		const host = observation.remoteHost.trim().toLowerCase();
		if (isLoopbackRemoteHost(host) || allowed.has(host)) {
			continue;
		}
		const key = `${observation.command}:${host}:${observation.remotePort}`;
		const existing = byKey.get(key);
		byKey.set(
			key,
			existing
				? { ...existing, observations: existing.observations + 1 }
				: {
						command: observation.command,
						pid: observation.pid,
						remoteHost: observation.remoteHost,
						remotePort: observation.remotePort,
						observations: 1,
					},
		);
	}
	const violations = [...byKey.values()].sort((left, right) => right.observations - left.observations);
	return { ok: violations.length === 0, violations, observedConnections: observations.length };
}
