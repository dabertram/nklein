import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendReasoningObservations,
	readAllReasoningObservations,
	type StoredReasoningObservation,
} from "../../../src/state/reasoning-observation-store";

function obs(overrides: Partial<StoredReasoningObservation>): StoredReasoningObservation {
	return {
		modelId: "m",
		role: "worker",
		difficulty: "medium",
		reasoningEnabled: false,
		qualityScore: 0.5,
		...overrides,
	};
}

describe("reasoning-observation-store", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "reasoning-observation-store-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("returns [] when the log does not exist yet", async () => {
		expect(await readAllReasoningObservations({ rootDir: root })).toEqual([]);
	});

	it("appending an empty batch is a no-op", async () => {
		await appendReasoningObservations([], { rootDir: root });
		expect(await readAllReasoningObservations({ rootDir: root })).toEqual([]);
	});

	it("round-trips a baseline+enforced observation pair through the validated jsonl log", async () => {
		await appendReasoningObservations(
			[obs({ reasoningEnabled: false, qualityScore: 0.4 }), obs({ reasoningEnabled: true, qualityScore: 0.8 })],
			{ rootDir: root },
		);
		const back = await readAllReasoningObservations({ rootDir: root });
		expect(back).toHaveLength(2);
		expect(back.map((o) => o.reasoningEnabled)).toEqual([false, true]);
		expect(back.map((o) => o.qualityScore)).toEqual([0.4, 0.8]);
	});
});
