import { classifyCommandSafety } from "./chat-command-safety";

export interface ChatToolConfirmationInput {
	name: string;
	command?: unknown;
	riskAcknowledged?: boolean;
	browserEnabled?: boolean;
	sandboxWriteApproved?: boolean;
}

/**
 * The three-tier verdict for a gated chat tool call:
 *  - `allow`   — auto-approves (a pre-authorized action).
 *  - `confirm` — needs the OPERATOR's per-action OK (F2.2b/F2.12b): the action is legitimate but not pre-authorized,
 *    so it parks on the host-action confirm queue and awaits an approve/deny instead of being auto-denied.
 *  - `deny`    — refused outright (no operator prompt applies).
 */
export type ChatToolConfirmationVerdict = "allow" | "confirm" | "deny";

/**
 * §5.M G3b/G6 confirm gate (extracted from the chat-agent tool-deps resolver so the SECURITY decision is pinned by a
 * unit test, not buried in an async closure). Three-tier so the F2.2b/F2.12b confirm dialog can ASK the operator
 * for the not-pre-authorized-but-legitimate actions instead of auto-denying them:
 *  - `run_command`: a command the allowlist classifier deems SAFE (build/test/inspection) auto-approves; an UNSAFE
 *    one is pre-authorized only by the session's `riskAcknowledged` — otherwise it's a `confirm` (ask the operator).
 *    A non-string command is denied.
 *  - `browse_url` / `web_search`: the read-only egress tools, gated by the explicit per-session `browserEnabled`
 *    opt-in (that toggle IS the consent) — allowed with it, denied without (the toggle, not a per-action prompt, is
 *    the mechanism).
 *  - `write_file`: a Docker-sandbox write auto-approves only when the target is under the session's approved writable
 *    mounts; otherwise it's a `confirm` (ask the operator). The tool still enforces the same predicate at execution.
 *  - anything else: denied.
 */
export function classifyChatToolConfirmation(input: ChatToolConfirmationInput): ChatToolConfirmationVerdict {
	if (input.name === "run_command" && typeof input.command === "string") {
		if (classifyCommandSafety(input.command).safety === "safe") {
			return "allow";
		}
		return input.riskAcknowledged === true ? "allow" : "confirm";
	}
	if (input.name === "browse_url" || input.name === "web_search") {
		return input.browserEnabled === true ? "allow" : "deny";
	}
	if (input.name === "write_file") {
		return input.sandboxWriteApproved === true ? "allow" : "confirm";
	}
	return "deny";
}

/**
 * The boolean AUTO-approval gate: true ONLY for the `allow` tier. `confirm` and `deny` both block here — until the
 * confirm-dialog round-trip (F2.2b/F2.12b) parks a `confirm` on the host-action queue and awaits the operator, a
 * `confirm` is treated exactly as the pre-round-trip behavior (blocked), so this stays byte-identical.
 */
export function resolveChatToolConfirmation(input: ChatToolConfirmationInput): boolean {
	return classifyChatToolConfirmation(input) === "allow";
}
