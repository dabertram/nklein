import { classifyCommandSafety } from "./chat-command-safety";

/**
 * §5.M G3b/G6 confirm gate (extracted from the chat-agent tool-deps resolver so the SECURITY decision is pinned by a
 * unit test, not buried in an async closure): decide whether a gated chat tool call auto-approves.
 *  - `run_command`: a command the allowlist classifier deems SAFE (build/test/inspection) auto-approves; an UNSAFE one
 *    runs ONLY when the session has acknowledged the risk (`riskAcknowledged`). A non-string command never runs here.
 *  - `browse_url`: gated by the explicit per-session `browserEnabled` opt-in (that toggle IS the consent).
 *  - anything else: denied (no web-ui confirm dialog yet).
 */
export function resolveChatToolConfirmation(input: {
	name: string;
	command?: unknown;
	riskAcknowledged?: boolean;
	browserEnabled?: boolean;
}): boolean {
	if (input.name === "run_command" && typeof input.command === "string") {
		if (classifyCommandSafety(input.command).safety === "safe") {
			return true;
		}
		return input.riskAcknowledged === true;
	}
	if (input.name === "browse_url") {
		return input.browserEnabled === true;
	}
	return false;
}
