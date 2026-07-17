import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readVisualBaseline, writeVisualBaseline } from "../../../src/state/visual-baseline-store";

describe("visual-baseline-store", () => {
	let dir: string | null = null;
	afterEach(async () => {
		if (dir) {
			await rm(dir, { recursive: true, force: true });
			dir = null;
		}
	});

	it("round-trips an RGBA baseline keyed by a sluggable route key", async () => {
		dir = await mkdtemp(join(tmpdir(), "visual-baseline-"));
		const image = {
			width: 2,
			height: 2,
			data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
		};
		await writeVisualBaseline("ws-1//route?tab=board", image, { rootDir: dir });
		const read = await readVisualBaseline("ws-1//route?tab=board", { rootDir: dir });
		expect(read).not.toBeNull();
		expect(read?.width).toBe(2);
		expect(read?.height).toBe(2);
		expect([...(read?.data ?? [])]).toEqual([...image.data]);
	});

	it("returns null for a missing baseline (the gate's baseline_created path)", async () => {
		dir = await mkdtemp(join(tmpdir(), "visual-baseline-"));
		expect(await readVisualBaseline("never-written", { rootDir: dir })).toBeNull();
	});

	it("treats a size-mismatched/corrupt baseline as absent so the gate re-creates it", async () => {
		dir = await mkdtemp(join(tmpdir(), "visual-baseline-"));
		const image = { width: 2, height: 1, data: new Uint8Array(8) };
		await writeVisualBaseline("k", image, { rootDir: dir });
		// corrupt the sidecar to claim different dimensions
		await writeFile(join(dir, "k.json"), JSON.stringify({ width: 4, height: 4 }));
		expect(await readVisualBaseline("k", { rootDir: dir })).toBeNull();
	});
});
