import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type AcceptanceFailureCategory, classifyAcceptanceFailure } from "../core/acceptance-failure-taxonomy";
import { parseCompilerDiagnostics, planTypeCheckRepair } from "../core/compiler-diagnostics";
import { isTruthyEnv } from "../core/env-flag";
import { deriveRepoVerifyCommands } from "../core/repo-verify-commands";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";
import type { NKleinPauseController } from "./nklein-pause-controller";

const execFileAsync = promisify(execFile);
const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_ACCEPTANCE_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const DEFAULT_ACCEPTANCE_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
// Keep in sync with the pure mirror in src/core/plan-integration-gate.ts (PLAN_ACCEPTANCE_CHECK_PATTERN) —
// the core layer cannot value-import this impure module (node:child_process + telemetry sink).
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
	/** Classified failure category when the gate ran and failed; null when not present or passed. */
	failureCategory: AcceptanceFailureCategory | null;
	/** One-line next-step hint for the classified failure; null when not present or passed. */
	failureHint: string | null;
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

function stripMatchingShellQuotes(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

function quoteShellLiteral(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function remapWorkspacesPath(targetPath: string, workspacePath: string): string | null {
	const workspacesPrefix = "/workspaces/";
	if (!targetPath.startsWith(workspacesPrefix)) {
		return null;
	}
	const targetSuffix = targetPath.slice(workspacesPrefix.length);
	const separatorIndex = targetSuffix.indexOf("/");
	if (separatorIndex < 0) {
		return "";
	}
	const subpath = targetSuffix.slice(separatorIndex + 1);
	if (!subpath) {
		return "";
	}
	const segments = subpath.split("/").filter((segment) => segment.length > 0);
	if (segments.some((segment) => segment === "." || segment === "..")) {
		return null;
	}
	return `${workspacePath.replace(/\/+$/, "")}/${segments.join("/")}`;
}

/**
 * Decomposed cards sometimes carry an absolute `/workspaces/<old-task>` prefix from the worker/review sandbox.
 * Acceptance runs in its own fresh sandbox, so remap only that sandbox-root prefix and leave project-relative `cd`s
 * intact.
 */
export function rewriteSandboxAcceptanceCommand(command: string, workspacePath: string): string {
	const match = command.match(/^\s*cd\s+((?:"[^"]*"|'[^']*'|[^&;]+?))\s*&&\s*([\s\S]+)$/);
	if (!match) {
		return command;
	}
	const targetPath = stripMatchingShellQuotes(match[1] ?? "");
	const remainder = (match[2] ?? "").trim();
	if (!targetPath || !remainder) {
		return command;
	}
	const remappedPath = remapWorkspacesPath(targetPath, workspacePath);
	if (remappedPath === null) {
		return command;
	}
	if (!remappedPath) {
		return remainder;
	}
	return `cd ${quoteShellLiteral(remappedPath)} && ${remainder}`;
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
			failureCategory: null,
			failureHint: null,
		};
	}

	const timeoutMs = options.timeoutMs ?? DEFAULT_ACCEPTANCE_TIMEOUT_MS;
	if (!options.runCommand && options.allowHostExecution !== true) {
		throw new Error(
			"Acceptance gate host execution requires an explicit runCommand or allowHostExecution=true; agent tasks must use the sandbox runner.",
		);
	}
	const runCommand = options.runCommand ?? defaultRunCommand;
	// F12.86 type-check-FIRST micro-loop (OPT-IN via NKLEIN_TYPECHECK_FIRST; default OFF = byte-identical): a type
	// check is the cheapest correctness gate there is, so run it BEFORE the expensive acceptance command and
	// bounce with ANCHORED diagnostics (≤5 `file:line [code]: message`) rather than a wall of compiler output —
	// weak models self-repair reliably from that shape. Only fires when the repo publishes a typecheck-ish script;
	// any degraded read yields no check and the normal path runs untouched.
	if (isTruthyEnv(process.env.NKLEIN_TYPECHECK_FIRST)) {
		const packageRead = await runCommand({ command: "cat package.json", cwd: options.workspacePath, timeoutMs });
		const typeCheck = deriveRepoVerifyCommands({
			packageJsonContent: packageRead.exitCode === 0 ? (packageRead.stdout ?? null) : null,
			acceptanceCommand: command,
		}).commands.find((candidate) => /typecheck|type-check|tsc/i.test(candidate.command));
		if (typeCheck) {
			const checkRun = await runCommand({ command: typeCheck.command, cwd: options.workspacePath, timeoutMs });
			if (checkRun.exitCode !== 0) {
				const diagnostics = parseCompilerDiagnostics(joinOutput(checkRun.stdout, checkRun.stderr), "typescript");
				const plan = planTypeCheckRepair({ diagnostics, attempt: 0 });
				const checkOutput = joinOutput(checkRun.stdout, checkRun.stderr);
				const finishedTypeCheckAt = now();
				(options.recordObservation ?? recordSelfObservation)({
					signal: "verification_failed",
					severity: "error",
					message: `Type check failed before acceptance: ${typeCheck.command}`,
					taskId: options.taskId,
					workspacePath: options.workspacePath,
					metadata: {
						command: typeCheck.command,
						exitCode: checkRun.exitCode,
						category: "typecheck_first",
						diagnosticCount: diagnostics.length,
					},
					createdAt: finishedTypeCheckAt,
				});
				return {
					present: true,
					command,
					passed: false,
					exitCode: checkRun.exitCode,
					output: `[type check: ${typeCheck.command}] exit ${checkRun.exitCode ?? "?"}\n${checkOutput.slice(0, 4_000)}`,
					durationMs: Math.max(0, finishedTypeCheckAt - startedAt),
					failureCategory: "lint_error",
					// Anchored instruction when the output parsed; otherwise say so honestly rather than inventing anchors.
					failureHint:
						plan.instruction ??
						`The repo's \`${typeCheck.command}\` failed before the acceptance command ran. Fix the reported type errors first, then re-run.`,
				};
			}
		}
	}
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
	// F11.2g (OPT-IN via NKLEIN_REPO_VERIFY; default OFF = byte-identical): a GREEN acceptance also runs the
	// repo's OWN non-mutating verify scripts (lint/typecheck, derived from package.json, capped at 2) on the same
	// delivered tree — matching the project's real rules IS fitting the codebase, and models self-heal reliably
	// against explicit lint output. A red repo check FAILS the gate with the output appended, so the standard
	// bounce machinery feeds it back. Reads package.json through the same runCommand, so it works identically in
	// the sandbox and host paths; every degraded read/parse simply yields no extra checks.
	if (passed && isTruthyEnv(process.env.NKLEIN_REPO_VERIFY)) {
		const packageRead = await runCommand({ command: "cat package.json", cwd: options.workspacePath, timeoutMs });
		const derivation = deriveRepoVerifyCommands({
			packageJsonContent: packageRead.exitCode === 0 ? (packageRead.stdout ?? null) : null,
			acceptanceCommand: command,
		});
		let repoOutput = "";
		for (const check of derivation.commands) {
			const checkRun = await runCommand({ command: check.command, cwd: options.workspacePath, timeoutMs });
			const checkOutput = joinOutput(checkRun.stdout, checkRun.stderr);
			repoOutput += `\n\n[repo verify: ${check.command}] exit ${checkRun.exitCode ?? "?"}\n${checkOutput.slice(0, 4_000)}`;
			if (checkRun.exitCode !== 0) {
				const repoFinishedAt = now();
				(options.recordObservation ?? recordSelfObservation)({
					signal: "verification_failed",
					severity: "error",
					message: `Repo verify check failed after a green acceptance: ${check.command}`,
					taskId: options.taskId,
					workspacePath: options.workspacePath,
					metadata: { command: check.command, exitCode: checkRun.exitCode, category: "repo_verify" },
					createdAt: repoFinishedAt,
				});
				return {
					present: true,
					command,
					passed: false,
					exitCode: checkRun.exitCode,
					output: `${output}${repoOutput}`,
					durationMs: Math.max(0, repoFinishedAt - startedAt),
					failureCategory: "lint_error",
					failureHint: `The acceptance command passed, but the repo's own \`${check.command}\` failed on the delivered tree — fix the reported issues; matching the project's lint/type rules is part of done.`,
				};
			}
		}
		if (repoOutput) {
			return {
				present: true,
				command,
				passed: true,
				exitCode: execution.exitCode,
				output: `${output}${repoOutput}`,
				durationMs: Math.max(0, now() - startedAt),
				failureCategory: null,
				failureHint: null,
			};
		}
	}
	const classification = passed ? null : classifyAcceptanceFailure({ exitCode: execution.exitCode, output });
	return {
		present: true,
		command,
		passed,
		exitCode: execution.exitCode,
		output,
		durationMs: Math.max(0, finishedAt - startedAt),
		failureCategory: classification?.category ?? null,
		failureHint: classification?.hint ?? null,
	};
}

/**
 * The acceptance re-check runs in its OWN synthetic sandbox session (`<taskId>::acceptance`), like the
 * `::review` session does. Reusing the worker's task id was destructive (run19 autopsy): prepareWorkspace
 * rm-rf's + re-clones the workdir keyed by taskId, so the check would DESTROY a live worker's workspace and
 * then dispose the worker's slot — while testing whatever tree the passed ref named. Never collide.
 */
export const ACCEPTANCE_SESSION_TASK_SUFFIX = "::acceptance";

// Per-invocation discriminator so CONCURRENT / overlapping acceptance verifications for the SAME base task never
// share one `::acceptance` sandbox session. ROOT CAUSE (det-bounce flake, instrumented 2026-07-08): several
// acceptance runs collide on one base task in the finalize flow — the pre-review reviewer-summary acceptance, the
// #39 base-tree waiver re-check, the delivery-gate re-check — each `prepareWorkspace(<id>::acceptance)` then disposes
// it in `finally`; when two overlap, run B's dispose tears down run A's live placement and A's exec throws "No
// Docker sandbox workspace is prepared". run19 separated acceptance from the WORKER; this separates each acceptance
// run from EVERY OTHER. Monotonic (not Date.now/random — deterministic across a process) and never reused.
let acceptanceSessionSeq = 0;

/** Bounded slot wait for this auxiliary seam: the pool may be busy with the very sessions awaiting this check. */
const ACCEPTANCE_SLOT_QUEUE_WAIT_MS = 120_000;

/**
 * Ceiling on the pre-command pause wait. `waitUntilResumed` blocks FOREVER while a task is paused and never
 * resumed — but here it runs AFTER the sandbox slot is acquired, so an indefinite wait leaks the slot (the
 * review-hang deadlock class, 2026-07-10). Past this cap we proceed with the command rather than hold the slot
 * hostage to a stuck pause: the acceptance gate has its own command timeout, and a genuinely-paused board is the
 * operator's call, not a reason to freeze the pool.
 */
const ACCEPTANCE_PAUSE_WAIT_CAP_MS = 60_000;

export async function runNKleinAcceptanceGateInSandbox(
	options: RunNKleinAcceptanceGateInSandboxOptions,
): Promise<NKleinAcceptanceGateResult> {
	if (!options.taskId) {
		throw new Error("A task id is required to run the acceptance gate in the agent sandbox.");
	}
	const taskId = options.taskId;
	// Strip any pre-existing `::acceptance[-n]` suffix from a re-entrant caller, then stamp a FRESH unique one so this
	// invocation's sandbox session can never collide with a concurrent acceptance run on the same base task.
	const baseTaskId = taskId.replace(/::acceptance(?:-\d+)?$/, "");
	acceptanceSessionSeq += 1;
	const sandboxTaskId = `${baseTaskId}${ACCEPTANCE_SESSION_TASK_SUFFIX}-${acceptanceSessionSeq}`;
	await options.sandboxManager.assertAvailable();
	const workspace = await options.sandboxManager.prepareWorkspace({
		taskId: sandboxTaskId,
		projectRepoPath: options.projectRepoPath,
		baseRef: options.baseRef ?? null,
		maxQueueWaitMs: ACCEPTANCE_SLOT_QUEUE_WAIT_MS,
	});
	try {
		return await runNKleinAcceptanceGate({
			...options,
			workspacePath: workspace.workdir,
			runCommand: async (execution) => {
				// Bounded pause-wait: this runs AFTER the slot is acquired, so an indefinite wait on a stuck pause
				// leaks the slot (the review-hang deadlock class). Past the cap we proceed — the command has its own
				// timeout, and a genuinely-paused board is the operator's decision, not a reason to freeze the pool.
				const pauseWait = options.pauseController?.waitUntilResumed(taskId);
				if (pauseWait) {
					let capTimer: ReturnType<typeof setTimeout> | undefined;
					const cap = new Promise<void>((resolve) => {
						capTimer = setTimeout(resolve, ACCEPTANCE_PAUSE_WAIT_CAP_MS);
						capTimer.unref?.();
					});
					await Promise.race([pauseWait.catch(() => undefined), cap]);
					if (capTimer) {
						clearTimeout(capTimer);
					}
				}
				const command = rewriteSandboxAcceptanceCommand(execution.command, execution.cwd);
				const shellExecution = resolveShellExecution(command);
				return await options.sandboxManager.exec(sandboxTaskId, [shellExecution.binary, ...shellExecution.args], {
					timeoutMs: execution.timeoutMs,
				});
			},
		});
	} finally {
		await options.sandboxManager.disposeWorkspace(sandboxTaskId).catch(() => null);
	}
}
