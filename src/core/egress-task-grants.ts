/**
 * Per-task, per-host, TIME-BOUNDED egress grants — the proper allowlist extension for the `lookup` fact-check tool.
 *
 * The sandbox egress proxy's allowlist is a static host list per role (`sandboxEgressAllowlist`, expanded through
 * the ecosystem packs). A general web search cannot pre-list the pages it will find, so the trusted runtime — never
 * the sandbox, never the model — registers ONE result host for ONE task for a short window through the proxy's
 * authenticated loopback control channel (`POST /task-grants/issue`). The proxy merges the task's live grants into
 * that task's allowlist ONLY when the request carries the task's own proxy credential, so a grant is attributable
 * (audit records name the task), bounded (it expires), and narrow (one host, ports 443/80 as always).
 *
 * Pure registry: the clock is injected, so expiry is unit-testable; the proxy's `taskGrantHosts(taskId)` reads it.
 */

export interface EgressTaskGrant {
	readonly taskId: string;
	/** Normalized lowercase host; no port, no scheme. */
	readonly host: string;
	readonly expiresAt: number;
	/** Why the grant exists (audit trail only, e.g. "lookup"). */
	readonly purpose: string;
}

export interface EgressTaskGrantRegistry {
	/** Register (or extend) a grant; returns the stored grant. Invalid hosts are rejected (null). */
	issue: (
		grant: { taskId: string; host: string; ttlMs: number; purpose?: string },
		now: number,
	) => EgressTaskGrant | null;
	/** The hosts a task may currently reach beyond the static allowlist. */
	hostsFor: (taskId: string, now: number) => string[];
	/** Drop every grant of a task (placement release). Idempotent. */
	revoke: (taskId: string) => void;
	/** Drop expired grants (housekeeping). */
	prune: (now: number) => void;
	clearAll: () => void;
}

/** Longest window a single grant may hold: a lookup fetch completes in seconds; a minute is generous. */
export const MAX_EGRESS_TASK_GRANT_TTL_MS = 60_000;
export const DEFAULT_EGRESS_TASK_GRANT_TTL_MS = 30_000;

const HOST_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** A DNS host name (lowercased, at least one dot); IP literals and single labels are refused. */
export function normalizeGrantHost(raw: string): string | null {
	const host = raw.trim().toLowerCase().replace(/\.$/, "");
	if (!HOST_PATTERN.test(host)) {
		return null;
	}
	if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
		return null;
	}
	return host;
}

export function createEgressTaskGrantRegistry(): EgressTaskGrantRegistry {
	const grantsByTaskId = new Map<string, Map<string, EgressTaskGrant>>();
	return {
		issue(input, now) {
			const host = normalizeGrantHost(input.host);
			if (!host || !input.taskId || !Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
				return null;
			}
			const ttlMs = Math.min(MAX_EGRESS_TASK_GRANT_TTL_MS, Math.trunc(input.ttlMs));
			const grant: EgressTaskGrant = {
				taskId: input.taskId,
				host,
				expiresAt: now + ttlMs,
				purpose: input.purpose?.trim() || "lookup",
			};
			const existing = grantsByTaskId.get(input.taskId) ?? new Map<string, EgressTaskGrant>();
			existing.set(host, grant);
			grantsByTaskId.set(input.taskId, existing);
			return grant;
		},
		hostsFor(taskId, now) {
			const grants = grantsByTaskId.get(taskId);
			if (!grants) {
				return [];
			}
			const hosts: string[] = [];
			for (const [host, grant] of grants) {
				if (grant.expiresAt > now) {
					hosts.push(host);
				} else {
					grants.delete(host);
				}
			}
			return hosts;
		},
		revoke(taskId) {
			grantsByTaskId.delete(taskId);
		},
		prune(now) {
			for (const [taskId, grants] of grantsByTaskId) {
				for (const [host, grant] of grants) {
					if (grant.expiresAt <= now) {
						grants.delete(host);
					}
				}
				if (grants.size === 0) {
					grantsByTaskId.delete(taskId);
				}
			}
		},
		clearAll() {
			grantsByTaskId.clear();
		},
	};
}
