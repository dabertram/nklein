import type { RuntimeAgentId } from "./api-contract";

export interface RuntimeAgentCatalogEntry {
	id: RuntimeAgentId;
	label: string;
	binary: string;
	baseArgs: string[];
	autonomousArgs: string[];
	installUrl: string;
}

// P0.9c (legacy §2.B): the catalog is nklein-only. The terminal-CLI agents (claude/codex/gemini/opencode/droid/kiro)
// were removed together with `runtimeAgentIdSchema`'s legacy ids — persisted boards/sessions/config from pre-lockdown
// builds are MIGRATED at parse time (the schema catches unknown ids to "nklein"), so the entries are no longer needed
// to keep old state loadable.
export const RUNTIME_AGENT_CATALOG: RuntimeAgentCatalogEntry[] = [
	{
		id: "nklein",
		label: "!Klein",
		binary: "nklein",
		baseArgs: [],
		autonomousArgs: ["--auto-approve-all"],
		installUrl: "https://github.com/dabertram/nklein",
	},
];

// Local-only / nklein-only (todo §5.A): the native NKlein agent is the sole launch-supported runtime agent;
// terminal/CLI agents stay permanently disabled under the lockdown.
export const RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS: readonly RuntimeAgentId[] = ["nklein"];

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
