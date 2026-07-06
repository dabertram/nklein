import type { RuntimeAgentId } from "./api-contract";

export interface RuntimeAgentCatalogEntry {
	id: RuntimeAgentId;
	label: string;
	binary: string;
	baseArgs: string[];
	autonomousArgs: string[];
	installUrl: string;
}

export const RUNTIME_AGENT_CATALOG: RuntimeAgentCatalogEntry[] = [
	{
		id: "claude",
		label: "Claude Code",
		binary: "claude",
		baseArgs: [],
		autonomousArgs: ["--dangerously-skip-permissions"],
		installUrl: "https://docs.anthropic.com/en/docs/claude-code/quickstart",
	},
	{
		id: "codex",
		label: "OpenAI Codex",
		binary: "codex",
		baseArgs: [],
		autonomousArgs: ["--dangerously-bypass-approvals-and-sandbox"],
		installUrl: "https://github.com/openai/codex",
	},
	{
		id: "nklein",
		label: "!Klein",
		binary: "nklein",
		baseArgs: [],
		autonomousArgs: ["--auto-approve-all"],
		installUrl: "https://github.com/dabertram/nklein",
	},
	{
		id: "opencode",
		label: "OpenCode",
		binary: "opencode",
		baseArgs: [],
		autonomousArgs: [],
		installUrl: "https://github.com/sst/opencode",
	},
	{
		id: "droid",
		label: "Factory Droid",
		binary: "droid",
		baseArgs: [],
		autonomousArgs: ["--auto", "high"],
		installUrl: "https://docs.factory.ai/cli/getting-started/quickstart",
	},
	{
		id: "kiro",
		label: "Kiro",
		binary: "kiro-cli",
		baseArgs: ["chat"],
		autonomousArgs: ["--trust-all-tools"],
		installUrl: "https://kiro.dev",
	},
	{
		id: "gemini",
		label: "Gemini CLI",
		binary: "gemini",
		baseArgs: [],
		autonomousArgs: ["--yolo"],
		installUrl: "https://github.com/google-gemini/gemini-cli",
	},
];

// Local-only / nklein-only (todo §5.A): the native NKlein agent is the sole launch-supported runtime agent;
// terminal/CLI agents stay permanently disabled under the lockdown. The catalog entries below remain only for
// the legacy terminal integration that a later §5.A increment removes — they are not launchable.
export const RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS: readonly RuntimeAgentId[] = [
	"nklein",
	// Terminal/CLI agents are disabled under the local-only lockdown (§5.A); do not re-enable for launch:
	// "claude",
	// "codex",
	// "droid",
	// "kiro",
	// "opencode",
	// "gemini",
];

const RUNTIME_LAUNCH_SUPPORTED_AGENT_ID_SET = new Set<RuntimeAgentId>(RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS);

export function isRuntimeAgentLaunchSupported(agentId: RuntimeAgentId): boolean {
	return RUNTIME_LAUNCH_SUPPORTED_AGENT_ID_SET.has(agentId);
}

export function getRuntimeLaunchSupportedAgentCatalog(): RuntimeAgentCatalogEntry[] {
	return RUNTIME_AGENT_CATALOG.filter((entry) => isRuntimeAgentLaunchSupported(entry.id));
}

export function getRuntimeAgentCatalogEntry(agentId: RuntimeAgentId): RuntimeAgentCatalogEntry | null {
	return RUNTIME_AGENT_CATALOG.find((entry) => entry.id === agentId) ?? null;
}

/**
 * THE single boundary predicate for the legacy host-worktree subsystem.
 *
 * Only explicit non-NKlein terminal/CLI agents (Codex/Claude/etc.) use host task worktrees. The default
 * NKlein / sandboxed agent path never creates a host worktree — its work lives in the Docker sandbox volume
 * and is captured as a `nklein/tasks/<task>` result branch. Under the LOCAL-ONLY lockdown every agent id is
 * clamped to `nklein`, so for all *reachable* tasks this returns false and **no host worktree is ever created
 * on a new task start**. The remaining host-worktree code paths are read-only legacy compatibility for any
 * pre-existing worktree-backed tasks. Any code deciding "should I touch a host task worktree?" must call this
 * predicate rather than re-deriving the boundary (see plan.md §2.B — host worktree retirement).
 */
export function usesLegacyHostTaskWorkspace(agentId: RuntimeAgentId | null | undefined): boolean {
	return agentId !== undefined && agentId !== null && agentId !== "nklein";
}
