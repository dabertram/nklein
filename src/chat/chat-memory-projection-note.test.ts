import { describe, expect, it } from "vitest";
import { buildUnifiedMemoryNote, type UnifiedMemoryRecord } from "./chat-memory-projection";

function record(source: UnifiedMemoryRecord["source"], text: string): UnifiedMemoryRecord {
	return {
		source,
		id: `${source}:${text}`,
		text,
		salience: 1,
		provenance: "why",
		deleteControl: { kind: "none", reason: "x" },
	};
}

describe("buildUnifiedMemoryNote (F2.9b unified-recall turn feed)", () => {
	it("empty band → null (adds nothing = byte-identical to no note)", () => {
		expect(buildUnifiedMemoryNote([])).toBeNull();
	});

	it("renders one source-tagged line per record under a single leading note", () => {
		const note = buildUnifiedMemoryNote([
			record("session", "the user prefers dark mode"),
			record("focus_chain", "implement the parser"),
		]);
		expect(note).not.toBeNull();
		expect(note).toContain("Relevant memory recalled for this turn");
		expect(note).toContain("(session) the user prefers dark mode");
		expect(note).toContain("(focus_chain) implement the parser");
	});
});
