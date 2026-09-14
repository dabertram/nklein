import { describe, expect, it } from "vitest";
import {
	describeFrozenEvidenceViolations,
	findFrozenEvidenceViolations,
	parseFrozenManifestPaths,
	parseNameStatusZ,
	resolveFrozenPaths,
} from "../../../src/core/frozen-evidence-guard";

const FROZEN_JSON = JSON.stringify({
	frozen: { "input/evidence.mjs": "a".repeat(64), "test/verifier.test.js": "b".repeat(64) },
});

describe("parseFrozenManifestPaths", () => {
	it("reads the nested `frozen` map (analysis, spec, planning, repair, refactor, integration, performance)", () => {
		expect(parseFrozenManifestPaths(FROZEN_JSON)).toEqual(["input/evidence.mjs", "test/verifier.test.js"]);
	});

	it("reads the flat map (test authoring's frozen-digests.json)", () => {
		const flat = JSON.stringify({ "package.json": "c".repeat(64), "mutants/m1/pricing.mjs": "d".repeat(64) });
		expect(parseFrozenManifestPaths(flat)).toEqual(["mutants/m1/pricing.mjs", "package.json"]);
	});

	it("ignores sibling maps a manifest carries for other purposes — repair's `src` is the work, not the evidence", () => {
		const repair = JSON.stringify({
			schemaVersion: 1,
			frozen: { "test/repair.test.js": "e".repeat(64) },
			src: { "src/triage.mjs": "f".repeat(64) },
		});
		expect(parseFrozenManifestPaths(repair)).toEqual(["test/repair.test.js"]);
	});

	it("returns null for anything that is not a manifest", () => {
		expect(parseFrozenManifestPaths("not json")).toBeNull();
		expect(parseFrozenManifestPaths("[]")).toBeNull();
		expect(parseFrozenManifestPaths(JSON.stringify({ frozen: {} }))).toBeNull();
		expect(parseFrozenManifestPaths(JSON.stringify({ schemaVersion: 1 }))).toBeNull();
	});
});

describe("resolveFrozenPaths", () => {
	it("freezes the declared paths, the manifest itself, and the files npm test dispatches through", () => {
		expect([...resolveFrozenPaths([{ path: "test/frozen.json", text: FROZEN_JSON }])].sort()).toEqual([
			"input/evidence.mjs",
			"package.json",
			"scripts/run-tests.mjs",
			"test/frozen.json",
			"test/verifier.test.js",
		]);
	});

	it("freezes nothing when the base declares no manifest", () => {
		expect(resolveFrozenPaths([]).size).toBe(0);
	});

	it("still freezes an unreadable manifest and the dispatch files — an unparseable manifest must not un-freeze", () => {
		expect([...resolveFrozenPaths([{ path: "test/frozen.json", text: "{" }])].sort()).toEqual([
			"package.json",
			"scripts/run-tests.mjs",
			"test/frozen.json",
		]);
	});
});

describe("parseNameStatusZ", () => {
	it("reads NUL-separated status/path pairs, including paths with spaces", () => {
		expect(parseNameStatusZ("M\0test/frozen.test.js\0D\0input/a b.csv\0A\0analysis/findings.json\0")).toEqual([
			{ status: "M", path: "test/frozen.test.js" },
			{ status: "D", path: "input/a b.csv" },
			{ status: "A", path: "analysis/findings.json" },
		]);
	});

	it("reports a rename as the source leaving and the destination arriving, and a copy as an arrival only", () => {
		const output = "R100\0test/verifier.test.js\0test/old.test.js\0C090\0input/a.mjs\0input/b.mjs\0";
		expect(parseNameStatusZ(output)).toEqual([
			{ status: "D", path: "test/verifier.test.js" },
			{ status: "A", path: "test/old.test.js" },
			{ status: "A", path: "input/b.mjs" },
		]);
	});

	it("returns nothing for an empty diff", () => {
		expect(parseNameStatusZ("")).toEqual([]);
	});
});

describe("findFrozenEvidenceViolations", () => {
	const frozen = resolveFrozenPaths([{ path: "test/frozen.json", text: FROZEN_JSON }]);

	it("names every frozen path the delivery touched, by how it was touched, sorted", () => {
		const changes = parseNameStatusZ(
			"M\0test/verifier.test.js\0D\0input/evidence.mjs\0M\0package.json\0T\0scripts/run-tests.mjs\0",
		);
		expect(findFrozenEvidenceViolations({ frozen, changes })).toEqual([
			{ path: "input/evidence.mjs", change: "deleted" },
			{ path: "package.json", change: "modified" },
			{ path: "scripts/run-tests.mjs", change: "type_changed" },
			{ path: "test/verifier.test.js", change: "modified" },
		]);
	});

	it("leaves the deliverable and every other unfrozen path alone — it constrains evidence, not work", () => {
		// A file ADDED under a frozen directory is not listed by any manifest; with the in-tree guard provably
		// untouched, that guard's own walk reports it. The host-side check does not need to.
		const changes = parseNameStatusZ("M\0analysis/findings.json\0A\0test/agent/pricing.test.js\0A\0input/note.md\0");
		expect(findFrozenEvidenceViolations({ frozen, changes })).toEqual([]);
	});

	it("catches the manifest being rewritten to agree with doctored evidence", () => {
		expect(findFrozenEvidenceViolations({ frozen, changes: [{ status: "M", path: "test/frozen.json" }] })).toEqual([
			{ path: "test/frozen.json", change: "modified" },
		]);
	});

	it("never fires for a project without a manifest", () => {
		const none = resolveFrozenPaths([]);
		expect(findFrozenEvidenceViolations({ frozen: none, changes: [{ status: "M", path: "package.json" }] })).toEqual(
			[],
		);
	});
});

describe("describeFrozenEvidenceViolations", () => {
	it("says what moved and why it refuses, and gives the worker the way back", () => {
		const refusal = describeFrozenEvidenceViolations([
			{ path: "input/evidence.mjs", change: "deleted" },
			{ path: "test/verifier.test.js", change: "modified" },
		]);
		expect(refusal.output).toContain("deleted:  input/evidence.mjs");
		expect(refusal.output).toContain("modified: test/verifier.test.js");
		expect(refusal.output).toContain("evidence, not workspace");
		expect(refusal.output).toContain("The acceptance command was not run.");
		expect(refusal.hint).toContain("those 2 files to exactly their content");
		expect(refusal.hint).toContain("base commit");
	});

	it("speaks of one file as one file", () => {
		expect(describeFrozenEvidenceViolations([{ path: "package.json", change: "modified" }]).hint).toContain(
			"that file to exactly its content",
		);
	});
});
