import { execFile as execFileCallback } from "node:child_process";
import { appendFile, link, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { runDevBenchmarkCommand } from "../src/commands/dev-benchmark-command";
import { createDevRuntimeClient } from "../src/commands/dev-project-execution";
import { parseAiderPolyglotManifest } from "../src/core/aider-polyglot-benchmark";
import {
	assertAiderCampaignCodeIdentity,
	assertAiderCampaignHarnessCommit,
	buildAiderRegressionSnapshot,
	parseAiderCampaignConfig,
	parseAiderCampaignHarnessBaseline,
	planAiderCampaign,
	summarizeAiderCampaign,
	type AiderCampaignAttempt,
	type AiderCampaignAttemptResult,
	type AiderCampaignHarnessBaseline,
} from "../src/core/aider-polyglot-campaign";
import { setKanbanRuntimeHost, setKanbanRuntimePort } from "../src/core/runtime-endpoint";
import type { RuntimeBuildIdentity } from "../src/core/runtime-build-identity";
import { assertCandidateCalibration, parseOfficialSwebenchRunReport } from "../src/core/swebench-benchmark";

const execFile = promisify(execFileCallback);

interface CampaignFile {
	schemaVersion: 1;
	campaignId: string;
	repeats: number;
	declaredMdePoints: number;
	assignments: unknown;
	manifestPath: string;
	corpusPath: string;
	calibrationPath: string;
	outputRoot: string;
	residentModelIds: string[];
	runtimeHost?: string;
	runtimePort?: number;
	pollIntervalMs?: number;
	maxWaitMs?: number;
}

interface ResidentModel {
	identifier: string;
	contextLength: number;
	deviceIdentifier: string | null;
	sizeBytes: number;
	status: string;
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
	return value.trim();
}

function parseCampaignFile(value: unknown): CampaignFile {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Campaign file must be an object.");
	const raw = value as Record<string, unknown>;
	if (!Array.isArray(raw.residentModelIds) || raw.residentModelIds.length === 0) {
		throw new Error("residentModelIds must name the complete fixed resident set.");
	}
	const residentModelIds = raw.residentModelIds.map((entry, index) =>
		requiredString(entry, `residentModelIds[${index}]`),
	);
	if (new Set(residentModelIds).size !== residentModelIds.length) throw new Error("residentModelIds contains duplicates.");
	for (const [field, value] of [
		["runtimePort", raw.runtimePort],
		["pollIntervalMs", raw.pollIntervalMs],
		["maxWaitMs", raw.maxWaitMs],
	] as const) {
		if (value !== undefined && (!Number.isInteger(value) || (value as number) < 1)) {
			throw new Error(`${field} must be a positive integer.`);
		}
	}
	return {
		...(raw as unknown as CampaignFile),
		manifestPath: requiredString(raw.manifestPath, "manifestPath"),
		corpusPath: requiredString(raw.corpusPath, "corpusPath"),
		calibrationPath: requiredString(raw.calibrationPath, "calibrationPath"),
		outputRoot: requiredString(raw.outputRoot, "outputRoot"),
		residentModelIds,
	};
}

async function exists(path: string): Promise<boolean> {
	return lstat(path)
		.then(() => true)
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return false;
			throw error;
		});
}

async function atomicWrite(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, content, { flag: "w" });
	await rename(temporary, path);
}

async function atomicWriteNew(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		await writeFile(temporary, content, { flag: "wx" });
		await link(temporary, path).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "EEXIST") throw new Error(`Refusing to replace immutable campaign evidence: ${path}`);
			throw error;
		});
	} finally {
		await rm(temporary, { force: true });
	}
}

async function invoke(options: Parameters<typeof runDevBenchmarkCommand>[0]): Promise<Record<string, unknown>> {
	let output = "";
	await runDevBenchmarkCommand({
		...options,
		json: true,
		write: (text) => {
			output += text;
		},
	});
	return JSON.parse(output) as Record<string, unknown>;
}

async function readResidentModels(): Promise<ResidentModel[]> {
	const result = await execFile("lms", ["ps", "--json"], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
	const value = JSON.parse(result.stdout) as unknown;
	if (!Array.isArray(value)) throw new Error("`lms ps --json` did not return an array.");
	return value.filter((entry) => (entry as Record<string, unknown>).type === "llm").map((entry) => {
		const row = entry as Record<string, unknown>;
		return {
			identifier: requiredString(row.identifier, "resident identifier"),
			contextLength: typeof row.contextLength === "number" ? row.contextLength : 0,
			deviceIdentifier: typeof row.deviceIdentifier === "string" ? row.deviceIdentifier : null,
			sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : 0,
			status: typeof row.status === "string" ? row.status : "unknown",
		};
	});
}

async function readCleanHarnessCommit(): Promise<string> {
	const [commitResult, statusResult] = await Promise.all([
		execFile("git", ["rev-parse", "HEAD"], { timeout: 10_000 }),
		execFile("git", ["status", "--porcelain=v1", "--untracked-files=all"], { timeout: 10_000 }),
	]);
	const commit = commitResult.stdout.trim();
	if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("Could not resolve a full Git commit for the campaign harness.");
	if (statusResult.stdout.trim()) {
		throw new Error("Campaign harness worktree is dirty; commit or remove every change before generating evidence.");
	}
	return commit;
}

async function readRuntimeBuildIdentity(file: CampaignFile): Promise<RuntimeBuildIdentity> {
	if (file.runtimeHost) setKanbanRuntimeHost(file.runtimeHost);
	setKanbanRuntimePort(file.runtimePort ?? 3484);
	try {
		return await createDevRuntimeClient(null).runtime.getBuildIdentity.query();
	} catch (error) {
		throw new Error(
			`Could not verify runtime build identity at ${file.runtimeHost ?? "127.0.0.1"}:${file.runtimePort ?? 3484}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function assertLiveCampaignIdentity(
	file: CampaignFile,
	baseline: AiderCampaignHarnessBaseline,
): Promise<void> {
	const [runnerGitCommit, runtimeBuildIdentity] = await Promise.all([
		readCleanHarnessCommit(),
		readRuntimeBuildIdentity(file),
	]);
	assertAiderCampaignHarnessCommit(baseline, runnerGitCommit, runtimeBuildIdentity);
}

function fixedFleetSnapshot(models: readonly ResidentModel[], requiredIds: readonly string[]): ResidentModel[] {
	const required = new Set(requiredIds);
	const unexpected = models.map((model) => model.identifier).filter((identifier) => !required.has(identifier));
	if (unexpected.length > 0) {
		throw new Error(`Unexpected resident model(s) would change campaign capacity: ${unexpected.sort().join(", ")}.`);
	}
	const byId = new Map(models.map((model) => [model.identifier, model]));
	return [...requiredIds].sort().map((identifier) => {
		const model = byId.get(identifier);
		if (!model) throw new Error(`Required resident model disappeared: ${identifier}.`);
		if (model.contextLength < 32_768) {
			throw new Error(`Required resident model ${identifier} is below the 32k context floor (${model.contextLength}).`);
		}
		return model;
	});
}

function fleetIdentity(models: readonly ResidentModel[]): string {
	return JSON.stringify(
		models.map(({ identifier, contextLength, deviceIdentifier, sizeBytes }) => ({
			identifier,
			contextLength,
			deviceIdentifier,
			sizeBytes,
		})),
	);
}

async function waitForFixedIdleFleet(requiredIds: readonly string[], expectedIdentity?: string): Promise<ResidentModel[]> {
	const deadline = Date.now() + 120_000;
	while (true) {
		const snapshot = fixedFleetSnapshot(await readResidentModels(), requiredIds);
		if (expectedIdentity && fleetIdentity(snapshot) !== expectedIdentity) {
			throw new Error("Fixed resident-set identity changed during the campaign; refusing confounded evidence.");
		}
		if (snapshot.every((model) => model.status === "idle")) return snapshot;
		if (Date.now() >= deadline) throw new Error("Fixed resident set did not become idle within 120 seconds.");
		await new Promise((resolveSleep) => setTimeout(resolveSleep, 2_000));
	}
}

function attemptPaths(outputRoot: string, attempt: AiderCampaignAttempt) {
	const evidence = join(outputRoot, "evidence");
	return {
		workspaceParent: join(outputRoot, "workspaces", attempt.runId),
		receipt: join(evidence, `${attempt.runId}.receipt.json`),
		predictions: join(evidence, `${attempt.runId}.predictions.jsonl`),
		reportDir: join(evidence, `${attempt.runId}.grade`),
		report: join(evidence, `${attempt.runId}.grade`, "results.json"),
	};
}

async function readCompletedAttempt(
	attempt: AiderCampaignAttempt,
	paths: ReturnType<typeof attemptPaths>,
): Promise<AiderCampaignAttemptResult | null> {
	if (!(await exists(paths.report))) return null;
	if (!(await exists(paths.receipt))) throw new Error(`Grade exists without its immutable receipt: ${attempt.runId}.`);
	const statuses = parseOfficialSwebenchRunReport(JSON.parse(await readFile(paths.report, "utf8")) as unknown);
	const receipt = JSON.parse(await readFile(paths.receipt, "utf8")) as Record<string, unknown>;
	return {
		...attempt,
		status: statuses[attempt.instanceId] ?? "error",
		workflowOutcome: typeof receipt.workflowOutcome === "string" ? receipt.workflowOutcome : null,
		patchBytes: typeof receipt.patchBytes === "number" ? receipt.patchBytes : null,
		durationMs: typeof receipt.durationMs === "number" ? receipt.durationMs : null,
	};
}

async function main(): Promise<void> {
	const configPath = process.argv[2];
	if (!configPath) throw new Error("Usage: npx tsx scripts/run-aider-campaign.mts <campaign.json>");
	const planOnly = process.argv.includes("--plan");
	const configText = await readFile(resolve(configPath), "utf8");
	const file = parseCampaignFile(JSON.parse(configText) as unknown);
	const manifestPath = resolve(file.manifestPath);
	const corpusPath = resolve(file.corpusPath);
	const calibrationPath = resolve(file.calibrationPath);
	const outputRoot = resolve(file.outputRoot);
	const manifest = parseAiderPolyglotManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
	const config = parseAiderCampaignConfig(file, manifest);
	const residentIds = new Set(file.residentModelIds);
	const nonResidentAssignments = config.assignments.filter((assignment) => !residentIds.has(assignment.modelId));
	if (nonResidentAssignments.length > 0) {
		throw new Error(
			`Campaign assigns unloaded model(s): ${[...new Set(nonResidentAssignments.map((row) => row.modelId))].join(", ")}.`,
		);
	}
	assertCandidateCalibration(
		config.assignments.map((assignment) => assignment.instanceId),
		JSON.parse(await readFile(calibrationPath, "utf8")) as unknown,
	);
	if (planOnly) {
		process.stdout.write(
			`${JSON.stringify({ config, attempts: planAiderCampaign(config), preRegistration: summarizeAiderCampaign(config, []).preRegistration }, null, 2)}\n`,
		);
		return;
	}
	const pinnedConfigPath = join(outputRoot, "campaign.json");
	const pinnedConfigExists = await exists(pinnedConfigPath);
	const harnessCommit = await readCleanHarnessCommit();
	const runtimeBuildIdentity = await readRuntimeBuildIdentity(file);
	assertAiderCampaignCodeIdentity(harnessCommit, runtimeBuildIdentity);
	const harnessBaselinePath = join(outputRoot, "harness-baseline.json");
	let harnessBaseline: AiderCampaignHarnessBaseline;
	if (await exists(harnessBaselinePath)) {
		harnessBaseline = parseAiderCampaignHarnessBaseline(
			JSON.parse(await readFile(harnessBaselinePath, "utf8")) as unknown,
		);
		assertAiderCampaignHarnessCommit(harnessBaseline, harnessCommit, runtimeBuildIdentity);
	} else {
		if (pinnedConfigExists) {
			throw new Error(
				"Existing campaign predates immutable harness provenance; preserve it for diagnosis and use a new campaign id/output root.",
			);
		}
		harnessBaseline = parseAiderCampaignHarnessBaseline({
			schemaVersion: 1,
			runnerGitCommit: harnessCommit,
			runtimeBuildIdentity,
			runner: "scripts/run-aider-campaign.mts",
			createdAt: new Date().toISOString(),
		});
		await atomicWriteNew(harnessBaselinePath, `${JSON.stringify(harnessBaseline, null, 2)}\n`);
	}
	if (pinnedConfigExists) {
		if ((await readFile(pinnedConfigPath, "utf8")) !== configText) {
			throw new Error("Campaign config changed after execution began; use a new campaign id/output root.");
		}
	} else {
		await atomicWriteNew(pinnedConfigPath, configText);
	}
	const initialFleet = await waitForFixedIdleFleet(file.residentModelIds);
	const identity = fleetIdentity(initialFleet);
	const fleetBaselinePath = join(outputRoot, "fleet-baseline.json");
	if (await exists(fleetBaselinePath)) {
		const baseline = JSON.parse(await readFile(fleetBaselinePath, "utf8")) as ResidentModel[];
		if (fleetIdentity(baseline) !== identity) {
			throw new Error("Resident fleet differs from the immutable campaign baseline.");
		}
	} else {
		await atomicWriteNew(fleetBaselinePath, `${JSON.stringify(initialFleet, null, 2)}\n`);
	}

	const results: AiderCampaignAttemptResult[] = [];
	for (const attempt of planAiderCampaign(config)) {
		await assertLiveCampaignIdentity(file, harnessBaseline);
		const paths = attemptPaths(outputRoot, attempt);
		const completed = await readCompletedAttempt(attempt, paths);
		if (completed) {
			results.push(completed);
			continue;
		}
		try {
			await waitForFixedIdleFleet(file.residentModelIds, identity);
		} catch (error) {
			await appendFile(
				join(outputRoot, "fleet-events.jsonl"),
				`${JSON.stringify({ runId: attempt.runId, at: new Date().toISOString(), error: String(error) })}\n`,
			);
			throw error;
		}
		if (!(await exists(paths.receipt))) {
			if (await exists(paths.workspaceParent)) {
				throw new Error(
					`Interrupted workspace without receipt for ${attempt.runId}; preserve it for diagnosis and restart under a new campaign id.`,
				);
			}
			await invoke({
				action: "workspace",
				source: "aider_polyglot",
				dataset: manifestPath,
				instance: attempt.instanceId,
				corpus: corpusPath,
				workspaceParent: paths.workspaceParent,
			});
			await invoke({
				action: "run",
				source: "aider_polyglot",
				dataset: manifestPath,
				instance: attempt.instanceId,
				corpus: corpusPath,
				workspaceParent: paths.workspaceParent,
				calibration: calibrationPath,
				model: attempt.modelNameOrPath,
				modelId: attempt.modelId,
				runtimeHost: file.runtimeHost,
				runtimePort: String(file.runtimePort ?? 3484),
				runId: attempt.runId,
				receipt: paths.receipt,
				output: paths.predictions,
				pollIntervalMs: String(file.pollIntervalMs ?? 5_000),
				maxWaitMs: String(file.maxWaitMs ?? 30 * 60_000),
				plan: attempt.startInPlanMode,
			});
		}
		await assertLiveCampaignIdentity(file, harnessBaseline);
		await invoke({
			action: "grade",
			source: "aider_polyglot",
			dataset: manifestPath,
			instance: attempt.instanceId,
			corpus: corpusPath,
			predictions: paths.predictions,
			runId: `${attempt.runId}-grade`,
			reportDir: paths.reportDir,
		});
		await assertLiveCampaignIdentity(file, harnessBaseline);
		const result = await readCompletedAttempt(attempt, paths);
		if (!result) throw new Error(`Campaign attempt ${attempt.runId} did not produce a report.`);
		results.push(result);
		await atomicWrite(
			join(outputRoot, "summary.latest.json"),
			`${JSON.stringify(summarizeAiderCampaign(config, results), null, 2)}\n`,
		);
	}
	await assertLiveCampaignIdentity(file, harnessBaseline);
	const summary = summarizeAiderCampaign(config, results);
	const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
	const finalSummaryPath = join(outputRoot, "summary.json");
	if (await exists(finalSummaryPath)) {
		if ((await readFile(finalSummaryPath, "utf8")) !== summaryText) {
			throw new Error("Completed campaign summary differs from its immutable prior result.");
		}
	} else {
		await atomicWriteNew(finalSummaryPath, summaryText);
	}
	for (const arm of ["plan", "no_plan"] as const) {
		const snapshotText = `${JSON.stringify(buildAiderRegressionSnapshot(config, results, arm), null, 2)}\n`;
		const snapshotPath = join(outputRoot, `regression-${arm.replace("_", "-")}.json`);
		if (await exists(snapshotPath)) {
			if ((await readFile(snapshotPath, "utf8")) !== snapshotText) {
				throw new Error(`Completed ${arm} regression snapshot differs from its immutable prior result.`);
			}
		} else {
			await atomicWriteNew(snapshotPath, snapshotText);
		}
	}
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
