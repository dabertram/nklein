import { spawn } from "node:child_process";
import type { LocalLlmToolDefinition } from "../nklein-sdk/nklein-local-llm-client";
import type { ChatToolSet } from "./chat-board-tools";
import type { ChatTool } from "./chat-tool-executor";

/**
 * The `run_command` execution tool for the chat agent (todo §5.M G2 — "agents running commands, test if things
 * execute at runtime"). A coding agent that can only read and write files is half an agent; it must be able to RUN
 * things (build, test, run the program) and read the result. This is the seam that lets it.
 *
 * It is a `host_command` action, so the execution-mode gate governs it under the §5.M invariant: **denied** outright
 * in the default `isolated_readonly` mode, and a **logged, explicit confirmation** in the host-capable modes — a
 * command is never run silently. The runner is injected so the tool is unit-testable without spawning a process.
 */

export interface CommandRunResult {
	stdout: string;
	stderr: string;
	/** Process exit code, or null when it was killed (e.g. timed out) or failed to spawn. */
	exitCode: number | null;
	timedOut: boolean;
}

export interface CommandRunnerDeps {
	run: (input: { command: string; cwd: string; timeoutMs: number }) => Promise<CommandRunResult>;
}

export interface CommandToolOptions {
	runner?: CommandRunnerDeps;
	/** Per-command wall-clock limit (default 120s). */
	timeoutMs?: number;
	/** Max characters of stdout/stderr surfaced to the agent (each stream is truncated, default 8000). */
	maxOutputChars?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 8_000;

/** Spawn the command through the shell, capping captured output so a runaway process can't blow the agent's context. */
const DEFAULT_RUNNER: CommandRunnerDeps = {
	run: ({ command, cwd, timeoutMs }) =>
		new Promise<CommandRunResult>((resolveRun) => {
			const child = spawn(command, { cwd, shell: true });
			let stdout = "";
			let stderr = "";
			let timedOut = false;
			// Hard cap accumulation well above the surfaced slice so we never buffer unbounded output.
			const hardCap = DEFAULT_MAX_OUTPUT_CHARS * 4;
			child.stdout?.on("data", (chunk: Buffer) => {
				if (stdout.length < hardCap) {
					stdout += chunk.toString("utf8");
				}
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				if (stderr.length < hardCap) {
					stderr += chunk.toString("utf8");
				}
			});
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill("SIGKILL");
			}, timeoutMs);
			child.on("close", (code) => {
				clearTimeout(timer);
				resolveRun({ stdout, stderr, exitCode: code, timedOut });
			});
			child.on("error", (error) => {
				clearTimeout(timer);
				resolveRun({
					stdout,
					stderr: `${stderr}${error instanceof Error ? error.message : String(error)}`,
					exitCode: null,
					timedOut,
				});
			});
		}),
};

function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, maxChars)}\n[truncated: ${text.length - maxChars} more characters]`;
}

/** Format the run result into one compact, agent-readable block (exit status + each non-empty stream). */
function formatResult(result: CommandRunResult, maxOutputChars: number): string {
	const header = result.timedOut
		? "Command timed out and was killed."
		: `Command exited with code ${result.exitCode ?? "null"}.`;
	const parts = [header];
	const stdout = result.stdout.trim();
	const stderr = result.stderr.trim();
	if (stdout) {
		parts.push(`stdout:\n${truncate(stdout, maxOutputChars)}`);
	}
	if (stderr) {
		parts.push(`stderr:\n${truncate(stderr, maxOutputChars)}`);
	}
	if (!stdout && !stderr) {
		parts.push("(no output)");
	}
	return parts.join("\n\n");
}

/**
 * Build the `run_command` tool rooted at `rootDir` (commands run with that working directory). Plugs into
 * `createGatedChatToolExecutor`; the gate enforces the §5.M host-access policy before `run` is ever called.
 */
export function createCommandRunTool(rootDir: string, options: CommandToolOptions = {}): ChatToolSet {
	const runner = options.runner ?? DEFAULT_RUNNER;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

	const tools: ChatTool[] = [
		{
			name: "run_command",
			actionKind: "host_command",
			run: async (args) => {
				const command = typeof args.command === "string" ? args.command.trim() : "";
				if (!command) {
					return "Provide a `command` string to run.";
				}
				const result = await runner.run({ command, cwd: rootDir, timeoutMs });
				return formatResult(result, maxOutputChars);
			},
		},
	];

	const definitions: LocalLlmToolDefinition[] = [
		{
			name: "run_command",
			description:
				"Run a shell command in the workspace and return its exit code, stdout, and stderr. Use this to build, run tests, or execute the program to verify it works. This is a host action and requires confirmation.",
			parameters: {
				type: "object",
				properties: {
					command: {
						type: "string",
						description: "The shell command to run, e.g. 'npm test' or 'node script.js'.",
					},
				},
				required: ["command"],
			},
		},
	];

	return { tools, definitions };
}
