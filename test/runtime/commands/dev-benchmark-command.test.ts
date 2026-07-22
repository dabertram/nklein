import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDevBenchmarkCommand } from "../../../src/commands/dev-benchmark-command";

const task = {
	instance_id: "owner__repo-1",
	repo: "owner/repo",
	base_commit: "0123456789abcdef",
	problem_statement: "Repair the frobnicator.",
	patch: "PRIVATE GOLD PATCH",
	test_patch: "PRIVATE TEST PATCH",
	hints_text: "PRIVATE HINT",
	FAIL_TO_PASS: ["new-test"],
	PASS_TO_PASS: ["old-test"],
	difficulty: "<15 min fix",
};

describe("dev benchmark command", () => {
	it("prepares a deterministic manifest with no oracle material", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-bench-prepare-"));
		const dataset = join(root, "dataset.json");
		const output = join(root, "manifest.json");
		await writeFile(dataset, JSON.stringify([task]));
		let printed = "";
		await runDevBenchmarkCommand({
			action: "prepare",
			dataset,
			output,
			difficulty: "under_15m",
			write: (text) => {
				printed += text;
			},
		});
		const manifest = await readFile(output, "utf8");
		expect(manifest).toContain(task.problem_statement);
		expect(manifest).not.toContain("PRIVATE GOLD");
		expect(manifest).not.toContain("PRIVATE TEST");
		expect(manifest).not.toContain("new-test");
		expect(JSON.parse(printed).selected).toBe(1);
	});

	it("atomically accumulates prediction JSONL and refuses accidental replacement", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-bench-predict-"));
		const patch = join(root, "fix.diff");
		const output = join(root, "predictions.jsonl");
		await writeFile(patch, "diff --git a/a b/a\n-old\n+new\n");
		const options = {
			action: "prediction",
			instance: task.instance_id,
			model: "nklein/test",
			patch,
			output,
			write: () => undefined,
		};
		await runDevBenchmarkCommand(options);
		await expect(runDevBenchmarkCommand(options)).rejects.toThrow(/already exists/);
		const prediction = JSON.parse((await readFile(output, "utf8")).trim());
		expect(prediction).toMatchObject({ instance_id: task.instance_id, model_name_or_path: "nklein/test" });
	});

	it("exposes gold quarantine and delta gate as repeatable CLI actions", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-bench-gate-"));
		const attempts = join(root, "attempts.jsonl");
		const baseline = join(root, "baseline.json");
		const current = join(root, "current.json");
		await writeFile(
			attempts,
			`${JSON.stringify({ instanceId: "a", repeat: 1, status: "resolved" })}\n${JSON.stringify({
				instanceId: "a",
				repeat: 2,
				status: "resolved",
			})}\n`,
		);
		await writeFile(baseline, JSON.stringify({ a: "resolved" }));
		await writeFile(current, JSON.stringify({ a: "unresolved" }));
		let calibration = "";
		await runDevBenchmarkCommand({
			action: "calibrate",
			attempts,
			instanceIds: "a",
			write: (text) => {
				calibration += text;
			},
		});
		expect(JSON.parse(calibration).stableInstanceIds).toEqual(["a"]);
		let gate = "";
		await runDevBenchmarkCommand({
			action: "gate",
			baseline,
			current,
			write: (text) => {
				gate += text;
			},
		});
		expect(JSON.parse(gate).verdict).toBe("regression");
	});
});
