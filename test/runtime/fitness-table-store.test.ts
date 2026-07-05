import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FitnessRow } from "../../src/core/fitness-table-schema";
import {
	FITNESS_TABLE_SCHEMA_VERSION,
	readFitnessRow,
	readFitnessTable,
	readRankedFitnessCandidates,
	recordTaskFitnessOutcome,
	upsertFitnessRows,
	writeFitnessTable,
} from "../../src/telemetry/fitness-table-store";

const row = (over: Partial<FitnessRow> = {}): FitnessRow => ({
	modelKey: "prov:coder:default",
	role: "worker",
	difficultyTier: "medium",
	sampleCount: 4,
	successCount: 3,
	retryBudget: 2,
	failureModes: [{ kind: "no_tool_call", count: 1 }],
	meanWallTimeMs: 1200,
	meanWallTimeSamples: 3,
	tokensPerSec: 40,
	tokensPerSecSamples: 3,
	updatedAt: 1000,
	...over,
});

describe("fitness-table-store (§5.AB storage layer)", () => {
	let dir: string;
	let path: string; // flat file in an existing dir
	let nestedPath: string; // parent dir does NOT exist yet (exercises mkdir on write)
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "nklein-fit-"));
		path = join(dir, "fitness-table.json");
		nestedPath = join(dir, "nested", "fitness-table.json");
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("missing file ⇒ an empty table at the current version (never throws)", async () => {
		const table = await readFitnessTable({ path });
		expect(table.version).toBe(FITNESS_TABLE_SCHEMA_VERSION);
		expect(Object.keys(table.rows)).toHaveLength(0);
	});

	it("round-trips a table (write → read), creating the parent dir + preserving keys/values", async () => {
		await writeFitnessTable({ version: FITNESS_TABLE_SCHEMA_VERSION, rows: { k1: row() } }, { path: nestedPath });
		const back = await readFitnessTable({ path: nestedPath });
		expect(Object.keys(back.rows)).toEqual(["k1"]);
		expect(back.rows.k1.successCount).toBe(3);
		expect(back.rows.k1.failureModes).toEqual([{ kind: "no_tool_call", count: 1 }]);
	});

	it("upsert merges by cell key (last write wins) + reads a single cell back", async () => {
		await upsertFitnessRows([row(), row({ role: "reviewer", successCount: 1 })], { path });
		await upsertFitnessRows([row({ successCount: 4, sampleCount: 5 })], { path }); // overwrite worker/medium
		const worker = await readFitnessRow(
			{ modelKey: "prov:coder:default", role: "worker", difficultyTier: "medium" },
			{ path },
		);
		const reviewer = await readFitnessRow(
			{ modelKey: "prov:coder:default", role: "reviewer", difficultyTier: "medium" },
			{ path },
		);
		expect(worker?.successCount).toBe(4);
		expect(reviewer?.successCount).toBe(1);
		expect(await readFitnessRow({ modelKey: "nope", role: "worker", difficultyTier: "easy" }, { path })).toBeNull();
	});

	it("MIGRATION: an old (v0) row missing later-added fields is filled with schema defaults on read", async () => {
		await writeFile(
			path,
			JSON.stringify({
				version: 0,
				rows: { k: { modelKey: "m", role: "worker", difficultyTier: "hard", sampleCount: 2, successCount: 1 } },
			}),
			"utf8",
		);
		const table = await readFitnessTable({ path });
		expect(table.version).toBe(FITNESS_TABLE_SCHEMA_VERSION);
		expect(table.rows.k.retryBudget).toBe(0);
		expect(table.rows.k.failureModes).toEqual([]);
		expect(table.rows.k.tokensPerSec).toBeNull();
	});

	it("drops corrupt rows but keeps valid ones; a corrupt file ⇒ empty", async () => {
		await writeFile(path, JSON.stringify({ version: 1, rows: { good: row(), bad: { modelKey: 123 } } }), "utf8");
		expect(Object.keys((await readFitnessTable({ path })).rows)).toEqual(["good"]);
		await writeFile(path, "not json at all", "utf8");
		expect((await readFitnessTable({ path })).rows).toEqual({});
	});

	it("writes a valid, current-version file", async () => {
		await upsertFitnessRows([row()], { path });
		expect(JSON.parse(await readFile(path, "utf8")).version).toBe(FITNESS_TABLE_SCHEMA_VERSION);
	});

	it("read side: ranks persisted models for a role×difficulty cell best-first (§5.AB)", async () => {
		await upsertFitnessRows(
			[
				row({ modelKey: "strong", successCount: 9, sampleCount: 10 }),
				row({ modelKey: "weak", successCount: 2, sampleCount: 10 }),
				row({ modelKey: "mid", successCount: 6, sampleCount: 10 }),
				row({ modelKey: "other-cell", role: "reviewer", successCount: 10, sampleCount: 10 }),
			],
			{ path },
		);
		const ranked = await readRankedFitnessCandidates({ role: "worker", difficultyTier: "medium" }, { path });
		expect(ranked.map((r) => r.modelKey)).toEqual(["strong", "mid", "weak"]); // other-cell (reviewer) excluded
	});
	it("recordTaskFitnessOutcome: concurrent completions for one cell don't lose updates (serialized)", async () => {
		const key = { modelKey: "prov:coder:default", role: "worker", difficultyTier: "medium" as const };
		// Fire 20 outcomes concurrently at the SAME cell — a racy read-modify-write would lose some.
		await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				recordTaskFitnessOutcome(key, { success: i % 2 === 0 }, { path, now: i }),
			),
		);
		const back = await readFitnessRow(key, { path });
		expect(back?.sampleCount).toBe(20); // all 20 folded — none lost
		expect(back?.successCount).toBe(10); // even indices succeeded
	});
}); // end describe
