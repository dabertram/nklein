/**
 * Derive the F4.23 containment inputs exclusively from trusted workspace configuration and the runtime's concrete
 * Docker tool surface. API callers choose a role, but cannot submit their own tools, network tier, or credential state.
 */

import type { RuntimeConfigState } from "../config/runtime-config";
import { type AgentRulesetRole, resolveEffectiveAgentRuleset } from "../core/agent-rulesets";
import { swarmToolManifest } from "../core/swarm-tool-capability";
import { KANBAN_TOOL_MANIFESTS } from "../core/tool-capability-manifest";
import { allowlistForRoleFromScoped, parseRoleScopedEgressAllowlist } from "../nklein-agent/egress-proxy-role-snapshot";
import type { CommunitySkillExecutionEnvironment } from "./community-skill-execution-service";

const DOCKER_TOOL_NAMES = [
	...Object.keys(KANBAN_TOOL_MANIFESTS),
	"repo_map",
	"search_code",
	"search_codebase",
] as const;
const EGRESS_TOOL_NAMES = ["web_search", "browse_url", "fetch_web_content"] as const;

export function buildCommunitySkillExecutionEnvironment(
	config: RuntimeConfigState,
	role: AgentRulesetRole,
): CommunitySkillExecutionEnvironment {
	const ruleset = resolveEffectiveAgentRuleset(config.effectiveAgentRulesets, role);
	const allowlist = allowlistForRoleFromScoped(parseRoleScopedEgressAllowlist(config.sandboxEgressAllowlist))(role);
	const taskScopedEgressIdentity =
		ruleset.capabilities.network !== "none" && config.sandboxEgressProxyEnabled && allowlist.length > 0;
	const names = [
		...DOCKER_TOOL_NAMES,
		...(ruleset.capabilities.webResearch && taskScopedEgressIdentity ? EGRESS_TOOL_NAMES : []),
	];
	const availableTools = [...new Set(names)].flatMap((name) => {
		const manifest = swarmToolManifest(name);
		return manifest ? [{ name, manifest }] : [];
	});
	return {
		availableTools,
		requestedNetworkPolicy: ruleset.capabilities.network,
		dockerSandbox: true,
		sensitiveAccess: false,
		ambientCredentialNames: [],
		taskScopedEgressIdentity,
	};
}
