import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createEvidenceBundle } from "../telemetry/evidence-bundle";
import {
	type ClineDevTestProjectScenario,
	DEFAULT_CLINE_DEV_TEST_SCENARIO,
	scaffoldClineDevTestProject,
} from "./cline-dev-test-project";
import { type ClineModelRegistryCapabilityObservation, getDefaultClineModelRegistry } from "./cline-model-registry";

const execFileAsync = promisify(execFile);

export interface ClineEvalHarnessOptions {
	scenario?: ClineDevTestProjectScenario;
	parentDir?: string;
	evidenceRootDir?: string;
	initializeGit?: boolean;
	modelObservation?: Omit<ClineModelRegistryCapabilityObservation, "passed" | "score" | "createdAt">;
	recordCapability?: (observation: ClineModelRegistryCapabilityObservation) => Promise<unknown>;
	now?: () => number;
}

export interface ClineEvalHarnessResult {
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

export async function runClineDevSmokeEval(options: ClineEvalHarnessOptions = {}): Promise<ClineEvalHarnessResult> {
	const scenario = options.scenario ?? DEFAULT_CLINE_DEV_TEST_SCENARIO;
	const project = await scaffoldClineDevTestProject({
		scenario,
		parentDir: options.parentDir,
		initializeGit: options.initializeGit ?? true,
		now: options.now,
	});
	const startedAt = options.now?.() ?? Date.now();
	const acceptance = await runAcceptanceCommand(project.acceptanceCommand, project.workspacePath);
	const finishedAt = options.now?.() ?? Date.now();
	const capabilityScore = acceptance.passed ? 100 : 0;
	if (options.modelObservation) {
		const modelRegistry = getDefaultClineModelRegistry();
		await (options.recordCapability ?? modelRegistry.recordCapability.bind(modelRegistry))({
			...options.modelObservation,
			passed: acceptance.passed,
			score: capabilityScore,
			createdAt: finishedAt,
		});
	}
	const diffPatch = await readGitDiff(project.workspacePath);
	const evidenceBundle = await createEvidenceBundle({
		rootDir: options.evidenceRootDir,
		scenario: scenario.id,
		startedAt,
		finishedAt,
		outcome: acceptance.passed ? "passed" : "failed",
		summary: acceptance.passed ? "Dev smoke eval passed." : "Dev smoke eval failed.",
		models: [],
		metrics: [
			{ label: "exit code", value: acceptance.exitCode },
			{ label: "capability score", value: capabilityScore },
			{ label: "workspace", value: project.workspacePath },
		],
		diffPatch,
		configSnapshot: {
			scenario,
			workspacePath: project.workspacePath,
			gitInitialized: project.gitInitialized,
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
