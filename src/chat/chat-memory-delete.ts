import type { MemoryDeleteControl } from "./chat-memory-projection";

/**
 * F2.9b — the delete-execution policy for the unified-memory view: map a typed {@link MemoryDeleteControl} (produced
 * by {@link ./chat-memory-projection.projectUnifiedMemory}) to the right store deletion, or REFUSE. Fail-closed by
 * construction: a `none` control (a projection of immutable substrate — ledger/skills/4-layer, or a plan step) can
 * NEVER be deleted here (`not_deletable`), and an unrecognized control kind refuses rather than guessing. Pure over
 * injected deleters so the endpoint's effects stay testable; the deleters return whether a row was actually removed.
 */

export type MemoryDeleteOutcome = "deleted" | "not_found" | "not_deletable" | "unknown_control";

export interface MemoryDeleteDeps {
	/** Remove a chat-memory entry by id; resolves true when a row was actually deleted (false if absent). */
	deleteChatMemory: (memoryId: string) => Promise<boolean>;
	/** Remove a Basic Memory note by permalink; resolves true when a note was actually deleted (false if absent). */
	deleteBasicMemoryNote: (permalink: string) => Promise<boolean>;
}

export async function executeMemoryDeleteControl(
	control: MemoryDeleteControl,
	deps: MemoryDeleteDeps,
): Promise<MemoryDeleteOutcome> {
	switch (control.kind) {
		case "chat_memory":
			return (await deps.deleteChatMemory(control.memoryId)) ? "deleted" : "not_found";
		case "basic_memory_note":
			return (await deps.deleteBasicMemoryNote(control.permalink)) ? "deleted" : "not_found";
		case "none":
			// Immutable-substrate projection or a plan step — deleting the VIEW would not delete the fact; refuse.
			return "not_deletable";
		default:
			// Forward-safety: a control kind this policy doesn't recognize refuses rather than silently no-op-deleting.
			return "unknown_control";
	}
}
