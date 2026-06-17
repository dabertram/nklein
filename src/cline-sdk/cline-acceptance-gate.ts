import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { recordSelfObservation } from "../telemetry/self-observation-sink";

const execFileAsync = promisify(execFile);
const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_ACCEPTANCE_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const ACCEPTANCE_CHECK_PATTERN = /^Acceptance check:\s*(.+?)\s*$/im;

export interface ClineAcceptanceGateExecution {
	command: string;
	cwd: string;
	timeoutMs: number;
}

export interface ClineAcceptanceGateResult {
	present: boolean;
	command: string | null;
	passed: boolean | null;
	exitCode: number | null;
	output: string;
	durationMs: number;
}

export interface RunClineAcceptanceGateOptions {
	taskId?: string | null;
	workspacePath: string;
	taskPrompt: string;
	timeoutMs?: number;
	now?: () => number;
	runCommand?: (execution: ClineAcceptanceGateExecution) => Promise<{
		exitCode: number | null;
		stdout?: string;
		stderr?: string;
	}>;
	recordObservation?: typeof recordSelfObservation;
}

export function extractClineAcceptanceCommand(taskPrompt: string): string | null {
	const match = taskPrompt.match(ACCEPTANCE_CHECK_PATTERN);
	const command = match?.[1]?.trim();
	return command ? command : null;
}

function resolveShellExecution(command: string): { binary: string; args: string[] } {
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

async function defaultRunCommand(execution: ClineAcceptanceGateExecution): Promise<{
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

export async function runClineAcceptanceGate(
	options: RunClineAcceptanceGateOptions,
): Promise<ClineAcceptanceGateResult> {
	const now = options.now ?? Date.now;
	const startedAt = now();
	const command = extractClineAcceptanceCommand(options.taskPrompt);
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
