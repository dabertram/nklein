import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendRailRunHistory, readRailRunHistory } from "../../../src/state/rail-run-history-store";

describe("rail-run-history store (F1.32b)", () => {
	let dir: string;

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	});

	it("round-trips runs and tolerates corrupt lines + a missing file", async () => {
		dir = await mkdtemp(join(tmpdir(), "rail-history-"));
		const path = join(dir, "nested", "rail-run-history.jsonl");
		expect(await readRailRunHistory({ path })).toEqual([]);
		await appendRailRunHistory({ projectId: "mid_task", modelId: "m1", at: 100 }, { path });
		await appendRailRunHistory({ projectId: "deep_chain", modelId: "m2", at: 200 }, { path });
		await appendRailRunHistory({ projectId: "mid_task", modelId: "m1", at: 300 }, { path });
		const runs = await readRailRunHistory({ path });
		expect(runs).toEqual([
			{ projectId: "mid_task", modelId: "m1", at: 100 },
			{ projectId: "deep_chain", modelId: "m2", at: 200 },
			{ projectId: "mid_task", modelId: "m1", at: 300 },
		]);
	});

	it("skips malformed rows instead of failing the read", async () => {
		dir = await mkdtemp(join(tmpdir(), "rail-history-"));
		const path = join(dir, "history.jsonl");
		await appendRailRunHistory({ projectId: "a", modelId: "m", at: 1 }, { path });
		await writeFile(path, 'not-json\n{"projectId":"x"}\n', { flag: "a" });
		await appendRailRunHistory({ projectId: "b", modelId: "m", at: 2 }, { path });
		expect(await readRailRunHistory({ path })).toEqual([
			{ projectId: "a", modelId: "m", at: 1 },
			{ projectId: "b", modelId: "m", at: 2 },
		]);
	});
});
