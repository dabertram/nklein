import { describe, expect, it } from "vitest";
import { assessLedgerHealth } from "../../src/core/ledger-health";

/**
 * F12.35b — the ledger-health assessment. The load-bearing output is `currentPathMatchesNoFile`: that one
 * boolean is the defect (a consumer reads empty history it cannot tell from a genuinely-empty task); the rest is
 * context. So the tests pin that it fires when the current hash is absent and does NOT when it is present.
 */

describe("assessLedgerHealth", () => {
	it("flags the current path matching NO file — the F12.35b cause", () => {
		const h = assessLedgerHealth({
			files: [{ hash: "aaa", eventCount: 5 }],
			currentPathHash: "zzz", // not present
			unknownHash: "unk",
		});
		expect(h.currentPathMatchesNoFile).toBe(true);
		expect(h.summary).toContain("matches NO ledger file");
	});

	it("does NOT flag when the current path resolves to a real file", () => {
		const h = assessLedgerHealth({
			files: [{ hash: "aaa", eventCount: 5 }],
			currentPathHash: "aaa",
			unknownHash: "unk",
		});
		expect(h.currentPathMatchesNoFile).toBe(false);
		expect(h.summary).toContain("resolves to a real file");
	});

	it("reports heavy fragmentation only above the 30% single-event threshold", () => {
		const heavy = assessLedgerHealth({
			files: [
				{ hash: "a", eventCount: 1 },
				{ hash: "b", eventCount: 1 },
				{ hash: "c", eventCount: 10 },
			],
			currentPathHash: "a",
			unknownHash: "unk",
		});
		expect(heavy.singleEventFiles).toBe(2);
		expect(heavy.summary).toContain("single event");

		// 1 single-event of 5 files = 20%, below the 30% threshold. (1/3 = 33% would trip it — the arithmetic a
		// first draft of this test got wrong, which is why the threshold case needs an explicit below-line fixture.)
		const light = assessLedgerHealth({
			files: [
				{ hash: "a", eventCount: 10 },
				{ hash: "b", eventCount: 10 },
				{ hash: "c", eventCount: 10 },
				{ hash: "d", eventCount: 10 },
				{ hash: "e", eventCount: 1 },
			],
			currentPathHash: "a",
			unknownHash: "unk",
		});
		expect(light.summary).not.toContain("single event");
	});

	it("flags the unknown sentinel only when it holds events", () => {
		expect(
			assessLedgerHealth({ files: [{ hash: "unk", eventCount: 3 }], currentPathHash: "unk", unknownHash: "unk" })
				.hasUnknownSentinel,
		).toBe(true);
		expect(
			assessLedgerHealth({ files: [{ hash: "unk", eventCount: 0 }], currentPathHash: "unk", unknownHash: "unk" })
				.hasUnknownSentinel,
		).toBe(false);
	});

	it("a clean ledger reports healthy", () => {
		const h = assessLedgerHealth({
			files: [
				{ hash: "a", eventCount: 20 },
				{ hash: "b", eventCount: 15 },
			],
			currentPathHash: "a",
			unknownHash: "unk",
		});
		expect(h.currentPathMatchesNoFile).toBe(false);
		expect(h.hasUnknownSentinel).toBe(false);
		expect(h.summary).toContain("fragmentation is low");
	});
});
