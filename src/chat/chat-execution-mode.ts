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

export type ChatActionKind =
	| "sandbox_read"
	| "sandbox_write"
	| "control_plane"
	/**
	 * A READ-ONLY network fetch (browse a URL / web search). Egress-gated exactly like any network reach (deny in
	 * isolated_readonly, confirm otherwise) and audited in full — but §5.L-distinct from a host command: it neither
	 * touches the host FS/shell nor exfiltrates, so it is NOT a protected taint sink. That lets multi-page browsing
	 * continue after a page taints the turn, while the accumulated `web` taint still guards host write/exec sinks.
	 * Its exfiltration control is the egress allowlist + SSRF guard, not the taint gate.
	 */
	| "egress_read"
	| "host_read"
	| "host_write"
	| "host_command";

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
 *
 * `control_plane` is a trusted !Klein-owned board mutation (e.g. creating a card) — it never touches the user's
 * working tree or a shell, so it needs no confirmation in the host-capable modes. In `isolated_readonly` it is
 * denied: that mode is read-only even for internal board mutations so the user retains full control.
 */
export function decideChatActionAccess(mode: ChatExecutionMode, action: ChatActionKind): ChatActionAccess {
	const isHostAction = HOST_ACTIONS.has(action);
	const isHostMutation = action === "host_write" || action === "host_command";

	if (action === "sandbox_read") {
		return { decision: "allow", reason: "Reads inside the sandbox are always allowed." };
	}

	// Network egress (incl. a read-only egress fetch) is NEVER automatic, and the most-isolated mode forbids it
	// outright — checked before the sandbox-read allow so an egress READ never slips through as a plain read.
	if (action === "egress_read") {
		return mode === "isolated_readonly"
			? { decision: "deny", reason: "Isolated read-only mode does not permit network egress." }
			: {
					decision: "confirm",
					reason: "Network egress is never automatic — it requires an explicit, logged confirmation.",
				};
	}

	if (action === "control_plane") {
		if (mode === "isolated_readonly") {
			return {
				decision: "deny",
				reason: "Isolated read-only mode does not permit board mutations.",
			};
		}
		return {
			decision: "allow",
			reason: "Control-plane board mutations are allowed — they only touch the !Klein-owned board, never the host.",
		};
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
