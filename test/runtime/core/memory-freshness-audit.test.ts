import { describe, expect, it } from "vitest";
import {
	type AuditableMemoryNote,
	auditMemoryFreshness,
	type MemoryFreshnessAuditConfig,
	shouldRunFreshnessAudit,
} from "../../../src/core/memory-freshness-audit";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;
const CONFIG: MemoryFreshnessAuditConfig = { stalenessThresholdMs: 30 * DAY, cadenceMs: 7 * DAY };

function note(over: Partial<AuditableMemoryNote> & { id: string }): AuditableMemoryNote {
	return { title: over.id, updatedAt: NOW, links: [], ...over };
}

describe("auditMemoryFreshness (F5.2 structural memory audit)", () => {
	it("flags a STALE note (older than the staleness threshold)", () => {
		const result = auditMemoryFreshness(
			[
				note({ id: "fresh", updatedAt: NOW - 5 * DAY, links: ["fresh"] }),
				note({ id: "old", updatedAt: NOW - 40 * DAY, links: ["old"] }),
			],
			CONFIG,
			NOW,
		);
		const stale = result.findings.filter((f) => f.kind === "stale");
		expect(stale.map((f) => f.noteId)).toEqual(["old"]);
		expect(result.summary.stale).toBe(1);
	});

	it("flags an ORPHANED note (no incoming or outgoing links)", () => {
		const result = auditMemoryFreshness(
			[
				note({ id: "a", links: ["b"] }), // links to b → b has incoming
				note({ id: "b", links: ["a"] }),
				note({ id: "island", links: [] }), // no in/out → orphaned
			],
			CONFIG,
			NOW,
		);
		expect(result.findings.filter((f) => f.kind === "orphaned").map((f) => f.noteId)).toEqual(["island"]);
	});

	it("does NOT orphan a note that has incoming links but no outgoing", () => {
		const result = auditMemoryFreshness(
			[note({ id: "hub", links: ["leaf"] }), note({ id: "leaf", links: [] })],
			CONFIG,
			NOW,
		);
		// leaf has an incoming link from hub → not orphaned. hub has an outgoing link → not orphaned.
		expect(result.findings.filter((f) => f.kind === "orphaned")).toEqual([]);
	});

	it("flags a BROKEN_LINK (outgoing target with no matching note)", () => {
		const result = auditMemoryFreshness(
			[note({ id: "src", links: ["does-not-exist", "real"] }), note({ id: "real", links: ["src"] })],
			CONFIG,
			NOW,
		);
		const broken = result.findings.filter((f) => f.kind === "broken_link");
		expect(broken).toHaveLength(1);
		expect(broken[0]?.detail).toContain("does-not-exist");
	});

	it("resolves links by TITLE as well as id (an authored [[Some Title]] is not broken)", () => {
		const result = auditMemoryFreshness(
			[
				note({ id: "n1", title: "Alpha Note", links: ["Beta Note"] }),
				note({ id: "n2", title: "Beta Note", links: ["Alpha Note"] }),
			],
			CONFIG,
			NOW,
		);
		expect(result.findings.filter((f) => f.kind === "broken_link")).toEqual([]);
	});

	it("flags DUPLICATE_TITLE (same normalized title on ≥2 notes) for each participant", () => {
		const result = auditMemoryFreshness(
			[
				note({ id: "x", title: "Deploy Guide", links: ["x"] }),
				note({ id: "y", title: "deploy  guide", links: ["y"] }),
			],
			CONFIG,
			NOW,
		);
		expect(
			result.findings
				.filter((f) => f.kind === "duplicate_title")
				.map((f) => f.noteId)
				.sort(),
		).toEqual(["x", "y"]);
	});

	it("returns a per-kind summary + nextAuditAt from the cadence", () => {
		const result = auditMemoryFreshness([note({ id: "solo", links: [] })], CONFIG, NOW);
		expect(result.notesAudited).toBe(1);
		expect(result.summary).toEqual({ stale: 0, orphaned: 1, broken_link: 0, duplicate_title: 0 });
		expect(result.nextAuditAt).toBe(NOW + 7 * DAY);
		expect(result.auditedAt).toBe(NOW);
	});

	it("shouldRunFreshnessAudit gates on the cadence (never-run runs; within cadence waits)", () => {
		expect(shouldRunFreshnessAudit(null, CONFIG, NOW)).toBe(true);
		expect(shouldRunFreshnessAudit(NOW - 3 * DAY, CONFIG, NOW)).toBe(false);
		expect(shouldRunFreshnessAudit(NOW - 8 * DAY, CONFIG, NOW)).toBe(true);
	});
});
