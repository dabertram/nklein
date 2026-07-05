import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FitnessRow } from "../../src/core/fitness-table-schema";
import {
	FITNESS_TABLE_SCHEMA_VERSION,
	readFitnessRow,
	readFitnessTable,
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
	tokensPerSec: 40,
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
});
