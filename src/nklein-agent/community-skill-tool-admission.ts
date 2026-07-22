/**
 * F4.26 defense-in-depth narrowing for a session carrying approved third-party skill guidance.
 *
 * The activation ticket is the authority. Prompt text cannot grant a tool: every runtime surface is intersected with
 * the ticket's effective tool set, including SDK built-ins whose executor keys differ from their user-visible names.
 */

import type { ToolExecutors } from "@cline/sdk";
import type { AgentTool } from "./sdk-agent-types";

const EXECUTOR_GRANTS: Readonly<Partial<Record<keyof ToolExecutors, readonly string[]>>> = {
	bash: ["run_commands"],
	readFile: ["read_files", "read_large_file"],
	search: ["find_files", "search_code", "search_codebase"],
	editor: ["editor"],
	applyPatch: ["apply_patch"],
	webFetch: ["browse_url", "fetch_web_content"],
};

function allowedSet(effectiveTools: readonly string[]): Set<string> {
	return new Set(effectiveTools);
}

export function isCommunitySkillToolAllowed(toolName: string, effectiveTools: readonly string[]): boolean {
	return allowedSet(effectiveTools).has(toolName);
}

export function restrictCommunitySkillToolPolicies<TValue extends { enabled?: boolean; autoApprove?: boolean }>(
	policies: Readonly<Record<string, TValue>>,
	effectiveTools: readonly string[],
): Record<string, TValue> {
	const allowed = allowedSet(effectiveTools);
	const narrowed = Object.fromEntries(
		Object.entries(policies).map(([name, policy]) => [
			name,
			allowed.has(name)
				? { ...policy, enabled: policy.enabled !== false, autoApprove: false }
				: { ...policy, enabled: false, autoApprove: false },
		]),
	) as Record<string, TValue>;
	// The SDK builds standard tools from host defaults and treats a missing policy as enabled. Wildcard-deny is the
	// authority; exact grants override it, including tools absent from !Klein's custom policy map.
	narrowed["*"] = { ...(policies["*"] ?? {}), enabled: false, autoApprove: false } as TValue;
	for (const name of allowed) {
		const policy = policies[name];
		narrowed[name] = {
			...(policy ?? {}),
			enabled: policies["*"]?.enabled !== false && policy?.enabled !== false,
			autoApprove: false,
		} as TValue;
	}
	return narrowed;
}

export function restrictCommunitySkillToolExecutors(
	executors: Partial<ToolExecutors> | undefined,
	effectiveTools: readonly string[],
): Partial<ToolExecutors> {
	const allowed = allowedSet(effectiveTools);
	const narrowed: Partial<ToolExecutors> = {};
	for (const [key, grants] of Object.entries(EXECUTOR_GRANTS) as [keyof ToolExecutors, readonly string[]][]) {
		const executor = executors?.[key];
		const admitted = grants.some((grant) => allowed.has(grant));
		const implementation =
			admitted && executor
				? executor
				: async () => `Community-skill activation denied or could not sandbox executor '${String(key)}'.`;
		// All SDK default executor keys must be overridden. It merges partial overrides over HOST defaults, so omission
		// is not denial and can silently resurrect the host shell.
		Object.assign(narrowed, { [key]: implementation });
	}
	return narrowed;
}

export function restrictCommunitySkillExtraTools(
	tools: readonly AgentTool[] | undefined,
	effectiveTools: readonly string[],
): AgentTool[] | undefined {
	if (!tools) return undefined;
	const allowed = allowedSet(effectiveTools);
	return tools.filter((tool) => allowed.has(tool.name));
}
