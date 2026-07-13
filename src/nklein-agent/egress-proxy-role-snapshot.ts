import {
	AGENT_RULESET_ROLES,
	type AgentCapabilityRulesetConfig,
	type AgentRulesetRole,
	capabilitiesForTier,
	resolveCapabilityTier,
} from "../core/agent-rulesets";
import type { EgressProxyRoleSnapshot } from "../core/egress-proxy-verdict";

/**
 * Pure resolver for the per-role policy snapshot the I2a egress-proxy server binds to each listener
 * (`EgressProxyServerDeps.resolveRoleSnapshot`; docs/dev/egress-proxy-design.md §4 "one listener port per role"). It
 * COMPOSES the existing rulesets — role → capability tier → `networkPolicy` — and layers an INJECTED allowlist (and
 * optional per-action-approval) source on top. The real allowlist config surface is a LATER increment (I3, §6); until
 * then the source is injected so this module invents no config of its own (default: empty ⇒ default-deny).
 *
 * Fail-closed (R2): an unknown / unresolvable role returns `null`, which the server maps to a `no_egress_policy` deny.
 * Pure — no I/O, no config reads of its own.
 */

export interface EgressProxyRoleSnapshotDeps {
	/** Resolved capability ruleset (global preset + optional per-role overrides). Absent ⇒ the built-in default tier. */
	capabilityConfig?: AgentCapabilityRulesetConfig;
	/** Injected per-role allowlist source (real config lands in I3). Unset for a role ⇒ empty (default-deny). */
	allowlistForRole?: (role: AgentRulesetRole) => readonly string[];
	/** Injected per-role per-action-approval source (I3+/I5). Absent ⇒ the field is omitted from the snapshot. */
	requirePerActionApprovalForRole?: (role: AgentRulesetRole) => boolean;
}

function isAgentRulesetRole(role: string): role is AgentRulesetRole {
	return (AGENT_RULESET_ROLES as readonly string[]).includes(role);
}

/**
 * Resolve `role` → `{ role, networkPolicy, allowlist, requirePerActionApproval? }`, or `null` for an unknown role. The
 * `networkPolicy` is the role's capability-tier network posture (`resolveCapabilityTier` → `capabilitiesForTier`); the
 * allowlist and approval flag come ONLY from the injected deps — this resolver never derives policy or reads config.
 */
export function resolveEgressProxyRoleSnapshot(
	role: string,
	deps: EgressProxyRoleSnapshotDeps = {},
): EgressProxyRoleSnapshot | null {
	if (!isAgentRulesetRole(role)) {
		// Fail closed: an unknown role has no resolvable policy, so it gets no snapshot (server ⇒ deny).
		return null;
	}
	const tier = resolveCapabilityTier(deps.capabilityConfig, role);
	const { network } = capabilitiesForTier(tier);
	const allowlist = deps.allowlistForRole?.(role) ?? [];
	const requirePerActionApproval = deps.requirePerActionApprovalForRole?.(role);
	return {
		role,
		networkPolicy: network,
		allowlist,
		// Omit the optional field entirely when no source injects it, matching the I2a snapshot shape.
		...(requirePerActionApproval !== undefined ? { requirePerActionApproval } : {}),
	};
}

/**
 * §5.L egress proxy config surface (§6 I3): parse the free-form `sandboxEgressAllowlist` Settings string
 * (comma/newline-separated hosts) into a clean host list — trim each entry, drop blanks, de-duplicate (first
 * occurrence wins, order preserved). Unset/blank ⇒ `[]` ⇒ default-deny (fail-closed, R2). Pure.
 *
 * This is the CANONICAL allowlist parser the manager feeds into the role-snapshot `allowlistForRole` source. v1
 * applies ONE global allowlist to EVERY role (`allowlistForRole: () => parseEgressAllowlist(raw)`); per-role
 * allowlists (`egressAllowlist.roleOverrides`, design §6 I3) are a later refinement layered on this same seam.
 */
export function parseEgressAllowlist(raw: string | null | undefined): string[] {
	if (raw === undefined || raw === null) {
		return [];
	}
	const seen = new Set<string>();
	const hosts: string[] = [];
	for (const entry of raw.split(/[,\n]/)) {
		const host = entry.trim();
		if (host.length === 0 || seen.has(host)) {
			continue;
		}
		seen.add(host);
		hosts.push(host);
	}
	return hosts;
}

/** The parsed role-scoped allowlist: hosts every role may reach + per-role additions. */
export interface RoleScopedEgressAllowlist {
	/** Unscoped entries — reachable by EVERY role (the v1 global semantics, unchanged). */
	global: string[];
	/** `role:host` entries — reachable by exactly that role (in addition to the global set). */
	byRole: Partial<Record<AgentRulesetRole, string[]>>;
}

/**
 * F2.4 (§6 I3 roleOverrides) — parse the SAME `sandboxEgressAllowlist` Settings string with optional
 * ROLE-SCOPED entries: `worker:api.github.com` grants a host to ONE role; a plain `api.github.com` stays global
 * (every role), so every v1 string parses byte-identically to the global-only shape. An entry scoped to an
 * UNKNOWN role prefix is treated as a PLAIN host (the prefix is part of the name — e.g. `svc:8080`-style names
 * never silently vanish), keeping the parse total and fail-safe-narrow: a typo'd role name grants the host to
 * nobody extra, it just stays a (probably unreachable) global entry. Trim/dedupe rules mirror
 * {@link parseEgressAllowlist}.
 */
export function parseRoleScopedEgressAllowlist(raw: string | null | undefined): RoleScopedEgressAllowlist {
	const parsed: RoleScopedEgressAllowlist = { global: [], byRole: {} };
	const seen = new Set<string>();
	for (const entry of parseEgressAllowlist(raw)) {
		if (seen.has(entry)) {
			continue;
		}
		seen.add(entry);
		const colon = entry.indexOf(":");
		if (colon > 0) {
			const prefix = entry.slice(0, colon).trim();
			const host = entry.slice(colon + 1).trim();
			if (isAgentRulesetRole(prefix) && host.length > 0) {
				const bucket = parsed.byRole[prefix] ?? [];
				bucket.push(host);
				parsed.byRole[prefix] = bucket;
				continue;
			}
		}
		parsed.global.push(entry);
	}
	return parsed;
}

/**
 * The `allowlistForRole` source over a role-scoped parse: a role reaches the GLOBAL hosts plus its own scoped
 * additions (order: global first, then role-specific; de-duplicated). The F2.4 per-role listener isolation comes
 * from composing this with the per-role listeners the entrypoint already binds — each role's listener resolves
 * ONLY its own snapshot, so a worker can never use an architect-scoped host.
 */
export function allowlistForRoleFromScoped(
	scoped: RoleScopedEgressAllowlist,
): (role: AgentRulesetRole) => readonly string[] {
	return (role) => {
		const combined = [...scoped.global, ...(scoped.byRole[role] ?? [])];
		return [...new Set(combined)];
	};
}
