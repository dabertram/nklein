/**
 * F2.2 (§5.L) — capability GRANTS with least scope + bounded duration, and the retry-never-widens rule by
 * construction. A user confirmation of a gated action grants EXACTLY the scope that was confirmed (the canonical
 * scope key below — the exact command string, the exact path, the exact host), for a bounded TTL. A later call
 * with the SAME key inside the TTL is covered (no re-prompt); a retry that widens ANYTHING (different command,
 * different path, different host, different action kind) produces a DIFFERENT key, matches no grant, and goes
 * back through the full confirm/deny path — silent widening is structurally impossible because coverage is exact
 * string equality, never a subsumption check. Pure + clock-injected.
 */

export interface CapabilityGrant {
	key: string;
	grantedAt: number;
	expiresAt: number;
}

export const DEFAULT_CAPABILITY_GRANT_TTL_MS = 15 * 60_000;

export interface CapabilityGrantStore {
	/** Record a grant for EXACTLY `key` (replacing any prior grant of the same key). */
	record: (sessionId: string, key: string, now: number, ttlMs?: number) => CapabilityGrant;
	/** Whether an unexpired grant for EXACTLY `key` exists. */
	covers: (sessionId: string, key: string, now: number) => boolean;
	/** Active (unexpired) grants for the session, oldest first. */
	list: (sessionId: string, now: number) => CapabilityGrant[];
	clear: (sessionId: string) => void;
	clearAll: () => void;
}

export function createCapabilityGrantStore(): CapabilityGrantStore {
	const grantsBySession = new Map<string, Map<string, CapabilityGrant>>();
	return {
		record(sessionId, key, now, ttlMs = DEFAULT_CAPABILITY_GRANT_TTL_MS) {
			const grant: CapabilityGrant = { key, grantedAt: now, expiresAt: now + Math.max(0, ttlMs) };
			const sessionGrants = grantsBySession.get(sessionId) ?? new Map<string, CapabilityGrant>();
			sessionGrants.set(key, grant);
			grantsBySession.set(sessionId, sessionGrants);
			return grant;
		},
		covers(sessionId, key, now) {
			const grant = grantsBySession.get(sessionId)?.get(key);
			return grant !== undefined && now < grant.expiresAt;
		},
		list(sessionId, now) {
			return [...(grantsBySession.get(sessionId)?.values() ?? [])]
				.filter((grant) => now < grant.expiresAt)
				.sort((left, right) => left.grantedAt - right.grantedAt);
		},
		clear(sessionId) {
			grantsBySession.delete(sessionId);
		},
		clearAll() {
			grantsBySession.clear();
		},
	};
}

/**
 * The canonical LEAST-SCOPE key for a chat tool call: the narrowest stable identity of what was actually
 * confirmed. Unknown/argless shapes fall back to `<actionKind>:<toolName>` (whole-tool scope — still bounded by
 * the action kind and TTL). Keys are plain strings compared exactly; nothing here subsumes anything else.
 */
export function scopeKeyForChatCall(actionKind: string, toolName: string, args: Record<string, unknown>): string {
	const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
	switch (actionKind) {
		case "host_command": {
			const command = str(args.command);
			return command ? `host_command:${command}` : `host_command:${toolName}`;
		}
		case "host_write":
		case "host_read":
		case "sandbox_write": {
			const path = str(args.path) ?? str(args.file) ?? str(args.target);
			return path ? `${actionKind}:${path}` : `${actionKind}:${toolName}`;
		}
		case "egress_read": {
			const url = str(args.url);
			if (url) {
				try {
					return `egress_read:${new URL(url).host}`;
				} catch {
					return `egress_read:${url}`;
				}
			}
			const query = str(args.query);
			return query ? `egress_read:search:${query}` : `egress_read:${toolName}`;
		}
		default:
			return `${actionKind}:${toolName}`;
	}
}
