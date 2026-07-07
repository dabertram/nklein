import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createEvidenceBundle } from "../telemetry/evidence-bundle";
import type { SelfObservationEventRecord, SelfObservationSignal } from "../telemetry/self-observation-sink";
import { isSelfObservationSeverity } from "../telemetry/self-observation-sink";
import {
	getDefaultNKleinDevTestScenario,
	type NKleinDevTestProjectScenario,
	scaffoldNKleinDevTestProject,
} from "./nklein-dev-test-project";
import { getDefaultNKleinModelRegistry, type NKleinModelRegistryCapabilityObservation } from "./nklein-model-registry";

const execFileAsync = promisify(execFile);
const DEV_SMOKE_EVIDENCE_SIGNALS = new Set<SelfObservationSignal>([
	"provider_error",
	"context_overflow",
	"runtime_error",
	"slow_turn",
	"budget_wall",
	"tool_error",
]);

export interface NKleinEvalHarnessOptions {
	scenario?: NKleinDevTestProjectScenario;
	parentDir?: string;
	/** §5.W: configured safe base dir (global setting) for the created workspace; null/undefined → env/home default. */
	workspaceBaseDir?: string;
	evidenceRootDir?: string;
	telemetryRootDir?: string;
	initializeGit?: boolean;
	modelObservation?: Omit<NKleinModelRegistryCapabilityObservation, "passed" | "score" | "createdAt">;
	recordCapability?: (observation: NKleinModelRegistryCapabilityObservation) => Promise<unknown>;
	now?: () => number;
}

export interface NKleinEvalHarnessResult {
	workspacePath: string;
	evidenceBundlePath: string;
	acceptanceCommand: string;
	passed: boolean;
	exitCode: number | null;
	output: string;
}

function splitCommand(command: string): { binary: string; args: string[] } {
	const parts = command.trim().split(/\s+/).filter(Boolean);
	const [binary, ...args] = parts;
	if (!binary) {
		throw new Error("Acceptance command is empty.");
	}
	return { binary, args };
}

async function runAcceptanceCommand(
	command: string,
	cwd: string,
): Promise<{
	passed: boolean;
	exitCode: number | null;
	output: string;
}> {
	const { binary, args } = splitCommand(command);
	try {
		const result = await execFileAsync(binary, args, {
			cwd,
			timeout: 60_000,
			maxBuffer: 1024 * 1024,
		});
		return {
			passed: true,
			exitCode: 0,
			output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
		};
	} catch (error) {
		const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
		const stdout = typeof record.stdout === "string" ? record.stdout : "";
		const stderr = typeof record.stderr === "string" ? record.stderr : "";
		const code = typeof record.code === "number" ? record.code : null;
		return {
			passed: false,
			exitCode: code,
			output: [stdout, stderr].filter(Boolean).join("\n") || String(error),
		};
	}
}

async function readGitDiff(workspacePath: string): Promise<string | null> {
	try {
		const result = await execFileAsync("git", ["diff", "--binary"], {
			cwd: workspacePath,
			timeout: 30_000,
			maxBuffer: 1024 * 1024,
		});
		return result.stdout.trim().length > 0 ? result.stdout : null;
	} catch {
		return null;
	}
}

function parseDevSmokeTelemetryLine(line: string): SelfObservationEventRecord | null {
	try {
		const parsed = JSON.parse(line) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		const record = parsed as Record<string, unknown>;
		if (record.schemaVersion !== 1 || typeof record.signal !== "string" || typeof record.message !== "string") {
			return null;
		}
		if (!DEV_SMOKE_EVIDENCE_SIGNALS.has(record.signal as SelfObservationSignal)) {
			return null;
		}
		const message = record.message.toLowerCase();
		if (record.signal === "runtime_error" && !message.includes("timeout") && !message.includes("timed out")) {
			return null;
		}
		return {
			schemaVersion: 1,
			signal: record.signal as SelfObservationSignal,
			severity: isSelfObservationSeverity(record.severity) ? record.severity : "warning",
			message: record.message,
			taskId: typeof record.taskId === "string" ? record.taskId : null,
			runId: typeof record.runId === "string" ? record.runId : null,
			providerId: typeof record.providerId === "string" ? record.providerId : null,
			modelId: typeof record.modelId === "string" ? record.modelId : null,
			workspacePath: typeof record.workspacePath === "string" ? record.workspacePath : null,
			metadata:
				record.metadata && typeof record.metadata === "object"
					? (record.metadata as Record<string, unknown>)
					: undefined,
			createdAt: typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : 0,
		};
	} catch {
		return null;
	}
}

async function readDevSmokeTelemetry(input: {
	telemetryRootDir?: string;
	startedAt: number;
	finishedAt: number;
}): Promise<SelfObservationEventRecord[]> {
	if (!input.telemetryRootDir) {
		return [];
	}
	const entries = await readdir(input.telemetryRootDir, { withFileTypes: true }).catch(() => []);
	const logFiles = entries
		.filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
		.sort((left, right) => basename(left.name).localeCompare(basename(right.name)));
	const events: SelfObservationEventRecord[] = [];
	for (const entry of logFiles) {
		const text = await readFile(join(input.telemetryRootDir, entry.name), "utf8").catch(() => "");
		for (const line of text.split(/\r?\n/u)) {
			const parsed = line.trim() ? parseDevSmokeTelemetryLine(line) : null;
			if (parsed && parsed.createdAt >= input.startedAt && parsed.createdAt <= input.finishedAt) {
				events.push(parsed);
			}
		}
	}
	return events;
}

function formatModelObservation(
	observation: Omit<NKleinModelRegistryCapabilityObservation, "passed" | "score" | "createdAt"> | undefined,
): string[] {
	if (!observation) {
		return [];
	}
	const endpoint = observation.endpoint?.trim();
	return [`${observation.providerId}:${observation.modelId}${endpoint ? ` @ ${endpoint}` : ""}`];
}

function countTelemetrySignal(events: readonly SelfObservationEventRecord[], signal: SelfObservationSignal): number {
	return events.filter((event) => event.signal === signal).length;
}

function countTimeoutSignals(events: readonly SelfObservationEventRecord[]): number {
	return events.filter(
		(event) =>
			event.signal === "runtime_error" &&
			(event.message.toLowerCase().includes("timeout") || event.message.toLowerCase().includes("timed out")),
	).length;
}

export async function runNKleinDevSmokeEval(options: NKleinEvalHarnessOptions = {}): Promise<NKleinEvalHarnessResult> {
	const scenario = options.scenario ?? getDefaultNKleinDevTestScenario();
	const project = await scaffoldNKleinDevTestProject({
		scenario,
		parentDir: options.parentDir,
		...(options.workspaceBaseDir ? { workspaceBaseDir: options.workspaceBaseDir } : {}),
		initializeGit: options.initializeGit ?? true,
		now: options.now,
	});
	const startedAt = options.now?.() ?? Date.now();
	const acceptance = await runAcceptanceCommand(project.acceptanceCommand, project.workspacePath);
	const finishedAt = options.now?.() ?? Date.now();
	const capabilityScore = acceptance.passed ? 100 : 0;
	if (options.modelObservation) {
		const modelRegistry = getDefaultNKleinModelRegistry();
		await (options.recordCapability ?? modelRegistry.recordCapability.bind(modelRegistry))({
			...options.modelObservation,
			passed: acceptance.passed,
			score: capabilityScore,
			createdAt: finishedAt,
		});
	}
	const diffPatch = await readGitDiff(project.workspacePath);
	const telemetryEvents = await readDevSmokeTelemetry({
		telemetryRootDir: options.telemetryRootDir,
		startedAt,
		finishedAt,
	});
	const evidenceBundle = await createEvidenceBundle({
		rootDir: options.evidenceRootDir,
		scenario: scenario.id,
		startedAt,
		finishedAt,
		outcome: acceptance.passed ? "passed" : "failed",
		summary: acceptance.passed ? "Dev smoke eval passed." : "Dev smoke eval failed.",
		models: formatModelObservation(options.modelObservation),
		metrics: [
			{ label: "exit code", value: acceptance.exitCode },
			{ label: "capability score", value: capabilityScore },
			{ label: "workspace", value: project.workspacePath },
			{ label: "context overflow signals", value: countTelemetrySignal(telemetryEvents, "context_overflow") },
			{ label: "provider error signals", value: countTelemetrySignal(telemetryEvents, "provider_error") },
			{ label: "timeout runtime signals", value: countTimeoutSignals(telemetryEvents) },
		],
		diffPatch,
		telemetryEvents,
		configSnapshot: {
			scenario,
			workspacePath: project.workspacePath,
			gitInitialized: project.gitInitialized,
			localModel: options.modelObservation ?? null,
			telemetryRootDir: options.telemetryRootDir ?? null,
		},
		evalResult: {
			status: acceptance.passed ? "passed" : "failed",
			command: project.acceptanceCommand,
			exitCode: acceptance.exitCode,
			capabilityScore,
			output: acceptance.output,
		},
	});
	return {
		workspacePath: project.workspacePath,
		evidenceBundlePath: evidenceBundle.bundlePath,
		acceptanceCommand: project.acceptanceCommand,
		passed: acceptance.passed,
		exitCode: acceptance.exitCode,
		output: acceptance.output,
	};
}
