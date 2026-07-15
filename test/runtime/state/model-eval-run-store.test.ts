import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelEvalRun } from "../../../src/core/model-eval-aggregation";
import { appendModelEvalRuns, readAllModelEvalRuns } from "../../../src/state/model-eval-run-store";

function run(overrides: Partial<ModelEvalRun>): ModelEvalRun {
	return {
		modelId: "m",
		role: "worker",
		difficulty: "medium",
		passed: true,
		qualityScore: 0.9,
		latencyMs: 100,
		retries: 0,
		...overrides,
	};
}

describe("model-eval-run-store", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "model-eval-run-store-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("returns [] when the log does not exist yet", async () => {
		expect(await readAllModelEvalRuns({ rootDir: root })).toEqual([]);
	});

	it("appending an empty batch is a no-op (no log created)", async () => {
		await appendModelEvalRuns([], { rootDir: root });
		expect(await readAllModelEvalRuns({ rootDir: root })).toEqual([]);
	});

	it("round-trips batches of runs through the validated jsonl log", async () => {
		await appendModelEvalRuns([run({ qualityScore: 0.8 }), run({ qualityScore: 0.4, passed: false })], {
			rootDir: root,
		});
		await appendModelEvalRuns([run({ role: "reviewer", difficulty: "hard" })], { rootDir: root });
		const back = await readAllModelEvalRuns({ rootDir: root });
		expect(back).toHaveLength(3);
		expect(back.map((r) => r.qualityScore)).toEqual([0.8, 0.4, 0.9]);
		expect(back[2]?.role).toBe("reviewer");
		expect(back[2]?.difficulty).toBe("hard");
	});
});
