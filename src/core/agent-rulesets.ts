/**
 * Per-role agent rulesets: two independent, tiered dials that let the user "unleash" the swarm while keeping
 * the platform's hard invariants intact.
 *
 *  1. **Capability dial** — sandbox network egress + which optional tools a role's agents may use.
 *  2. **Delivery-autonomy dial** — how far commit → PR → merge proceeds without a human (a *separate* trait,
 *     per the product decision; security capability and delivery autonomy are not the same axis).
 *
 * Each dial has five monotonic tiers (`strict` → `fully_open`) and is configured as a **global preset** with
 * optional **per-role overrides** (architect / worker / reviewer). This module is intentionally pure (no I/O,
 * no SDK): it defines the tier enums, their effect matrices, and the resolution logic so the escape conditions
 * are unit-testable without a live runtime, mirroring `review-loop.ts` and `acceptance-failure-taxonomy.ts`.
 *
 * HARD INVARIANTS — NOT encoded here, because **no tier may ever change them** (they are enforced
 * unconditionally elsewhere):
 *  - Docker agent isolation is mandatory and fail-closed (prime directive #2). No tier — not even `fully_open` —
 *    runs an agent's shell/FS on the host. Tiers only widen what happens *inside* the hardened container.
 *  - Cloud-LLM lockdown is absolute (prime directive #1). "Open" grants web/data egress and tools, **never** a
 *    paid/cloud model provider.
 *  - The ≥32k context floor is unchanged.
 */

export const AGENT_RULESET_ROLES = ["architect", "worker", "reviewer"] as const;
export type AgentRulesetRole = (typeof AGENT_RULESET_ROLES)[number];

export const AGENT_CAPABILITY_TIERS = ["strict", "less_strict", "medium", "more_open", "fully_open"] as const;
export type AgentCapabilityTier = (typeof AGENT_CAPABILITY_TIERS)[number];

export const AGENT_DELIVERY_TIERS = ["strict", "less_strict", "medium", "more_open", "fully_open"] as const;
export type AgentDeliveryTier = (typeof AGENT_DELIVERY_TIERS)[number];

/** Product decision (2026-06-22): both dials default to the most open tier. */
export const DEFAULT_AGENT_CAPABILITY_TIER: AgentCapabilityTier = "fully_open";
export const DEFAULT_AGENT_DELIVERY_TIER: AgentDeliveryTier = "fully_open";

/** Docker `--network` posture for the sandbox. Docker isolation itself is always on regardless of this value. */
export type SandboxNetworkPolicy = "none" | "allowlist" | "full";
export type McpAccess = "off" | "local" | "on";

export interface AgentCapabilities {
	network: SandboxNetworkPolicy;
	/** Web research / fetch tool (requires `network !== "none"`). */
	webResearch: boolean;
	/** Headless browser tool. */
	headlessBrowser: boolean;
	mcp: McpAccess;
}

export interface AgentDeliveryPolicy {
	autoCommit: boolean;
	autoMerge: boolean;
	/** Self-merge when the regression delta is null/unknown — only the most open tier permits this. */
	allowSelfMergeOnUnknownDelta: boolean;
}

const CAPABILITY_MATRIX: Record<AgentCapabilityTier, AgentCapabilities> = {
	strict: { network: "none", webResearch: false, headlessBrowser: false, mcp: "off" },
	less_strict: { network: "none", webResearch: false, headlessBrowser: false, mcp: "local" },
	medium: { network: "allowlist", webResearch: true, headlessBrowser: false, mcp: "local" },
	more_open: { network: "full", webResearch: true, headlessBrowser: true, mcp: "on" },
	fully_open: { network: "full", webResearch: true, headlessBrowser: true, mcp: "on" },
};

// §10c#17 (user 2026-07-12): the open_pr delivery semantic is REMOVED — result branch + held-in-review IS delivery
// (never shell out to gh). `medium` therefore collapses to the same delivery policy as `less_strict` (auto-commit,
// human merge); the tiers stay distinct on the CAPABILITY axis above.
const DELIVERY_MATRIX: Record<AgentDeliveryTier, AgentDeliveryPolicy> = {
	strict: { autoCommit: false, autoMerge: false, allowSelfMergeOnUnknownDelta: false },
	less_strict: { autoCommit: true, autoMerge: false, allowSelfMergeOnUnknownDelta: false },
	medium: { autoCommit: true, autoMerge: false, allowSelfMergeOnUnknownDelta: false },
	more_open: { autoCommit: true, autoMerge: true, allowSelfMergeOnUnknownDelta: false },
	fully_open: { autoCommit: true, autoMerge: true, allowSelfMergeOnUnknownDelta: true },
};

export interface AgentRulesetTierInfo {
	label: string;
	description: string;
}

/** Human-readable copy — single source of truth reused by the Settings UI. */
export const AGENT_CAPABILITY_TIER_INFO: Record<AgentCapabilityTier, AgentRulesetTierInfo> = {
	strict: { label: "100% strict", description: "No network, no web/browser, no MCP. Sandbox is fully offline." },
	less_strict: { label: "Less strict", description: "No network egress, but local MCP servers are allowed." },
	medium: {
		label: "Medium",
		description: "Domain-allowlisted egress + web research tool. No headless browser.",
	},
	more_open: {
		label: "More open",
		description: "Full internet egress, web research + headless browser, MCP on.",
	},
	fully_open: {
		label: "Fully open",
		description: "Full internet, all tools, new tools auto-enabled. Docker isolation + cloud lockdown still apply.",
	},
};

export const AGENT_DELIVERY_TIER_INFO: Record<AgentDeliveryTier, AgentRulesetTierInfo> = {
	strict: { label: "100% strict", description: "Manual commit, PR, and merge. Nothing is automated." },
	less_strict: { label: "Less strict", description: "Auto-commit to the task branch; manual PR and merge." },
	medium: { label: "Medium", description: "Auto-commit + auto-open PR; a human approves every merge." },
	more_open: {
		label: "More open",
		description:
			"Auto-merge when review approves and the regression delta is ≤0. Self-merge on unknown delta stays blocked.",
	},
	fully_open: {
		label: "Fully open",
		description: "Auto-merge on green gates, including self-merge when the regression delta is null/unknown.",
	},
};

export function capabilitiesForTier(tier: AgentCapabilityTier): AgentCapabilities {
	return CAPABILITY_MATRIX[tier];
}

export function deliveryPolicyForTier(tier: AgentDeliveryTier): AgentDeliveryPolicy {
	return DELIVERY_MATRIX[tier];
}

/** Runtime context for the egress-capability decision — the §5.L proxy's availability un-deadens `allowlist`. */
export interface SandboxEgressContext {
	/**
	 * Whether the host-side egress proxy (docs/dev/egress-proxy-design.md, §10c#18) is confirmed HEALTHY for this
	 * sandbox. Only then does `allowlist` map to the proxied internal network + un-deaden `medium`'s web tools;
	 * absent/false ⇒ `allowlist` fail-closes to no egress, byte-identical to the pre-proxy behavior.
	 */
	egressProxyAvailable?: boolean;
}

/**
 * Whether a network policy grants REAL outbound egress. Single source of truth shared by the sandbox
 * `--network` mapping and tool gating, so they can never disagree. `full` always grants egress; `allowlist`
 * grants egress ONLY when the §5.L egress proxy is confirmed available (its per-domain enforcement is what makes
 * the "allowlist" label honest) and otherwise fail-closes to none; `none` never. The optional context defaults to
 * proxy-UNavailable, so every existing single-arg caller keeps today's fail-closed behavior unchanged.
 */
export function sandboxNetworkHasEgress(policy: SandboxNetworkPolicy, context?: SandboxEgressContext): boolean {
	if (policy === "full") {
		return true;
	}
	if (policy === "allowlist") {
		return context?.egressProxyAvailable === true;
	}
	return false;
}

export interface AgentToolAccess {
	/** Web research / fetch tool. */
	webResearch: boolean;
	/** Headless browser tool. */
	headlessBrowser: boolean;
	mcp: McpAccess;
}

/**
 * Resolve which optional agent tools a capability set actually grants. Web tools are ANDed with real egress:
 * a tier may *list* a web tool, but it is only handed to the agent when the sandbox truly has outbound network,
 * so a tool can never be "enabled" while it would silently fail (or imply egress the sandbox does not provide).
 */
export function resolveAgentToolAccess(capabilities: AgentCapabilities): AgentToolAccess {
	const egress = sandboxNetworkHasEgress(capabilities.network);
	return {
		webResearch: capabilities.webResearch && egress,
		headlessBrowser: capabilities.headlessBrowser && egress,
		mcp: capabilities.mcp,
	};
}

export interface AgentRulesetConfig<Tier extends string> {
	/** Global baseline applied to every role unless overridden. */
	globalPreset: Tier;
	/** Optional per-role override of the baseline. */
	roleOverrides?: Partial<Record<AgentRulesetRole, Tier>>;
}

export type AgentCapabilityRulesetConfig = AgentRulesetConfig<AgentCapabilityTier>;
export type AgentDeliveryRulesetConfig = AgentRulesetConfig<AgentDeliveryTier>;

export interface AgentRulesetsConfig {
	capability: AgentCapabilityRulesetConfig;
	delivery: AgentDeliveryRulesetConfig;
}

export const DEFAULT_AGENT_RULESETS_CONFIG: AgentRulesetsConfig = {
	capability: { globalPreset: DEFAULT_AGENT_CAPABILITY_TIER },
	delivery: { globalPreset: DEFAULT_AGENT_DELIVERY_TIER },
};

function isAgentRulesetRole(role: string): role is AgentRulesetRole {
	return (AGENT_RULESET_ROLES as readonly string[]).includes(role);
}

function resolveTier<Tier extends string>(
	config: AgentRulesetConfig<Tier> | undefined,
	role: string,
	fallback: Tier,
): Tier {
	if (!config) {
		return fallback;
	}
	if (isAgentRulesetRole(role)) {
		const override = config.roleOverrides?.[role];
		if (override) {
			return override;
		}
	}
	return config.globalPreset ?? fallback;
}

export function resolveCapabilityTier(
	config: AgentCapabilityRulesetConfig | undefined,
	role: string,
): AgentCapabilityTier {
	return resolveTier(config, role, DEFAULT_AGENT_CAPABILITY_TIER);
}

export function resolveDeliveryTier(config: AgentDeliveryRulesetConfig | undefined, role: string): AgentDeliveryTier {
	return resolveTier(config, role, DEFAULT_AGENT_DELIVERY_TIER);
}

/** Narrower-scope delivery-tier overrides layered above the global/role resolution. Each is a full tier pick. */
export interface DeliveryTierScopeOverrides {
	/** Project-level override: applies to every card in the project unless the card overrides it. */
	projectTier?: AgentDeliveryTier | null;
	/** Card-level override: the narrowest scope, wins over project and global/role. */
	cardTier?: AgentDeliveryTier | null;
}

/**
 * Resolve the effective delivery tier with scope precedence: **card > project > (role override > global preset >
 * default)** (todo §5.L: "user can adapt in global settings and per project and per card"). Card and project
 * overrides are whole-tier picks; when both are absent the existing global/role resolution
 * ({@link resolveDeliveryTier}) applies unchanged, so a config with no scope overrides behaves exactly as before.
 */
export function resolveEffectiveDeliveryTier(
	config: AgentDeliveryRulesetConfig | undefined,
	role: string,
	overrides?: DeliveryTierScopeOverrides,
): AgentDeliveryTier {
	if (overrides?.cardTier) {
		return overrides.cardTier;
	}
	if (overrides?.projectTier) {
		return overrides.projectTier;
	}
	return resolveDeliveryTier(config, role);
}

export interface EffectiveAgentRuleset {
	role: string;
	capabilityTier: AgentCapabilityTier;
	capabilities: AgentCapabilities;
	deliveryTier: AgentDeliveryTier;
	delivery: AgentDeliveryPolicy;
}

/**
 * Resolve the effective ruleset for a role: role override (when present) wins over the global preset, which
 * wins over the built-in default. Unknown role strings fall back to the global preset / default.
 */
export function resolveEffectiveAgentRuleset(
	config: AgentRulesetsConfig | undefined,
	role: string,
): EffectiveAgentRuleset {
	const capabilityTier = resolveCapabilityTier(config?.capability, role);
	const deliveryTier = resolveDeliveryTier(config?.delivery, role);
	return {
		role,
		capabilityTier,
		capabilities: capabilitiesForTier(capabilityTier),
		deliveryTier,
		delivery: deliveryPolicyForTier(deliveryTier),
	};
}
