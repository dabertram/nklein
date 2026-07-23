import { describe, expect, it } from "vitest";
import {
	type CellVerdict,
	enumerateNightlyCells,
	type NightlyManifest,
	summarizeNightlyRun,
} from "../../src/core/nightly-manifest";

const manifest: NightlyManifest = {
	projects: [
		{
			id: "small-model-smoke",
			fixture: "smoke-ts-cli",
			recordingSet: "smoke-set",
			invariantPack: "core-invariants",
			modelProfiles: ["qwen-14b", "gemma-12b"],
		},
		{
			id: "habit-many-small",
			fixture: "ts-starter",
			recordingSet: "habit-set",
			invariantPack: "core-invariants",
			modelProfiles: ["qwen-14b"],
		},
	],
};

const cell = (projectId: string, modelProfile: string) => ({
	projectId,
	fixture: `${projectId}-fixture`,
	modelProfile,
	recordingSet: "s",
	invariantPack: "p",
});

describe("enumerateNightlyCells", () => {
	it("expands project × model in manifest order", () => {
		const cells = enumerateNightlyCells(manifest);
		expect(cells.map((c) => `${c.projectId}×${c.modelProfile}`)).toEqual([
			"small-model-smoke×qwen-14b",
			"small-model-smoke×gemma-12b",
			"habit-many-small×qwen-14b",
		]);
		expect(cells.map((c) => c.fixture)).toEqual(["smoke-ts-cli", "smoke-ts-cli", "ts-starter"]);
	});

	it("is deterministic — a nightly summary must be diffable against yesterday's", () => {
		expect(enumerateNightlyCells(manifest)).toEqual(enumerateNightlyCells(manifest));
	});

	it("filters by project and by model", () => {
		expect(enumerateNightlyCells(manifest, { project: "habit-many-small" })).toHaveLength(1);
		expect(enumerateNightlyCells(manifest, { model: "qwen-14b" })).toHaveLength(2);
	});

	it("adding a project is DATA — no code path changes", () => {
		const extended: NightlyManifest = {
			projects: [
				...manifest.projects,
				{
					id: "new-one",
					fixture: "f",
					recordingSet: "r",
					invariantPack: "p",
					modelProfiles: ["m1", "m2"],
				},
			],
		};
		expect(enumerateNightlyCells(extended)).toHaveLength(5);
	});
});

describe("summarizeNightlyRun", () => {
	it("NAMES every failed and skipped cell — no silent truncation", () => {
		const verdicts: CellVerdict[] = [
			{ cell: cell("a", "m"), outcome: "passed" },
			{ cell: cell("b", "m"), outcome: "failed", reason: "acceptance red" },
			{ cell: cell("c", "m"), outcome: "skipped", reason: "no recording set" },
		];
		const result = summarizeNightlyRun(verdicts);
		expect(result.problems.map((p) => p.cell)).toEqual(["b×m", "c×m"]);
		expect(result.summary).toContain("acceptance red");
		expect(result.summary).toContain("no recording set");
	});

	it("supplies a placeholder reason rather than letting a non-pass be silent", () => {
		const result = summarizeNightlyRun([{ cell: cell("a", "m"), outcome: "skipped" }]);
		expect(result.problems[0]?.reason).toContain("MUST say why");
	});

	it("refuses to call a run ok when a PASSING cell left unmatched aimock requests", () => {
		// F11.4c: unmatched requests mean the recording did not cover what the run did. Counting that as a pass
		// lets coverage rot while the suite stays green.
		const result = summarizeNightlyRun([{ cell: cell("a", "m"), outcome: "passed", unmatchedRequests: 3 }]);
		expect(result.passed).toBe(1);
		expect(result.ok).toBe(false);
		expect(result.summary).toContain("coverage is rotting");
	});

	it("is ok only when everything passed AND nothing was unmatched", () => {
		const result = summarizeNightlyRun([
			{ cell: cell("a", "m"), outcome: "passed", unmatchedRequests: 0 },
			{ cell: cell("b", "m"), outcome: "passed" },
		]);
		expect(result.ok).toBe(true);
	});

	it("an EMPTY run is not a green run", () => {
		const result = summarizeNightlyRun([]);
		expect(result.ok).toBe(false);
		expect(result.summary).toContain("an empty nightly run is not a green one");
	});
});
