import { classifyCommandSafety } from "./chat-command-safety";

/**
 * §5.M G3b/G6 confirm gate (extracted from the chat-agent tool-deps resolver so the SECURITY decision is pinned by a
 * unit test, not buried in an async closure): decide whether a gated chat tool call auto-approves.
 *  - `run_command`: a command the allowlist classifier deems SAFE (build/test/inspection) auto-approves; an UNSAFE one
 *    runs ONLY when the session has acknowledged the risk (`riskAcknowledged`). A non-string command never runs here.
 *  - `browse_url` / `web_search`: the read-only egress tools, gated by the explicit per-session `browserEnabled`
 *    opt-in (that toggle IS the consent; web_search is additionally offered only when egress + a backend are set).
 *  - `write_file`: Docker-sandbox writes only auto-confirm when the runtime already proved the target is under the
 *    session's explicitly-approved writable mount list. The tool still enforces the same predicate at execution time.
 *  - anything else: denied (no web-ui confirm dialog yet).
 */
export function resolveChatToolConfirmation(input: {
	name: string;
	command?: unknown;
	riskAcknowledged?: boolean;
	browserEnabled?: boolean;
	sandboxWriteApproved?: boolean;
}): boolean {
	if (input.name === "run_command" && typeof input.command === "string") {
		if (classifyCommandSafety(input.command).safety === "safe") {
			return true;
		}
		return input.riskAcknowledged === true;
	}
	if (input.name === "browse_url" || input.name === "web_search") {
		return input.browserEnabled === true;
	}
	if (input.name === "write_file") {
		return input.sandboxWriteApproved === true;
	}
	return false;
}
