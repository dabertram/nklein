/**
 * Focus-chain re-anchoring rail (todo §5.N).
 *
 * An agent authors a focus chain (its ordered plan-of-attack checklist) via `update_focus_chain`, but on a long
 * run — especially for a small model — the only trace of that plan in the conversation is the tool call/result,
 * which context compaction can drop. This rail re-projects the *current* chain into each model request so the
 * agent stays anchored to its own plan. Kept in a standalone module (pure, no SDK-host imports) so the
 * re-anchoring logic is unit-testable without booting the session runtime.
 */

import type { AgentMessage } from "@nklein/shared";
import { type FocusChain, formatFocusChainForPrompt } from "../core/focus-chain";

/** Marks a message as the injected focus-chain rail so it can be replaced (never stacked) each turn. */
export const FOCUS_CHAIN_RAIL_KIND = "kanban_focus_chain_rail";

export function createFocusChainRailMessage(chain: FocusChain): AgentMessage {
	return {
		id: `kanban-focus-chain-rail-${Date.now()}`,
		role: "user",
		content: [
			{
				type: "text",
				text: [
					"[!Klein focus chain: your own plan for this task — keep working through it, do not restart it]",
					formatFocusChainForPrompt(chain),
				].join("\n"),
			},
		],
		createdAt: Date.now(),
		metadata: { kind: FOCUS_CHAIN_RAIL_KIND },
	};
}

/**
 * Re-anchor the current focus chain into the request: strip any stale focus-chain rail (so it never stacks or
 * goes out of date) and prepend the latest one. Returns the same array reference when there is nothing to do
 * (no chain and no stale rail), so callers can cheaply detect a no-op.
 */
export function reanchorFocusChainMessages(
	messages: readonly AgentMessage[],
	chain: FocusChain | null,
): readonly AgentMessage[] {
	const hasStaleRail = messages.some((message) => message.metadata?.kind === FOCUS_CHAIN_RAIL_KIND);
	const hasChain = Boolean(chain && chain.steps.length > 0);
	if (!hasStaleRail && !hasChain) {
		return messages;
	}
	const withoutStale = hasStaleRail
		? messages.filter((message) => message.metadata?.kind !== FOCUS_CHAIN_RAIL_KIND)
		: messages;
	return hasChain && chain ? [createFocusChainRailMessage(chain), ...withoutStale] : withoutStale;
}
