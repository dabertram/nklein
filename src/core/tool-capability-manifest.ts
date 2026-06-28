/**
 * Tool-capability manifest (todo §5.AF — unify the 3 drifted gating mechanisms) — PURE decision core.
 *
 * Today three separate mechanisms decide whether a tool action runs: the chat `chat-execution-mode` action-kinds, the
 * §5.L delivery rulesets, and the NKlein tool-approval policy. They've drifted. The manifest is the ONE vocabulary each
 * tool declares — `{ mutationLevel, networkLevel, fsScope, approval, replayable, auditDetail }` — and the gate becomes a
 * single pure function of `(manifest, context)`. The audit's external-action policy (network/accounts/purchases) is just
 * higher `networkLevel`/`approval` tiers on this same manifest; local-only (#1) stays enforced elsewhere.
 *
 * This is the FOUNDATION slice (substrate-first, like `retry-policy` / `durable-scheduler`): the manifest types + a gate
 * for the chat execution mode, proven by a characterization test to reproduce `decideChatActionAccess` EXACTLY across
 * every (mode × action). Subsuming the §5.L rulesets + the NKlein approval policy onto the same manifest is the next
 * slice; migrating the three call sites to this one gate is the wiring after that.
 */

import type { ChatActionDecision, ChatActionKind, ChatExecutionMode } from "../chat/chat-execution-mode";

/** What a tool action mutates, lowest→highest blast radius. */
export type ToolMutationLevel =
	/** Reads only. */
	| "read"
	/** Writes inside the Docker sandbox / workspace volume. */
	| "sandbox_write"
	/** A trusted !Klein-owned board/control-plane mutation (never the user's tree or a host shell). */
	| "control_plane"
	/** Mutates the host (host file write or host shell command). */
	| "host_write";

/** Whether the action can reach the network. (External-action policy = `egress` + a stricter `approval`.) */
export type ToolNetworkLevel = "none" | "egress";

/** Whose filesystem the action touches. */
export type ToolFsScope = "workspace" | "host";

/** How the action is gated before it runs. */
export type ToolApproval =
	/** Runs without prompting. */
	| "auto"
	/** Needs an explicit (logged) confirmation. */
	| "confirm"
	/** Needs an explicit risk-acknowledgement (riskier than a plain confirm). */
	| "risk_ack"
	/** Needs the typed host-escape phrase (whole-session host access). */
	| "typed_host";

export interface ToolCapabilityManifest {
	mutationLevel: ToolMutationLevel;
	networkLevel: ToolNetworkLevel;
	fsScope: ToolFsScope;
	/** Declared default approval tier (the gate may still tighten by context/mode). */
	approval: ToolApproval;
	/** Whether the action is deterministically replayable (no external side effects) — for §5.V replay + audit. */
	replayable: boolean;
}

/**
 * Map a chat action-kind to its capability manifest — the bridge proving the manifest vocabulary can express the chat
 * gate's inputs. (`host_command` and `host_write` are both host mutations: same manifest, decision-equivalent.)
 */
export function manifestForChatAction(action: ChatActionKind): ToolCapabilityManifest {
	switch (action) {
		case "sandbox_read":
			return {
				mutationLevel: "read",
				networkLevel: "none",
				fsScope: "workspace",
				approval: "auto",
				replayable: true,
			};
		case "sandbox_write":
			return {
				mutationLevel: "sandbox_write",
				networkLevel: "none",
				fsScope: "workspace",
				approval: "confirm",
				replayable: false,
			};
		case "control_plane":
			return {
				mutationLevel: "control_plane",
				networkLevel: "none",
				fsScope: "workspace",
				approval: "auto",
				replayable: false,
			};
		case "host_read":
			return { mutationLevel: "read", networkLevel: "none", fsScope: "host", approval: "confirm", replayable: true };
		case "host_write":
		case "host_command":
			return {
				mutationLevel: "host_write",
				networkLevel: "none",
				fsScope: "host",
				approval: "confirm",
				replayable: false,
			};
	}
}

/**
 * Decide access for a manifested action under a chat execution mode — the unified gate, derived purely from manifest
 * fields. Proven by characterization to reproduce `decideChatActionAccess(mode, action)` for every (mode × action).
 * Conservative by construction: host access is never default; the most-isolated mode denies any host reach.
 */
export function decideManifestChatAccess(
	manifest: ToolCapabilityManifest,
	mode: ChatExecutionMode,
): ToolActionDecision {
	const isHost = manifest.fsScope === "host";

	// Sandbox reads are always allowed.
	if (manifest.mutationLevel === "read" && !isHost) {
		return { decision: "allow", reason: "Reads inside the sandbox are always allowed." };
	}

	// Control-plane board mutations: allowed except in the read-only mode.
	if (manifest.mutationLevel === "control_plane") {
		return mode === "isolated_readonly"
			? { decision: "deny", reason: "Isolated read-only mode does not permit board mutations." }
			: {
					decision: "allow",
					reason:
						"Control-plane board mutations are allowed — they only touch the !Klein-owned board, never the host.",
				};
	}

	if (mode === "isolated_readonly") {
		if (manifest.mutationLevel === "sandbox_write") {
			return {
				decision: "confirm",
				reason: "Isolated read-only mode: a sandbox write needs confirmation (opt-in, user-mounted folders only).",
			};
		}
		return { decision: "deny", reason: "Isolated read-only mode does not permit host access." };
	}

	if (manifest.mutationLevel === "sandbox_write") {
		return { decision: "allow", reason: "Sandbox writes are allowed in this mode." };
	}

	// Host actions in the host-capable modes.
	if (isHost) {
		if (mode === "host" && manifest.mutationLevel === "read") {
			return { decision: "allow", reason: "Host mode: host reads are allowed for the on-host session." };
		}
		return {
			decision: "confirm",
			reason:
				manifest.mutationLevel === "host_write"
					? "Host changes are never automatic — this action requires an explicit, logged confirmation."
					: "Host access requires an explicit, logged confirmation.",
		};
	}

	return { decision: "deny", reason: "Unrecognized action." };
}

export interface ToolActionDecision {
	decision: ChatActionDecision;
	reason: string;
}
