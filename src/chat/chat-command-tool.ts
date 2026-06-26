import { spawn } from "node:child_process";
import type { LocalLlmToolDefinition } from "../nklein-sdk/nklein-local-llm-client";
import { stripInternalAuthTokenFromEnv } from "../security/passcode-manager";
import type { ChatToolSet } from "./chat-board-tools";
import type { CommandSafetyResult } from "./chat-command-safety";
import { classifyCommandSafety } from "./chat-command-safety";
import type { ChatTool } from "./chat-tool-executor";

export type { CommandSafety, CommandSafetyResult } from "./chat-command-safety";
// Re-export the classifier so consumers of this module (e.g. the risk-acknowledgement flow, G3c+) can
// reach it from a single import rather than knowing the sibling module name.
export { classifyCommandSafety } from "./chat-command-safety";

/**
 * The `run_command` execution tool for the chat agent (todo §5.M G2 — "agents running commands, test if things
 * execute at runtime"). A coding agent that can only read and write files is half an agent; it must be able to RUN
 * things (build, test, run the program) and read the result. This is the seam that lets it.
 *
 * It is a `host_command` action, so the execution-mode gate governs it under the §5.M invariant: **denied** outright
 * in the default `isolated_readonly` mode, and a **logged, explicit confirmation** in the host-capable modes — a
 * command is never run silently. The runner is injected so the tool is unit-testable without spawning a process.
 *
 * The safety classifier (`classifyCommandSafety`) is called on each command and its result is available via the
 * `CommandRunRecord.safety` field so callers can implement risk-acknowledgement flows (todo §5.M G3b/G3c) without
 * changing execution behaviour here.
 */

export interface CommandRunResult {
	stdout: string;
	stderr: string;
	/** Process exit code, or null when it was killed (e.g. timed out) or failed to spawn. */
	exitCode: number | null;
	timedOut: boolean;
}

/**
 * Enriched record returned by the `onCommandRun` observer: the raw shell result plus the pre-execution
 * safety classification (safe / unsafe + reason). Consumers of this data (e.g. the risk-acknowledgement
 * flow, todo §5.M G3c) can use `safety` to decide whether to prompt the user.
 *
 * The classification is computed BEFORE execution so that the future confirm/risk flow can intercept;
 * for now it is passed through as metadata only — execution is not gated on it here.
 */
export interface CommandRunRecord {
	command: string;
	safety: CommandSafetyResult;
	result: CommandRunResult;
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
	/**
	 * Optional observer called after each successful run (not on the empty-command early-return). Receives the
	 * enriched `CommandRunRecord` including the pre-run safety classification. Intended for the risk-acknowledgement
	 * flow (todo §5.M G3c) and audit logging; does NOT gate or alter execution.
	 */
	onCommandRun?: (record: CommandRunRecord) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 8_000;

/** Spawn the command through the shell, capping captured output so a runaway process can't blow the agent's context. */
const DEFAULT_RUNNER: CommandRunnerDeps = {
	run: ({ command, cwd, timeoutMs }) =>
		new Promise<CommandRunResult>((resolveRun) => {
			// Untrusted, model-driven command: strip the internal runtime-API auth token from its
			// environment so a leaked token can't be replayed to impersonate a trusted CLI sub-process.
			const child = spawn(command, { cwd, shell: true, env: stripInternalAuthTokenFromEnv() });
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
 *
 * The safety classifier runs on every command and the result is forwarded to `options.onCommandRun` (if
 * provided) as part of the `CommandRunRecord`. This is the hook the upcoming risk-acknowledgement flow
 * (§5.M G3c) will use — no behaviour is changed here, execution is never gated by the classifier.
 */
export function createCommandRunTool(rootDir: string, options: CommandToolOptions = {}): ChatToolSet {
	const runner = options.runner ?? DEFAULT_RUNNER;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
	const { onCommandRun } = options;

	const tools: ChatTool[] = [
		{
			name: "run_command",
			actionKind: "host_command",
			run: async (args) => {
				const command = typeof args.command === "string" ? args.command.trim() : "";
				if (!command) {
					return "Provide a `command` string to run.";
				}
				// Classify BEFORE running so the future risk-acknowledgement flow can intercept here.
				const safety = classifyCommandSafety(command);
				const result = await runner.run({ command, cwd: rootDir, timeoutMs });
				onCommandRun?.({ command, safety, result });
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
