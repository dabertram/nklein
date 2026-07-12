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
