import { chatScopeToExecutionMode } from "./chat-scope-capability";
import type { ChatSessionScope } from "./chat-session-store";

/**
 * F2.8 (§5.M) — the EXPLICIT execution posture: one derived, typed, user-legible summary of what this chat
 * session may do, computed from the SAME persisted controls the gates enforce (scope → execution mode;
 * `riskAcknowledged`; `browserEnabled`) so the composer can show the truth instead of the user inferring it
 * from scattered toggles. Derivation-only — this module changes NO enforcement; the mode gate (F1.22 golden
 * matrix), the confirm resolution, the taint broker, and the egress controls keep gating exactly as they do.
 *
 * The four postures the F2.8 contract names:
 *   - `isolated_read_only`   — chat-only/self scopes: Docker-isolated, reads only, nothing to confirm;
 *   - `sandboxed_confirming` — project scopes: sandboxed by default, each HOST action is a confirmed escape;
 *   - `host_confirming`      — host scope without the risk ack: on the host, mutations confirmed per action;
 *   - `full_risk`            — host scope WITH the session risk ack: unsafe commands auto-approve; the loudest
 *     posture, named plainly so nobody mistakes it for a safe default.
 */

export type ChatExecutionPosture = "isolated_read_only" | "sandboxed_confirming" | "host_confirming" | "full_risk";

export interface ChatPostureDescription {
	posture: ChatExecutionPosture;
	/** Short chip text for the composer. */
	label: string;
	/** One-line plain-language summary. */
	summary: string;
	/** What this session CAN do. */
	capabilities: readonly string[];
	/** What it cannot do, or what asks first. */
	boundaries: readonly string[];
	/** What changes the posture (the control the user would touch), or null at the floor. */
	escalation: string | null;
}

export function describeChatExecutionPosture(input: {
	scope: ChatSessionScope;
	riskAcknowledged: boolean;
	browserEnabled: boolean;
}): ChatPostureDescription {
	const mode = chatScopeToExecutionMode(input.scope);
	const browsing = input.browserEnabled ? "Web browsing is on (audited, allowlist-guarded)." : "Web browsing is off.";

	if (mode === "isolated_readonly") {
		return {
			posture: "isolated_read_only",
			label: "Isolated · read-only",
			summary: "Runs Docker-isolated and can only read — no writes, no host access, nothing to confirm.",
			capabilities: ["Read files inside the isolated sandbox", "Answer from the conversation and its context"],
			boundaries: ["No file writes anywhere", "No host commands", "No board mutations", browsing],
			escalation: "Switch the session scope to a project or host scope to allow actions.",
		};
	}

	if (mode === "sandbox_with_host_escape") {
		return {
			posture: "sandboxed_confirming",
			label: "Sandboxed · confirms host actions",
			summary: "Works inside the sandbox; anything touching the HOST is a per-action confirmed escape hatch.",
			capabilities: [
				"Read and write inside the sandbox",
				"Board actions (create/move cards)",
				"Safe build/test commands auto-approve",
			],
			boundaries: ["Host file writes and unsafe commands ask first", browsing],
			escalation: "Switch to the host scope (typed phrase) for whole-session host access.",
		};
	}

	if (input.riskAcknowledged) {
		return {
			posture: "full_risk",
			label: "Host · full risk acknowledged",
			summary:
				"Runs on the host and you have acknowledged the risk for this session — UNSAFE commands auto-approve.",
			capabilities: [
				"Host reads and writes",
				"Host commands INCLUDING unsafe ones, without per-action prompts",
				"Board actions",
			],
			boundaries: ["The capability broker still blocks tainted-context protected sinks when enabled", browsing],
			escalation: "Turn the risk acknowledgement off to return to per-action confirmation.",
		};
	}

	return {
		posture: "host_confirming",
		label: "Host · confirms mutations",
		summary: "Runs on the host; safe commands auto-approve, mutations and unsafe commands are confirmed per action.",
		capabilities: ["Host reads", "Safe build/test/inspection commands auto-approve", "Board actions"],
		boundaries: ["Host writes and unsafe commands ask first", browsing],
		escalation: "Acknowledge the session risk to auto-approve unsafe commands (full-risk posture).",
	};
}
