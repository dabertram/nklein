import { describe, expect, it, vi } from "vitest";
import { executeMemoryDeleteControl, type MemoryDeleteDeps } from "./chat-memory-delete";

function deps(overrides: Partial<MemoryDeleteDeps> = {}): MemoryDeleteDeps {
	return {
		deleteChatMemory: vi.fn(async () => true),
		deleteBasicMemoryNote: vi.fn(async () => true),
		...overrides,
	};
}

describe("executeMemoryDeleteControl (F2.9b unified-memory delete policy)", () => {
	it("chat_memory → deletes by id; 'deleted' when a row was removed, 'not_found' otherwise", async () => {
		const d = deps();
		expect(await executeMemoryDeleteControl({ kind: "chat_memory", memoryId: "m1" }, d)).toBe("deleted");
		expect(d.deleteChatMemory).toHaveBeenCalledWith("m1");

		const missing = deps({ deleteChatMemory: vi.fn(async () => false) });
		expect(await executeMemoryDeleteControl({ kind: "chat_memory", memoryId: "gone" }, missing)).toBe("not_found");
	});

	it("basic_memory_note → deletes by permalink", async () => {
		const d = deps();
		expect(await executeMemoryDeleteControl({ kind: "basic_memory_note", permalink: "notes/x" }, d)).toBe("deleted");
		expect(d.deleteBasicMemoryNote).toHaveBeenCalledWith("notes/x");
		// The other deleter is never touched.
		expect(d.deleteChatMemory).not.toHaveBeenCalled();
	});

	it("a 'none' control (immutable projection / plan step) is REFUSED — never calls a deleter", async () => {
		const d = deps();
		expect(await executeMemoryDeleteControl({ kind: "none", reason: "projection of the ledger" }, d)).toBe(
			"not_deletable",
		);
		expect(d.deleteChatMemory).not.toHaveBeenCalled();
		expect(d.deleteBasicMemoryNote).not.toHaveBeenCalled();
	});

	it("an unrecognized control kind refuses rather than guessing", async () => {
		const d = deps();
		expect(await executeMemoryDeleteControl({ kind: "totally-new" } as never, d)).toBe("unknown_control");
		expect(d.deleteChatMemory).not.toHaveBeenCalled();
		expect(d.deleteBasicMemoryNote).not.toHaveBeenCalled();
	});
});
