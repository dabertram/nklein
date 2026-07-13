import { DEFAULT_CAPABILITY_GRANT_TTL_MS, scopeKeyForChatCall } from "../core/capability-grants";
import { manifestForChatAction } from "../core/tool-capability-manifest";
import type { ChatActionDecision, ChatActionKind } from "./chat-execution-mode";
import type { ChatHostActionAuditEntry } from "./chat-host-action-audit-store";

/**
 * F2.12 (§5.M/§5.Y) — the TYPED confirmation description + the filterable audit projection. A confirmation
 * prompt must name exactly what is being decided: the ACTION (what kind of thing), the TARGET (the exact
 * command/path/host — the same least-scope identity the F2.2 grant records), the SCOPE (where it acts: sandbox
 * vs host vs network, from the action's capability manifest), the CONSEQUENCE (what happens if approved), and
 * the DURATION (how long an approval sticks — the grant TTL). Secret-safety of the history is already enforced
 * upstream (`chat-audit-detail.ts` masks secret-bearing values before anything is persisted); this module adds
 * the missing filterable read over those safe records. Pure + total.
 */

export interface HostActionConfirmationDescription {
	/** What kind of action (human phrasing of the action kind). */
	action: string;
	/** The exact thing approved — the F2.2 least-scope identity (command string / path / host). */
	target: string;
	/** Where it acts (sandbox / host / network), from the capability manifest. */
	scope: string;
	/** What approving actually does. */
	consequence: string;
	/** How long the approval sticks (the grant TTL), human-phrased. */
	duration: string;
	/** One-line headline for the dialog title. */
	headline: string;
}

const ACTION_PHRASES: Record<ChatActionKind, { action: string; consequence: string }> = {
	sandbox_read: { action: "Read inside the sandbox", consequence: "Reads a file inside the isolated sandbox." },
	sandbox_write: { action: "Write inside the sandbox", consequence: "Writes a file inside the isolated sandbox." },
	control_plane: { action: "Board action", consequence: "Mutates board state (cards/columns)." },
	egress_read: {
		action: "Network fetch",
		consequence: "Reads from the network (audited; the egress allowlist and SSRF guard still apply).",
	},
	host_read: { action: "Host read", consequence: "Reads a file on YOUR machine." },
	host_write: { action: "Host write", consequence: "Writes a file on YOUR machine." },
	host_command: { action: "Host command", consequence: "Runs a shell command on YOUR machine." },
};

function formatTtl(ttlMs: number): string {
	const minutes = Math.round(ttlMs / 60_000);
	return minutes <= 1 ? "this action only (about a minute)" : `${minutes} minutes for this exact target`;
}

/**
 * Describe a confirm-gated call for the dialog. The TARGET is derived from the same scope key the grant will
 * record, so what the user reads is byte-for-byte what a later covered retry reuses — no gap between the prompt
 * and the permission.
 */
export function describeHostActionConfirmation(input: {
	toolName: string;
	actionKind: ChatActionKind;
	args: Record<string, unknown>;
	grantTtlMs?: number;
}): HostActionConfirmationDescription {
	const phrases = ACTION_PHRASES[input.actionKind];
	const scopeKey = scopeKeyForChatCall(input.actionKind, input.toolName, input.args);
	const target = scopeKey.slice(scopeKey.indexOf(":") + 1);
	const manifest = manifestForChatAction(input.actionKind);
	const scope =
		manifest.fsScope === "host"
			? "your host machine"
			: manifest.networkLevel === "egress_read"
				? "the network (outbound read)"
				: "the isolated sandbox";
	const duration = formatTtl(input.grantTtlMs ?? DEFAULT_CAPABILITY_GRANT_TTL_MS);
	return {
		action: phrases.action,
		target,
		scope,
		consequence: phrases.consequence,
		duration,
		headline: `${phrases.action}: ${target}`,
	};
}

export interface ChatHostActionAuditFilter {
	action?: ChatActionKind;
	decision?: ChatActionDecision;
	/** Only entries recorded at/after this epoch ms. */
	sinceMs?: number;
	/** Case-insensitive substring over the (already secret-safe) detail. */
	contains?: string;
	/** Only executed (or only not-executed) entries when set. */
	executed?: boolean;
}

/** The filterable history read (newest first). Pure — the caller supplies the store's entries. */
export function filterChatHostActionAudit(
	entries: readonly ChatHostActionAuditEntry[],
	filter: ChatHostActionAuditFilter = {},
): ChatHostActionAuditEntry[] {
	const needle = filter.contains?.trim().toLowerCase() ?? "";
	return entries
		.filter((entry) => {
			if (filter.action !== undefined && entry.action !== filter.action) {
				return false;
			}
			if (filter.decision !== undefined && entry.decision !== filter.decision) {
				return false;
			}
			if (filter.sinceMs !== undefined && entry.recordedAt < filter.sinceMs) {
				return false;
			}
			if (filter.executed !== undefined && entry.executed !== filter.executed) {
				return false;
			}
			if (needle && !(entry.detail ?? "").toLowerCase().includes(needle)) {
				return false;
			}
			return true;
		})
		.sort((left, right) => right.recordedAt - left.recordedAt);
}
