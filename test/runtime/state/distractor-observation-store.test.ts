import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendDistractorObservations,
	readAllDistractorObservations,
	type StoredDistractorObservation,
} from "../../../src/state/distractor-observation-store";

function obs(overrides: Partial<StoredDistractorObservation>): StoredDistractorObservation {
	return {
		modelId: "m",
		role: "worker",
		difficulty: "medium",
		noiseFraction: 0.3,
		baselineQuality: 0.9,
		noisyQuality: 0.6,
		...overrides,
	};
}

describe("distractor-observation-store", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "distractor-observation-store-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("returns [] when the log does not exist yet", async () => {
		expect(await readAllDistractorObservations({ rootDir: root })).toEqual([]);
	});

	it("appending an empty batch is a no-op", async () => {
		await appendDistractorObservations([], { rootDir: root });
		expect(await readAllDistractorObservations({ rootDir: root })).toEqual([]);
	});

	it("round-trips distractor observations through the validated jsonl log", async () => {
		await appendDistractorObservations(
			[obs({ noiseFraction: 0.2 }), obs({ noiseFraction: 0.5, noisyQuality: 0.3 })],
			{
				rootDir: root,
			},
		);
		const back = await readAllDistractorObservations({ rootDir: root });
		expect(back).toHaveLength(2);
		expect(back.map((o) => o.noiseFraction)).toEqual([0.2, 0.5]);
		expect(back[1]?.noisyQuality).toBe(0.3);
	});
});
