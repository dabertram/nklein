import { describe, expect, it } from "vitest";
import { summarizeBlockedWrites } from "../../../src/core/blocked-write-evidence";

/**
 * P1.PASSEDBUTUNLANDED (project 47, 2026-09-10): an `edit_file` was rejected, `npm test` then passed VACUOUSLY in
 * the same turn against the untouched file, and the worker reported completion. The runtime knew; the reviewer was
 * left to infer it from an absent diff.
 */
const rejected = {
	name: "edit_file",
	outcome: "error" as const,
	filePaths: ["spec/requirements.json"],
	resultSummary:
		"Blocked edit_file: edit block 1 did not match spec/requirements.json. Closest match was 40% similar.",
};

describe("summarizeBlockedWrites", () => {
	it("names the rejected write, its path and the recorded reason", () => {
		const evidence = summarizeBlockedWrites([rejected]);
		expect(evidence?.blockedCount).toBe(1);
		expect(evidence?.paths).toEqual(["spec/requirements.json"]);
		expect(evidence?.note).toContain("## The runtime blocked this card's write(s)");
		expect(evidence?.note).toContain("`edit_file` on spec/requirements.json");
		expect(evidence?.note).toContain("edit block 1 did not match");
		// The vacuous-acceptance warning is the point of the note, not decoration.
		expect(evidence?.note).toContain("can pass vacuously");
	});

	it("is null when nothing was blocked — the prompt stays byte-identical", () => {
		expect(summarizeBlockedWrites([])).toBeNull();
		expect(summarizeBlockedWrites(null)).toBeNull();
		expect(summarizeBlockedWrites(undefined)).toBeNull();
		expect(summarizeBlockedWrites([{ ...rejected, outcome: "success" }])).toBeNull();
		// A call still in flight is not a refused one.
		expect(summarizeBlockedWrites([{ ...rejected, outcome: null }])).toBeNull();
	});

	it("counts only tools that put bytes on disk", () => {
		expect(summarizeBlockedWrites([{ name: "read_files", outcome: "error", filePaths: ["a.ts"] }])).toBeNull();
		expect(summarizeBlockedWrites([{ name: "run_commands", outcome: "error" }])).toBeNull();
		for (const name of ["write_file", "write_files", "edit_file", "editor"]) {
			expect(summarizeBlockedWrites([{ name, outcome: "error" }])?.blockedCount).toBe(1);
		}
	});

	it("dedupes paths in first-seen order and caps the listing when a worker loops on a bad anchor", () => {
		const evidence = summarizeBlockedWrites([
			...Array.from({ length: 8 }, () => rejected),
			{ ...rejected, filePaths: ["spec/other.json"] },
		]);
		expect(evidence?.blockedCount).toBe(9);
		expect(evidence?.paths).toEqual(["spec/requirements.json", "spec/other.json"]);
		expect(evidence?.note).toContain("and 4 more rejected write call(s)");
	});

	it("survives a call with no path and no reason", () => {
		const evidence = summarizeBlockedWrites([{ name: "write_file", outcome: "error" }]);
		expect(evidence?.note).toContain("`write_file` — rejected");
		expect(evidence?.paths).toEqual([]);
	});
});
