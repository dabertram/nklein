/**
 * F12.107 — `nklein workflow` CLI: run/list first-class ADW definitions (`.nklein/workflows/<name>.json`).
 *
 * The pure orchestrator lives in src/core/adw-workflow.ts; this file wires the REAL step executors:
 * deterministic steps run host-side via `sh -c` with captured output written to an evidence directory
 * (`.nklein/nklein/adw-runs/<name>-<ts>/<step>.log`), agent steps seed a board card through the normal
 * createTask path and poll the runtime until the card reaches a terminal lane. The run halts on the first
 * failed verify and exits non-zero on a `fail` verdict, so an ADW composes into scripts and cron like any
 * other command.
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import {
	type AdwAgentStep,
	type AdwDeterministicStep,
	adwWorkflowSchema,
	isSafeAdwName,
	runAdwWorkflow,
} from "../core/adw-workflow.js";
import { createTask } from "./task/task-crud-commands.js";
import {
	createRuntimeTrpcClient,
	ensureRuntimeWorkspace,
	resolveWorkspaceRepoPath,
} from "./task/task-runtime-workspace.js";

const AGENT_CARD_POLL_INTERVAL_MS = 5_000;
const TERMINAL_LANES = new Set(["completed", "trash"]);

async function loadWorkflowFile(repoPath: string, name: string) {
	const path = join(repoPath, ".nklein", "workflows", `${name}.json`);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		throw new Error(`No workflow "${name}" — expected ${path}.`);
	}
	try {
		return { workflow: adwWorkflowSchema.parse(JSON.parse(raw)), path };
	} catch (error) {
		throw new Error(
			`Workflow ${path} is invalid: ${error instanceof Error ? error.message.slice(0, 500) : String(error)}`,
		);
	}
}

function runShellCommand(
	command: string,
	options: { cwd: string; timeoutMs: number },
): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
	return new Promise((resolve) => {
		const child = execFile(
			"/bin/sh",
			["-c", command],
			{ cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
			(error, stdout, stderr) => {
				const output = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`;
				const timedOut = Boolean(error && "killed" in error && error.killed === true);
				const exitCode =
					error && typeof (error as { code?: unknown }).code === "number"
						? ((error as { code: number }).code as number)
						: error
							? (child.exitCode ?? null)
							: 0;
				resolve({ exitCode: error ? exitCode : 0, output, timedOut });
			},
		);
	});
}

async function awaitCardTerminalLane(input: {
	workspaceRepoPath: string;
	cardId: string;
	timeoutMs: number;
	log: (line: string) => void;
}): Promise<{ lane: string | null; timedOut: boolean }> {
	const workspaceId = await ensureRuntimeWorkspace(input.workspaceRepoPath);
	const client = createRuntimeTrpcClient(workspaceId);
	const deadline = Date.now() + input.timeoutMs;
	let lastLane: string | null = null;
	while (Date.now() < deadline) {
		const state = await client.workspace.getState.query().catch(() => null);
		if (state) {
			for (const column of state.board.columns) {
				if (column.cards.some((card) => card.id === input.cardId)) {
					if (column.id !== lastLane) {
						lastLane = column.id;
						input.log(`    card ${input.cardId} → ${column.id}`);
					}
					break;
				}
			}
			if (lastLane !== null && TERMINAL_LANES.has(lastLane)) {
				return { lane: lastLane, timedOut: false };
			}
		}
		await new Promise((resolve) => setTimeout(resolve, AGENT_CARD_POLL_INTERVAL_MS));
	}
	return { lane: lastLane, timedOut: true };
}

export async function runAdwCommand(input: {
	cwd: string;
	name: string;
	input?: string;
	projectPath?: string;
	json?: boolean;
	write: (line: string) => void;
}): Promise<{ exitCode: number }> {
	if (!isSafeAdwName(input.name)) {
		throw new Error("Invalid workflow name (lowercase letters, digits, '-' and '_' only).");
	}
	const repoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const { workflow, path } = await loadWorkflowFile(repoPath, input.name);
	const startedAt = Date.now();
	const evidenceDir = join(repoPath, ".nklein", "nklein", "adw-runs", `${input.name}-${startedAt}`);
	await mkdir(evidenceDir, { recursive: true });
	if (!input.json) {
		input.write(`ADW "${input.name}" (${workflow.steps.length} step(s)) from ${path}`);
		input.write(`Evidence: ${evidenceDir}`);
	}
	const report = await runAdwWorkflow(
		workflow,
		{ workflowName: input.name, input: input.input ?? "" },
		{
			now: () => Date.now(),
			onStepStart: (step) => {
				if (!input.json) {
					input.write(`▶ ${step.id} [${step.kind}]${step.title ? ` — ${step.title}` : ""}`);
				}
			},
			runCommand: async (step: AdwDeterministicStep, renderedCommand: string) =>
				runShellCommand(renderedCommand, { cwd: repoPath, timeoutMs: step.timeoutMs }),
			runAgentCard: async (step: AdwAgentStep, card) => {
				const created = await createTask({
					cwd: input.cwd,
					...(input.projectPath ? { projectPath: input.projectPath } : {}),
					title: card.title,
					prompt: card.prompt,
				});
				const cardId = String((created.task as { id?: unknown } | undefined)?.id ?? "");
				if (!cardId) {
					return { cardId: "(none)", lane: null, timedOut: false };
				}
				if (!input.json) {
					input.write(
						`    seeded card ${cardId}; awaiting terminal lane (≤${Math.round(step.awaitTimeoutMs / 60_000)}min)`,
					);
				}
				const outcome = await awaitCardTerminalLane({
					workspaceRepoPath: repoPath,
					cardId,
					timeoutMs: step.awaitTimeoutMs,
					log: (line) => {
						if (!input.json) {
							input.write(line);
						}
					},
				});
				return { cardId, ...outcome };
			},
			writeEvidence: async (stepId, content) => {
				await writeFile(join(evidenceDir, `${stepId}.log`), content, "utf8");
			},
		},
	);
	if (input.json) {
		input.write(JSON.stringify({ ...report, evidenceDir }, null, 2));
	} else {
		for (const step of report.steps) {
			input.write(`${step.skipped ? "⏭" : step.ok ? "✓" : "✗"} ${step.id}: ${step.detail}`);
		}
		input.write(
			`Verdict: ${report.verdict.toUpperCase()}${report.failedStepId ? ` (failed at ${report.failedStepId})` : ""}`,
		);
	}
	return { exitCode: report.verdict === "pass" ? 0 : 1 };
}

export async function listAdwWorkflows(input: {
	cwd: string;
	projectPath?: string;
	write: (line: string) => void;
}): Promise<void> {
	const repoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const dir = join(repoPath, ".nklein", "workflows");
	let entries: string[] = [];
	try {
		entries = (await readdir(dir)).filter((entry) => entry.endsWith(".json"));
	} catch {
		input.write(`No workflows directory (${dir}).`);
		return;
	}
	if (entries.length === 0) {
		input.write(`No workflows defined in ${dir}.`);
		return;
	}
	for (const entry of entries.sort()) {
		const name = entry.replace(/\.json$/, "");
		try {
			const { workflow } = await loadWorkflowFile(repoPath, name);
			const agentSteps = workflow.steps.filter((step) => step.kind === "agent").length;
			input.write(
				`${name} — ${workflow.steps.length} step(s), ${agentSteps} agent${workflow.description ? ` — ${workflow.description}` : ""}`,
			);
		} catch (error) {
			input.write(`${name} — INVALID: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
		}
	}
}

export function registerWorkflowCommand(program: Command): void {
	const workflow = program
		.command("workflow")
		.description("Run and list first-class ADW definitions (.nklein/workflows/<name>.json).");
	workflow
		.command("run <name>")
		.description("Execute an ADW: deterministic steps host-side, agent steps as awaited board cards.")
		.option("--input <text>", "Workflow input, substituted as {input} in commands and card prompts.")
		.option("--project-path <path>", "Workspace repo path (defaults to the current directory's workspace).")
		.option("--json", "Machine-readable run report.")
		.action(async (name: string, options: { input?: string; projectPath?: string; json?: boolean }) => {
			const { exitCode } = await runAdwCommand({
				cwd: process.cwd(),
				name,
				...(options.input !== undefined ? { input: options.input } : {}),
				...(options.projectPath ? { projectPath: options.projectPath } : {}),
				...(options.json ? { json: true } : {}),
				write: (line) => process.stdout.write(`${line}\n`),
			});
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	workflow
		.command("list")
		.description("List the workspace's ADW definitions.")
		.option("--project-path <path>", "Workspace repo path (defaults to the current directory's workspace).")
		.action(async (options: { projectPath?: string }) => {
			await listAdwWorkflows({
				cwd: process.cwd(),
				...(options.projectPath ? { projectPath: options.projectPath } : {}),
				write: (line) => process.stdout.write(`${line}\n`),
			});
		});
}
