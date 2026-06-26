import { getRuntimeAgentCatalogEntry } from "@runtime-agent-catalog";
import type { RuntimeAgentId } from "@/runtime/types";

/**
 * Agent-command display helpers for the Settings dialog (§5.X #2 / settings-dialog decomposition), extracted from the
 * oversized `runtime-settings-dialog.tsx`. Builds the human-readable launch command shown for each non-!Klein agent,
 * shell-quoting only the args that need it. Pure, self-contained: no React/state.
 */

export function quoteCommandPartForDisplay(part: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(part)) {
		return part;
	}
	return JSON.stringify(part);
}

export function buildDisplayedAgentCommand(
	agentId: RuntimeAgentId,
	binary: string,
	autonomousModeEnabled: boolean,
): string {
	if (agentId === "nklein") {
		return "";
	}
	const args = autonomousModeEnabled ? (getRuntimeAgentCatalogEntry(agentId)?.autonomousArgs ?? []) : [];
	return [binary, ...args.map(quoteCommandPartForDisplay)].join(" ");
}
