/**
 * Chat execution-access modes (todo §5.M) — the pure safety gate deciding whether a chat action runs, needs an
 * explicit confirmation, or is denied. The unified chat agent may touch the host, but only under the §5.M
 * invariant: host access is **never default, always typed-confirmed + audit-logged** (the autonomous swarm stays
 * Docker-isolated/no-host, invariant #2, unchanged). This module is the single source of truth for that policy,
 * kept pure so the matrix is exhaustively unit-testable; the runtime enforces the decision + logs every host action.
 */

export type ChatExecutionMode =
	/** (a) Docker-isolated; sandbox reads free, writes opt-in (to user-mounted folders), no host access. */
	| "isolated_readonly"
	/** (b) Sandbox by default; each host action is a double-confirmed escape hatch. */
	| "sandbox_with_host_escape"
	/** (c) Whole session on the host (entered behind a typed phrase); host mutations still per-action confirmed. */
	| "host";

export type ChatActionKind = "sandbox_read" | "sandbox_write" | "host_read" | "host_write" | "host_command";

export type ChatActionDecision = "allow" | "confirm" | "deny";

export const DEFAULT_CHAT_EXECUTION_MODE: ChatExecutionMode = "isolated_readonly";

export interface ChatActionAccess {
	decision: ChatActionDecision;
	reason: string;
}

const HOST_ACTIONS: ReadonlySet<ChatActionKind> = new Set(["host_read", "host_write", "host_command"]);

/**
 * Decide access for one action under the active mode. Conservative by construction: host *mutations*
 * (write/command) are never silently allowed — they always require an explicit confirmation (and are logged by
 * the caller), and any host access at all is denied in the most-isolated mode.
 */
export function decideChatActionAccess(mode: ChatExecutionMode, action: ChatActionKind): ChatActionAccess {
	const isHostAction = HOST_ACTIONS.has(action);
	const isHostMutation = action === "host_write" || action === "host_command";

	if (action === "sandbox_read") {
		return { decision: "allow", reason: "Reads inside the sandbox are always allowed." };
	}

	if (mode === "isolated_readonly") {
		if (action === "sandbox_write") {
			return {
				decision: "confirm",
				reason: "Isolated read-only mode: a sandbox write needs confirmation (opt-in, user-mounted folders only).",
			};
		}
		return { decision: "deny", reason: "Isolated read-only mode does not permit host access." };
	}

	if (action === "sandbox_write") {
		return { decision: "allow", reason: "Sandbox writes are allowed in this mode." };
	}

	// Host actions in the host-capable modes.
	if (isHostAction) {
		if (mode === "host" && action === "host_read") {
			return { decision: "allow", reason: "Host mode: host reads are allowed for the on-host session." };
		}
		return {
			decision: "confirm",
			reason: isHostMutation
				? "Host changes are never automatic — this action requires an explicit, logged confirmation."
				: "Host access requires an explicit, logged confirmation.",
		};
	}

	return { decision: "deny", reason: "Unrecognized action." };
}
