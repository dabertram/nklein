import { describe, expect, it } from "vitest";
import {
	projectUnifiedMemory,
	selectMemoryBand,
	type UnifiedMemoryRecord,
} from "../../../src/chat/chat-memory-projection";

/**
 * F2.9 — the unified memory projection: every source flattened with provenance + a TYPED delete control
 * (deletable exactly where deletion is real), and the bounded band with per-source floors.
 */

describe("projectUnifiedMemory", () => {
	it("carries provenance and the correct delete control per source", () => {
		const records = projectUnifiedMemory({
			sessionMemories: [{ id: "m1", text: "prefers tabs", score: 0.9, shared: false }],
			layerRecords: [
				{
					layer: "semantic",
					id: "fact-1",
					text: "qwen3-8b is reliable at worker tool-use",
					recordedAt: null,
					salience: 0.7,
					provenance: "ledger fitness projection",
				},
			],
			basicMemoryNotes: [{ permalink: "gotchas/nul-bytes", title: "NUL bytes", excerpt: "…", score: 0.8 }],
			focusChainSteps: [
				{ step: "write tests", status: "done" },
				{ step: "wire the projection", status: "in_progress" },
			],
		});

		const session = records.find((record) => record.source === "session");
		expect(session?.deleteControl).toEqual({ kind: "chat_memory", memoryId: "m1" });

		const semantic = records.find((record) => record.source === "semantic");
		expect(semantic?.deleteControl.kind).toBe("none"); // projections of immutable evidence
		expect(semantic?.provenance).toContain("ledger");

		const basic = records.find((record) => record.source === "basic_memory");
		expect(basic?.deleteControl).toEqual({ kind: "basic_memory_note", permalink: "gotchas/nul-bytes" });

		const focus = records.find((record) => record.source === "focus_chain");
		expect(focus?.text).toContain("wire the projection"); // only the ACTIVE step projects
		expect(focus?.deleteControl.kind).toBe("none");
	});

	it("projects nothing from empty inputs", () => {
		expect(projectUnifiedMemory({})).toEqual([]);
		expect(projectUnifiedMemory({ focusChainSteps: [{ step: "x", status: "done" }] })).toEqual([]);
	});
});

describe("selectMemoryBand", () => {
	function record(source: UnifiedMemoryRecord["source"], id: string, salience: number): UnifiedMemoryRecord {
		return {
			source,
			id: `${source}:${id}`,
			text: id,
			salience,
			provenance: source,
			deleteControl: { kind: "none", reason: "test" },
		};
	}

	it("per-source floors stop a chatty source from crowding out the rest", () => {
		const chatty = Array.from({ length: 10 }, (_, index) => record("session", `s${index}`, 0.9));
		const quiet = [record("basic_memory", "note", 0.2), record("semantic", "fact", 0.1)];
		const band = selectMemoryBand([...chatty, ...quiet], { maxRecords: 6, perSourceFloor: 1 });
		expect(band.some((entry) => entry.source === "basic_memory")).toBe(true);
		expect(band.some((entry) => entry.source === "semantic")).toBe(true);
		expect(band.filter((entry) => entry.source === "session").length).toBe(4); // the free slots
		expect(band).toHaveLength(6);
	});

	it("is deterministic: salience desc, id asc, bounded", () => {
		const band = selectMemoryBand(
			[record("session", "b", 0.5), record("session", "a", 0.5), record("session", "c", 0.9)],
			{ maxRecords: 2, perSourceFloor: 0 },
		);
		expect(band.map((entry) => entry.id)).toEqual(["session:c", "session:a"]);
	});
});
