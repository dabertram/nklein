import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDevBenchmarkCommand } from "../../../src/commands/dev-benchmark-command";
import { buildAiderPolyglotTask, PINNED_AIDER_POLYGLOT_COMMIT } from "../../../src/core/aider-polyglot-benchmark";

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
	it("exposes Terminal-Bench preflight as a fail-closed action", async () => {
		await expect(runDevBenchmarkCommand({ action: "terminal-preflight", write: () => undefined })).rejects.toThrow(
			/requires --report-dir, --storage-path, and an explicit --required-free-gb/,
		);
	});

	it("measures the explicitly selected Docker-backing filesystem without pulling images", async () => {
		let output = "";
		let probeInput: { harborPath: string; storagePath: string } | undefined;
		await runDevBenchmarkCommand(
			{
				action: "terminal-preflight",
				reportDir: "/tmp/tbench-evidence",
				storagePath: "/tmp",
				requiredFreeGb: "40",
				harborPath: "/opt/harbor",
				write: (text) => {
					output += text;
				},
			},
			{
				probeTerminalBenchHost: async (input) => {
					probeInput = input;
					return {
						harborVersion: "0.5.0",
						dockerReachable: true,
						dockerArchitecture: "amd64",
						availableBytes: 50 * 1024 ** 3,
						reclaimableDockerBytes: 10 * 1024 ** 3,
					};
				},
			},
		);
		expect(probeInput).toEqual({ harborPath: "/opt/harbor", storagePath: "/tmp" });
		expect(JSON.parse(output)).toMatchObject({
			action: "terminal-preflight",
			ready: false,
			storagePath: "/tmp",
			host: { ready: true },
			agentBoundary: { ready: false },
		});
	});

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

	it("writes immutable fresh-window evidence with explicit leakage exclusions", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-bench-fresh-"));
		const dataset = join(root, "dataset.json");
		const cutoffs = join(root, "cutoffs.json");
		const leakage = join(root, "leakage.json");
		const output = join(root, "fresh.json");
		await writeFile(
			dataset,
			JSON.stringify([
				{ ...task, instance_id: "fresh", created_at: "2026-06-01" },
				{ ...task, instance_id: "recalled", created_at: "2026-06-01" },
			]),
		);
		await writeFile(cutoffs, JSON.stringify({ "local/model": "2026-01-01" }));
		await writeFile(
			leakage,
			JSON.stringify([{ instanceId: "recalled", kind: "path_recall", evidence: "Named a withheld file path." }]),
		);
		await runDevBenchmarkCommand({
			action: "fresh-track",
			dataset,
			source: "swe_rebench",
			modelCutoffs: cutoffs,
			leakageHits: leakage,
			output,
			write: () => undefined,
		});
		const evidence = JSON.parse(await readFile(output, "utf8"));
		expect(evidence.instanceIds).toEqual(["fresh"]);
		expect(evidence.exclusions).toContainEqual(
			expect.objectContaining({ instanceId: "recalled", reason: "leakage_hit" }),
		);
		await expect(
			runDevBenchmarkCommand({
				action: "fresh-track",
				dataset,
				source: "swe_rebench",
				modelCutoffs: cutoffs,
				output,
				write: () => undefined,
			}),
		).rejects.toThrow(/fresh benchmark evidence/);
	});

	it("grades local-minted predictions against a post-capture held-out oracle", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-bench-local-grade-"));
		const dataset = join(root, "dataset.json");
		const cache = join(root, "cache");
		const predictions = join(root, "predictions.jsonl");
		const reportDir = join(root, "report");
		const localTask = {
			...task,
			instance_id: "local-owner-repo-1",
			patch: "diff --git a/src/a.ts b/src/a.ts\n-old\n+fixed\n",
			local_oracle: {
				image: "nklein-agent:0.1.0",
				test_command: "npm test",
				test_files: ["test/private.test.ts"],
				solution_files: ["src/a.ts"],
			},
		};
		await mkdir(cache);
		await writeFile(join(cache, "owner__repo.git"), "fixture");
		await writeFile(dataset, JSON.stringify([localTask]));
		await writeFile(
			predictions,
			`${JSON.stringify({
				instance_id: localTask.instance_id,
				model_name_or_path: "nklein/test",
				model_patch: "diff --git a/src/a.ts b/src/a.ts\n-old\n+fixed\n",
			})}\n`,
		);
		let printed = "";
		await runDevBenchmarkCommand(
			{
				action: "grade",
				source: "local_minted",
				dataset,
				instance: localTask.instance_id,
				repoCache: cache,
				predictions,
				reportDir,
				runId: "local-grade-1",
				write: (text) => {
					printed += text;
				},
			},
			{
				runBenchmarkDocker: async (args) => {
					if (args.includes("clone")) await mkdir(join(reportDir, "grade-workspace"));
					return { exitCode: 0, stdout: "ok\n", stderr: "", infrastructureFailure: false };
				},
			},
		);
		expect(JSON.parse(printed)).toMatchObject({ source: "local_minted", status: "resolved" });
		const report = JSON.parse(await readFile(join(reportDir, "results.json"), "utf8"));
		expect(report).toMatchObject({ schema_version: "local_minted_v1", resolved_ids: [localTask.instance_id] });
		expect(await readFile(join(reportDir, "test.log"), "utf8")).toContain("held-out local oracle");
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
		const calibrationOutput = join(root, "calibration.json");
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
			output: calibrationOutput,
			write: (text) => {
				calibration += text;
			},
		});
		expect(JSON.parse(calibration).stableInstanceIds).toEqual(["a"]);
		expect(JSON.parse(await readFile(calibrationOutput, "utf8"))).toEqual({
			stableInstanceIds: ["a"],
			quarantined: {},
		});
		await expect(
			runDevBenchmarkCommand({
				action: "calibrate",
				attempts,
				instanceIds: "a",
				output: calibrationOutput,
				write: () => undefined,
			}),
		).rejects.toThrow(/immutable calibration/);
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

	it("runs the leakage-safe task through !Klein and records immutable aggregate evidence", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-bench-run-"));
		const dataset = join(root, "dataset.json");
		const output = join(root, "predictions.jsonl");
		const receipt = join(root, "receipts", "run-1.json");
		await writeFile(dataset, JSON.stringify([task]));
		let printed = "";
		await runDevBenchmarkCommand(
			{
				action: "run",
				dataset,
				instance: task.instance_id,
				workspaceParent: join(root, "workspaces"),
				model: "nklein/test-fleet",
				modelId: "loaded-model",
				providerId: "lmstudio",
				output,
				receipt,
				runId: "run-1",
				write: (text) => {
					printed += text;
				},
			},
			{
				executeBenchmarkTask: async (input) => {
					expect(JSON.stringify(input.task)).not.toContain("PRIVATE GOLD");
					expect(JSON.stringify(input.task)).not.toContain("PRIVATE TEST");
					expect(input.startInPlanMode).toBe(true);
					expect(input.modelId).toBe("loaded-model");
					expect(input.acceptanceCommand).toBe("");
					expect(input.testEvidencePolicy).toBe("externally_held_out");
					return {
						seedTaskId: input.runId,
						durationMs: 123,
						workflowOutcome: "acceptance_not_run",
						completedCardCount: 3,
						baseCommit: "a".repeat(40),
						resultCommit: "b".repeat(40),
						evidenceRef: "refs/nklein/benchmark-evidence/run-1",
						patch: "diff --git a/a b/a\n-old\n+new\n",
					};
				},
			},
		);
		const prediction = JSON.parse((await readFile(output, "utf8")).trim());
		expect(prediction.model_patch).toContain("+new");
		const evidence = JSON.parse(await readFile(receipt, "utf8"));
		expect(evidence).toMatchObject({
			runId: "run-1",
			startInPlanMode: true,
			testEvidencePolicy: "externally_held_out",
			completedCardCount: 3,
		});
		expect(evidence.patch).toContain("+new");
		expect(JSON.parse(printed)).not.toHaveProperty("patch");
		await expect(
			runDevBenchmarkCommand(
				{
					action: "run",
					dataset,
					instance: task.instance_id,
					workspaceParent: join(root, "workspaces"),
					model: "nklein/test-fleet",
					output,
					receipt,
					runId: "run-1",
					write: () => undefined,
				},
				{ executeBenchmarkTask: async () => Promise.reject(new Error("must not execute")) },
			),
		).rejects.toThrow(/immutable receipt/);
	});

	it("refuses an Aider candidate before execution when calibrated gold evidence is absent", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-bench-aider-calibration-"));
		const dataset = join(root, "manifest.json");
		const polyglot = buildAiderPolyglotTask({
			language: "python",
			exercise: "acronym",
			corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
			configText: JSON.stringify({ files: { solution: ["acronym.py"], test: ["acronym_test.py"] } }),
			instructionParts: ["Implement acronym."],
		});
		await writeFile(
			dataset,
			JSON.stringify({
				schemaVersion: 1,
				corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
				tasks: [polyglot],
			}),
		);
		await expect(
			runDevBenchmarkCommand(
				{
					action: "run",
					source: "aider_polyglot",
					dataset,
					instance: polyglot.instanceId,
					workspaceParent: join(root, "workspace"),
					model: "fixed-model",
					output: join(root, "prediction.jsonl"),
					receipt: join(root, "receipt.json"),
					runId: "uncalibrated",
					write: () => undefined,
				},
				{ executeBenchmarkTask: async () => Promise.reject(new Error("must not execute")) },
			),
		).rejects.toThrow(/requires --calibration/);
	});

	it("refuses a private local candidate before execution when calibrated gold evidence is absent", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-bench-local-calibration-"));
		const dataset = join(root, "dataset.json");
		const privateTask = {
			...task,
			instance_id: "local-owner-repo-calibration",
			local_oracle: {
				image: "nklein-agent:0.1.0",
				test_command: "npm test",
				test_files: ["test/private.test.ts"],
				solution_files: ["src/a.ts"],
			},
		};
		await writeFile(dataset, JSON.stringify([privateTask]));
		await expect(
			runDevBenchmarkCommand(
				{
					action: "run",
					source: "local_minted",
					dataset,
					instance: privateTask.instance_id,
					workspaceParent: join(root, "workspace"),
					model: "fixed-model",
					output: join(root, "prediction.jsonl"),
					receipt: join(root, "receipt.json"),
					runId: "uncalibrated-local",
					write: () => undefined,
				},
				{ executeBenchmarkTask: async () => Promise.reject(new Error("must not execute")) },
			),
		).rejects.toThrow(/requires --calibration/);
		const calibration = join(root, "calibration.json");
		await writeFile(calibration, JSON.stringify({ stableInstanceIds: [privateTask.instance_id], quarantined: {} }));
		let acceptanceCommand = "";
		await runDevBenchmarkCommand(
			{
				action: "run",
				source: "local_minted",
				dataset,
				instance: privateTask.instance_id,
				workspaceParent: join(root, "workspace"),
				model: "fixed-model",
				output: join(root, "prediction.jsonl"),
				receipt: join(root, "receipt.json"),
				runId: "calibrated-local",
				calibration,
				write: () => undefined,
			},
			{
				executeBenchmarkTask: async (input) => {
					acceptanceCommand = input.acceptanceCommand;
					expect(input.task.prompt).toContain("Acceptance check: git diff --check");
					expect(JSON.stringify(input.task)).not.toContain("private.test.ts");
					return {
						seedTaskId: input.runId,
						durationMs: 1,
						workflowOutcome: "completed",
						completedCardCount: 1,
						baseCommit: "a".repeat(40),
						resultCommit: "b".repeat(40),
						evidenceRef: "refs/nklein/benchmark-evidence/calibrated-local",
						patch: "",
					};
				},
			},
		);
		expect(acceptanceCommand).toBe("git diff --check");
	});
});
