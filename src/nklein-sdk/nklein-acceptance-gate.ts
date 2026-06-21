import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";
import type { NKleinPauseController } from "./nklein-pause-controller";

const execFileAsync = promisify(execFile);
const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_ACCEPTANCE_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const DEFAULT_ACCEPTANCE_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const ACCEPTANCE_CHECK_PATTERN = /^Acceptance check:\s*(.+?)\s*$/im;

export interface NKleinAcceptanceGateExecution {
	command: string;
	cwd: string;
	timeoutMs: number;
}

export interface NKleinAcceptanceGateResult {
	present: boolean;
	command: string | null;
	passed: boolean | null;
	exitCode: number | null;
	output: string;
	durationMs: number;
}

export interface RunNKleinAcceptanceGateOptions {
	taskId?: string | null;
	workspacePath: string;
	taskPrompt: string;
	timeoutMs?: number;
	now?: () => number;
	allowHostExecution?: boolean;
	runCommand?: (execution: NKleinAcceptanceGateExecution) => Promise<{
		exitCode: number | null;
		stdout?: string;
		stderr?: string;
	}>;
	recordObservation?: typeof recordSelfObservation;
}

export interface RunNKleinAcceptanceGateInSandboxOptions
	extends Omit<RunNKleinAcceptanceGateOptions, "workspacePath" | "runCommand"> {
	sandboxManager: AgentSandboxManager;
	projectRepoPath: string;
	baseRef?: string | null;
	pauseController?: Pick<NKleinPauseController, "waitUntilResumed">;
}

export function extractNKleinAcceptanceCommand(taskPrompt: string): string | null {
	const match = taskPrompt.match(ACCEPTANCE_CHECK_PATTERN);
	const command = match?.[1]?.trim();
	return command ? command : null;
}

export function resolveShellExecution(command: string): { binary: string; args: string[] } {
	if (process.platform === "win32") {
		const shell = process.env.COMSPEC?.trim() || "cmd.exe";
		return { binary: shell, args: ["/d", "/s", "/c", command] };
	}
	return { binary: "/bin/sh", args: ["-c", command] };
}

function readErrorOutput(error: unknown): { exitCode: number | null; stdout: string; stderr: string } {
	const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
	return {
		exitCode: typeof record.code === "number" ? record.code : null,
		stdout: typeof record.stdout === "string" ? record.stdout : "",
		stderr: typeof record.stderr === "string" ? record.stderr : "",
	};
}

async function defaultRunCommand(execution: NKleinAcceptanceGateExecution): Promise<{
	exitCode: number | null;
	stdout?: string;
	stderr?: string;
}> {
	const shellExecution = resolveShellExecution(execution.command);
	try {
		const result = await execFileAsync(shellExecution.binary, shellExecution.args, {
			cwd: execution.cwd,
			timeout: execution.timeoutMs,
			maxBuffer: DEFAULT_ACCEPTANCE_MAX_BUFFER_BYTES,
			env: {
				...process.env,
				PATH: process.env.PATH?.trim() || DEFAULT_ACCEPTANCE_PATH,
			},
		});
		return {
			exitCode: 0,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch (error) {
		return readErrorOutput(error);
	}
}

function joinOutput(stdout: string | undefined, stderr: string | undefined): string {
	return [stdout, stderr]
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part))
		.join("\n");
}

export async function runNKleinAcceptanceGate(
	options: RunNKleinAcceptanceGateOptions,
): Promise<NKleinAcceptanceGateResult> {
	const now = options.now ?? Date.now;
	const startedAt = now();
	const command = extractNKleinAcceptanceCommand(options.taskPrompt);
	if (!command) {
		return {
			present: false,
			command: null,
			passed: null,
			exitCode: null,
			output: "",
			durationMs: 0,
		};
	}

	const timeoutMs = options.timeoutMs ?? DEFAULT_ACCEPTANCE_TIMEOUT_MS;
	if (!options.runCommand && options.allowHostExecution !== true) {
		throw new Error(
			"Acceptance gate host execution requires an explicit runCommand or allowHostExecution=true; agent tasks must use the sandbox runner.",
		);
	}
	const runCommand = options.runCommand ?? defaultRunCommand;
	const execution = await runCommand({
		command,
		cwd: options.workspacePath,
		timeoutMs,
	});
	const finishedAt = now();
	const output = joinOutput(execution.stdout, execution.stderr);
	const passed = execution.exitCode === 0;
	if (!passed) {
		(options.recordObservation ?? recordSelfObservation)({
			signal: "verification_failed",
			severity: "error",
			message: `Acceptance gate failed: ${command}`,
			taskId: options.taskId,
			workspacePath: options.workspacePath,
			metadata: {
				command,
				exitCode: execution.exitCode,
				outputPreview: output.slice(0, 2_000),
			},
			createdAt: finishedAt,
		});
	}
	return {
		present: true,
		command,
		passed,
		exitCode: execution.exitCode,
		output,
		durationMs: Math.max(0, finishedAt - startedAt),
	};
}

export async function runNKleinAcceptanceGateInSandbox(
	options: RunNKleinAcceptanceGateInSandboxOptions,
): Promise<NKleinAcceptanceGateResult> {
	if (!options.taskId) {
		throw new Error("A task id is required to run the acceptance gate in the agent sandbox.");
	}
	const taskId = options.taskId;
	await options.sandboxManager.assertAvailable();
	const workspace = await options.sandboxManager.prepareWorkspace({
		taskId,
		projectRepoPath: options.projectRepoPath,
		baseRef: options.baseRef ?? null,
	});
	try {
		return await runNKleinAcceptanceGate({
			...options,
			workspacePath: workspace.workdir,
			runCommand: async (execution) => {
				await options.pauseController?.waitUntilResumed(taskId);
				const shellExecution = resolveShellExecution(execution.command);
				return await options.sandboxManager.exec(taskId, [shellExecution.binary, ...shellExecution.args], {
					timeoutMs: execution.timeoutMs,
				});
			},
		});
	} finally {
		await options.sandboxManager.disposeWorkspace(taskId).catch(() => null);
	}
}
