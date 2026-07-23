export const TERMINAL_BENCH_MIN_CONTEXT_WINDOW = 32_768;
export const TERMINAL_BENCH_MAX_COMMAND_CHARS = 65_536;
export const TERMINAL_BENCH_MAX_COMMAND_SECONDS = 1_800;

export interface TerminalBenchAgentConfig {
	taskId: string;
	instruction: string;
	providerId: string;
	modelId: string;
	baseUrl: string;
	contextWindow: number;
	maxTokensPerTurn: number;
	workingDirectory: string;
}

export interface TerminalBenchExecRequest {
	command: string;
	cwd: string;
	timeoutSeconds: number;
}

export interface TerminalBenchExecResult {
	returnCode: number;
	stdout: string;
	stderr: string;
}

function singleLine(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} must be text.`);
	const normalized = value.trim();
	if (!normalized || normalized.includes("\0") || normalized.includes("\n")) {
		throw new Error(`${label} must be a non-empty single-line value.`);
	}
	return normalized;
}

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive integer.`);
	}
	return value;
}

function absoluteContainerPath(value: unknown, label: string): string {
	const path = singleLine(value, label);
	if (!path.startsWith("/")) throw new Error(`${label} must be an absolute container path.`);
	return path;
}

export function parseTerminalBenchAgentConfig(value: unknown): TerminalBenchAgentConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Terminal-Bench agent config must be an object.");
	}
	const input = value as Record<string, unknown>;
	const contextWindow = positiveInteger(input.contextWindow, "contextWindow");
	if (contextWindow < TERMINAL_BENCH_MIN_CONTEXT_WINDOW) {
		throw new Error(`Terminal-Bench agent contextWindow must be at least ${TERMINAL_BENCH_MIN_CONTEXT_WINDOW}.`);
	}
	const maxTokensPerTurn = positiveInteger(input.maxTokensPerTurn, "maxTokensPerTurn");
	if (maxTokensPerTurn >= contextWindow) throw new Error("maxTokensPerTurn must be smaller than contextWindow.");
	if (typeof input.instruction !== "string" || !input.instruction.trim()) {
		throw new Error("Terminal-Bench instruction must be non-empty text.");
	}
	return {
		taskId: singleLine(input.taskId, "taskId"),
		instruction: input.instruction.trim(),
		providerId: singleLine(input.providerId, "providerId"),
		modelId: singleLine(input.modelId, "modelId"),
		baseUrl: singleLine(input.baseUrl, "baseUrl"),
		contextWindow,
		maxTokensPerTurn,
		workingDirectory: absoluteContainerPath(input.workingDirectory, "workingDirectory"),
	};
}

export function parseTerminalBenchExecRequest(value: unknown): TerminalBenchExecRequest {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("terminal_exec input must be an object.");
	}
	const input = value as Record<string, unknown>;
	if (typeof input.command !== "string") throw new Error("terminal_exec command must be text.");
	const command = input.command.trim();
	if (!command || command.includes("\0")) throw new Error("terminal_exec command must be non-empty and NUL-free.");
	if (command.length > TERMINAL_BENCH_MAX_COMMAND_CHARS) {
		throw new Error(`terminal_exec command exceeds ${TERMINAL_BENCH_MAX_COMMAND_CHARS} characters.`);
	}
	const timeoutSeconds =
		input.timeoutSeconds === undefined ? 300 : positiveInteger(input.timeoutSeconds, "timeoutSeconds");
	if (timeoutSeconds > TERMINAL_BENCH_MAX_COMMAND_SECONDS) {
		throw new Error(`terminal_exec timeoutSeconds cannot exceed ${TERMINAL_BENCH_MAX_COMMAND_SECONDS}.`);
	}
	return {
		command,
		cwd: input.cwd === undefined ? "/root" : absoluteContainerPath(input.cwd, "cwd"),
		timeoutSeconds,
	};
}

export function formatTerminalBenchExecResult(result: TerminalBenchExecResult): string {
	if (!Number.isInteger(result.returnCode)) throw new Error("Terminal-Bench returnCode must be an integer.");
	return [
		`exit_code: ${result.returnCode}`,
		"stdout:",
		result.stdout || "<empty>",
		"stderr:",
		result.stderr || "<empty>",
	].join("\n");
}

export function buildTerminalBenchAgentSystemPrompt(workingDirectory: string): string {
	const cwd = absoluteContainerPath(workingDirectory, "workingDirectory");
	return [
		"You are !Klein's Terminal-Bench worker inside a Harbor-owned task environment.",
		`Your default working directory is ${cwd}. Harbor—not you and not !Klein—owns this mutable container and the hidden verifier.`,
		"Use terminal_exec to inspect and modify the task environment. State persists across calls.",
		"There is no network egress. Do not attempt to access the host, Docker socket, Harbor logs, solution files, or verifier files.",
		"Solve the instruction completely, run relevant self-checks, and recover from command failures using their exit code/stdout/stderr.",
		"Do not merely describe commands or a patch: perform the work in the task container.",
		"When the environment is ready for Harbor to verify, call terminal_submit once with a concise summary. That ends your run; it does not certify correctness.",
	].join("\n");
}
