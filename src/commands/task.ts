import type { Command } from "commander";
import type { PlanGapKind } from "../core/plan-gap";
import { getKanbanRuntimeOrigin } from "../core/runtime-endpoint";
import type { TaskWorktreeAutoMergeColumn } from "../workspace/task-worktree-auto-merge";
import { parsePlanGapKind } from "./task/task-acceptance-plan-gap.js";
import { planBulkSeed, resolveBulkInputs } from "./task/task-bulk-seed.js";
import { printJson, toErrorMessage } from "./task/task-command-output.js";
import {
	parseAgentId,
	parseAutoMergeColumn,
	parseAutoReviewMode,
	parseOptionalStringOrDefault,
} from "./task/task-command-parsers.js";
import type { ListTaskColumn } from "./task/task-command-types.js";
import { createTask, updateTaskCommand } from "./task/task-crud-commands.js";
import { decomposeTaskGraph } from "./task/task-decompose-command.js";
import { deleteTaskCommand } from "./task/task-delete-command.js";
import { linkTasks, unlinkTasks } from "./task/task-dependency-commands.js";
import { finishTask, mergeTaskWorktreesCommand } from "./task/task-finish-commands.js";
import { buildTaskNKleinSettingsForCreate, parseTaskNKleinReasoningEffort } from "./task/task-nklein-settings.js";
import { expandSavedPlanTaskCommand } from "./task/task-plan-expand-command.js";
import { listTasks, reportBoardHealth } from "./task/task-read-commands.js";
import { parseListColumn } from "./task/task-record-format.js";
import { recordTaskPlanGapCommand } from "./task/task-record-plan-gap-command.js";
import { startTask } from "./task/task-start-command.js";
import { clearTaskSwarmStopCommand, requestTaskSwarmStopCommand } from "./task/task-swarm-commands.js";
import { runVerifyTaskAcceptanceCommand } from "./task/task-verify-command.js";

type JsonRecord = Record<string, unknown>;

function parseOptionalBooleanOption(value: unknown, flagName: string): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === true || value === false) {
		return value;
	}
	if (typeof value !== "string") {
		throw new Error(`Invalid boolean value for ${flagName}. Use true or false.`);
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1" || normalized === "yes") {
		return true;
	}
	if (normalized === "false" || normalized === "0" || normalized === "no") {
		return false;
	}
	throw new Error(`Invalid boolean value for ${flagName}: "${value}". Use true or false.`);
}

async function runTaskCommand(handler: () => Promise<JsonRecord>): Promise<void> {
	try {
		const payload = await handler();
		printJson(payload);
		if (payload.ok === false) {
			process.exitCode = 1;
		}
	} catch (error) {
		printJson({
			ok: false,
			error: `Task command failed at ${getKanbanRuntimeOrigin()}: ${toErrorMessage(error)}`,
		});
		process.exitCode = 1;
	}
}

export function registerTaskCommand(program: Command): void {
	const task = program.command("task").alias("tasks").description("Manage !Klein board tasks from the CLI.");
	registerTaskReadCommands(task);
	registerTaskCrudCommands(task);
	registerTaskMergeAndSwarmCommands(task);
	registerTaskPlanCommands(task);
	registerTaskFinishCommands(task);
	registerTaskGraphCommands(task);
	registerTaskStartCommand(task);
}

function registerTaskReadCommands(task: Command): void {
	task
		.command("list")
		.description("List !Klein tasks for a workspace.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option(
			"--column <column>",
			"Filter column: backlog | planning | in_progress | review | done. trash is also accepted.",
			parseListColumn,
		)
		.action(async (options: { projectPath?: string; column?: ListTaskColumn }) => {
			await runTaskCommand(
				async () =>
					await listTasks({
						cwd: process.cwd(),
						projectPath: options.projectPath,
						column: options.column,
					}),
			);
		});

	task
		.command("health")
		.description("Show the operator board-health rollup (healthy/stuck/risky/done) and the risk/approval inbox.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { projectPath?: string }) => {
			await runTaskCommand(
				async () => await reportBoardHealth({ cwd: process.cwd(), projectPath: options.projectPath }),
			);
		});
}

function registerTaskCrudCommands(task: Command): void {
	task
		.command("create")
		.description("Create a task in backlog.")
		.option("--title <text>", "Task title.")
		.requiredOption("--prompt <text>", "Task prompt text.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--base-ref <branch>", "Task base branch/ref.")
		.option("--start-in-plan-mode [value]", "Set plan mode (true|false). Flag-only implies true.")
		.option("--auto-review-enabled [value]", "Enable auto-review behavior (true|false). Flag-only implies true.")
		.option("--auto-review-mode <mode>", "Auto-review mode: commit | pr.", parseAutoReviewMode)
		.option("--agent-id <id>", "Agent override: nklein | claude | codex | droid | gemini | opencode | default.")
		.option(
			"--nklein-provider <id>",
			'!Klein provider override (e.g. ollama, lmstudio, openai-compatible with a local endpoint). Use "default" for workspace default.',
		)
		.option(
			"--nklein-model <id>",
			'!Klein model override (e.g. qwen3.5:9b, llama3.1:8b). Use "default" for workspace default.',
		)
		.option(
			"--nklein-reasoning-effort <level>",
			"!Klein reasoning effort override: default | low | medium | high | xhigh.",
		)
		.action(
			async (options: {
				title?: string;
				prompt: string;
				projectPath?: string;
				baseRef?: string;
				startInPlanMode?: unknown;
				autoReviewEnabled?: unknown;
				autoReviewMode?: "commit" | "pr";
				agentId?: string;
				nkleinProvider?: string;
				nkleinModel?: string;
				nkleinReasoningEffort?: string;
			}) => {
				await runTaskCommand(
					async () =>
						await createTask({
							cwd: process.cwd(),
							title: options.title,
							prompt: options.prompt,
							projectPath: options.projectPath,
							baseRef: options.baseRef,
							startInPlanMode: parseOptionalBooleanOption(options.startInPlanMode, "--start-in-plan-mode"),
							autoReviewEnabled: parseOptionalBooleanOption(options.autoReviewEnabled, "--auto-review-enabled"),
							autoReviewMode: options.autoReviewMode,
							agentId: parseAgentId(options.agentId) ?? undefined,
							nkleinSettings: buildTaskNKleinSettingsForCreate({
								providerId: parseOptionalStringOrDefault(options.nkleinProvider) ?? undefined,
								modelId: parseOptionalStringOrDefault(options.nkleinModel) ?? undefined,
								reasoningEffort: parseTaskNKleinReasoningEffort(options.nkleinReasoningEffort),
							}),
						}),
				);
			},
		);

	task
		.command("seed-bulk")
		.description("Create N backlog cards from one template × an input list (F12.109 batch fan-out).")
		.requiredOption("--template <text>", "Prompt template; {input}, {i}, {slug} substitute per input.")
		.option("--title-template <text>", "Title template (same tokens). Defaults to {input}.")
		.option("--inputs <list>", "Inline inputs, comma or newline separated.")
		.option("--inputs-file <path>", "File with one input per line (# comments skipped).")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--base-ref <branch>", "Task base branch/ref.")
		.option("--dry-run", "Print the expanded plan without creating cards.")
		.action(
			async (options: {
				template: string;
				titleTemplate?: string;
				inputs?: string;
				inputsFile?: string;
				projectPath?: string;
				baseRef?: string;
				dryRun?: boolean;
			}) => {
				await runTaskCommand(async () => {
					const inputs = await resolveBulkInputs(options);
					const plan = planBulkSeed({
						promptTemplate: options.template,
						...(options.titleTemplate ? { titleTemplate: options.titleTemplate } : {}),
						inputs,
					});
					if (options.dryRun) {
						return { dryRun: true, cards: plan };
					}
					const created: Array<{ title: string }> = [];
					for (const entry of plan) {
						await createTask({
							cwd: process.cwd(),
							title: entry.title,
							prompt: entry.prompt,
							projectPath: options.projectPath,
							baseRef: options.baseRef,
						});
						created.push({ title: entry.title });
					}
					return { created: created.length, cards: created };
				});
			},
		);

	task
		.command("update")
		.description("Update an existing task.")
		.requiredOption("--task-id <id>", "Task ID.")
		.option("--title <text>", "Replacement task title.")
		.option("--prompt <text>", "Replacement task prompt.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--base-ref <branch>", "Replacement base branch/ref.")
		.option("--start-in-plan-mode [value]", "Set plan mode (true|false). Flag-only implies true.")
		.option("--auto-review-enabled [value]", "Enable auto-review behavior (true|false). Flag-only implies true.")
		.option("--auto-review-mode <mode>", "Auto-review mode: commit | pr.", parseAutoReviewMode)
		.option(
			"--agent-id <id>",
			'Agent override: nklein | claude | codex | droid | gemini | opencode. Use "default" to clear.',
		)
		.option(
			"--nklein-provider <id>",
			'!Klein provider override (e.g. ollama, lmstudio, openai-compatible with a local endpoint). Use "default" to clear.',
		)
		.option("--nklein-model <id>", '!Klein model override (e.g. qwen3.5:9b, llama3.1:8b). Use "default" to clear.')
		.option(
			"--nklein-reasoning-effort <level>",
			'!Klein reasoning effort override: default | low | medium | high | xhigh. Use "inherit" to clear.',
		)
		.action(
			async (options: {
				taskId: string;
				title?: string;
				prompt?: string;
				projectPath?: string;
				baseRef?: string;
				startInPlanMode?: unknown;
				autoReviewEnabled?: unknown;
				autoReviewMode?: "commit" | "pr";
				agentId?: string;
				nkleinProvider?: string;
				nkleinModel?: string;
				nkleinReasoningEffort?: string;
			}) => {
				await runTaskCommand(
					async () =>
						await updateTaskCommand({
							cwd: process.cwd(),
							taskId: options.taskId,
							title: options.title,
							projectPath: options.projectPath,
							prompt: options.prompt,
							baseRef: options.baseRef,
							startInPlanMode: parseOptionalBooleanOption(options.startInPlanMode, "--start-in-plan-mode"),
							autoReviewEnabled: parseOptionalBooleanOption(options.autoReviewEnabled, "--auto-review-enabled"),
							autoReviewMode: options.autoReviewMode,
							agentId: parseAgentId(options.agentId),
							nkleinProviderId: parseOptionalStringOrDefault(options.nkleinProvider),
							nkleinModelId: parseOptionalStringOrDefault(options.nkleinModel),
							nkleinReasoningEffort: parseTaskNKleinReasoningEffort(options.nkleinReasoningEffort),
						}),
				);
			},
		);
}

function registerTaskMergeAndSwarmCommands(task: Command): void {
	task
		.command("merge")
		.description("Merge reviewed task results into the base workspace in dependency order.")
		.option("--task-id <id>", "Single task ID to merge.")
		.option("--column <column>", "Column to merge: review | completed. Defaults to review.", parseAutoMergeColumn)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: TaskWorktreeAutoMergeColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await mergeTaskWorktreesCommand({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column ?? "review",
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("swarm-stop")
		.description("Set the workspace swarm stop signal so project task starts are blocked until resumed.")
		.option("--reason <text>", "Reason shown to blocked task starts.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { reason?: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await requestTaskSwarmStopCommand({
						cwd: process.cwd(),
						projectPath: options.projectPath,
						reason: options.reason,
					}),
			);
		});

	task
		.command("swarm-resume")
		.description("Clear the workspace swarm stop signal so project task starts can run again.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await clearTaskSwarmStopCommand({
						cwd: process.cwd(),
						projectPath: options.projectPath,
					}),
			);
		});
}

function registerTaskPlanCommands(task: Command): void {
	task
		.command("plan-gap")
		.description("Record a structured plan gap discovered while executing a task.")
		.requiredOption("--task-id <id>", "Task ID that discovered the gap.")
		.requiredOption(
			"--kind <kind>",
			"Gap kind: missing_decision | contradictory_requirement | missing_dependency | scope_too_large | integration_needed | other.",
			parsePlanGapKind,
		)
		.requiredOption("--description <text>", "Plain-language description of the blocking gap.")
		.option("--evidence <text>", "Optional evidence such as error text, missing path, or conflicting requirement.")
		.option(
			"--plan-slug <slug>",
			"Optional saved plan slug whose revisions.md should record this gap; inferred for decomposition-created task IDs when omitted.",
		)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(
			async (options: {
				taskId: string;
				kind: PlanGapKind;
				description: string;
				evidence?: string;
				planSlug?: string;
				projectPath?: string;
			}) => {
				await runTaskCommand(
					async () =>
						await recordTaskPlanGapCommand({
							cwd: process.cwd(),
							projectPath: options.projectPath,
							taskId: options.taskId,
							kind: options.kind,
							description: options.description,
							evidence: options.evidence,
							planSlug: options.planSlug,
						}),
				);
			},
		);

	task
		.command("expand-plan-task")
		.description("Apply approved replacement tasks to a saved plan DAG and re-link dependencies.")
		.requiredOption("--plan-slug <slug>", "Saved plan slug under .nklein/nklein/plans/<slug>.")
		.requiredOption("--task-id <id>", "Plan task ID to replace.")
		.requiredOption(
			"--replacements-json <json>",
			"JSON array of replacement plan tasks, usually copied from a validated expand_task result.",
		)
		.option("--description <text>", "Revision description. Defaults to a generated replacement summary.")
		.option("--evidence <text>", "Revision evidence. Defaults to entry/terminal replacement IDs.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(
			async (options: {
				planSlug: string;
				taskId: string;
				replacementsJson: string;
				description?: string;
				evidence?: string;
				projectPath?: string;
			}) => {
				await runTaskCommand(
					async () =>
						await expandSavedPlanTaskCommand({
							cwd: process.cwd(),
							projectPath: options.projectPath,
							planSlug: options.planSlug,
							taskId: options.taskId,
							replacementsJson: options.replacementsJson,
							description: options.description,
							evidence: options.evidence,
						}),
				);
			},
		);
}

function registerTaskFinishCommands(task: Command): void {
	task
		.command("done")
		.description("Move a task or an entire column to completed and clean up task workspaces.")
		.option("--task-id <id>", "Task ID.")
		.option(
			"--column <column>",
			"Column to move to completed: backlog | planning | in_progress | review | done. trash is also accepted.",
			parseListColumn,
		)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: ListTaskColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await finishTask({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column,
						targetColumn: "completed",
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("trash")
		.description("Move a task or an entire column to trash and clean up task workspaces.")
		.option("--task-id <id>", "Task ID.")
		.option(
			"--column <column>",
			"Column to move to trash: backlog | planning | in_progress | review | completed | done. trash is also accepted.",
			parseListColumn,
		)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: ListTaskColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await finishTask({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column,
						targetColumn: "trash",
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("delete")
		.description("Permanently delete a task or every task in a column.")
		.option("--task-id <id>", "Task ID to permanently delete.")
		.option(
			"--column <column>",
			"Column to bulk-delete: backlog | planning | in_progress | review | done. trash is also accepted.",
			parseListColumn,
		)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: ListTaskColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await deleteTaskCommand({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column,
						projectPath: options.projectPath,
					}),
			);
		});
}

function registerTaskGraphCommands(task: Command): void {
	task
		.command("link")
		.description("Link two tasks so one task waits on another.")
		.requiredOption("--task-id <id>", "One of the two task IDs to link.")
		.requiredOption("--linked-task-id <id>", "The other task ID to link.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.addHelpText(
			"after",
			[
				"",
				"Dependency direction:",
				"  If both linked tasks are in backlog, !Klein preserves the order you pass:",
				"  --task-id waits on --linked-task-id, and on the board the arrow points into",
				"  --linked-task-id.",
				"  Once only one linked task remains in backlog, !Klein reorients the saved link",
				"  so the backlog task is the waiting dependent task and the other task is the",
				"  prerequisite.",
				"  When the prerequisite finishes review and moves to done, the waiting backlog",
				"  task becomes ready to start.",
				"",
			].join("\n"),
		)
		.action(async (options: { taskId: string; linkedTaskId: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await linkTasks({
						cwd: process.cwd(),
						taskId: options.taskId,
						linkedTaskId: options.linkedTaskId,
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("decompose")
		.description("Create backlog tasks and dependency links from a saved !Klein plan task graph.")
		.requiredOption("--slug <slug>", "Plan slug under .nklein/nklein/plans/<slug>.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--base-ref <branch>", "Task base branch/ref. Defaults to the workspace branch.")
		.action(async (options: { slug: string; projectPath?: string; baseRef?: string }) => {
			await runTaskCommand(
				async () =>
					await decomposeTaskGraph({
						cwd: process.cwd(),
						slug: options.slug,
						projectPath: options.projectPath,
						baseRef: options.baseRef,
					}),
			);
		});

	task
		.command("verify")
		.description("Run the task's embedded Acceptance check in its task workspace.")
		.requiredOption("--task-id <id>", "Task ID.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--workspace-root", "Run the acceptance check in the workspace root instead of the task workspace.")
		.option("--timeout-ms <ms>", "Acceptance command timeout in milliseconds.", (value: string) => {
			const timeoutMs = Number(value);
			if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
				throw new Error("Invalid timeout. Expected a positive integer number of milliseconds.");
			}
			return timeoutMs;
		})
		.option("--repair-attempt <n>", "Repair attempt number to include in failure guidance.", (value: string) => {
			const attempt = Number(value);
			if (!Number.isInteger(attempt) || attempt <= 0) {
				throw new Error("Invalid repair attempt. Expected a positive integer.");
			}
			return attempt;
		})
		.option("--max-repair-attempts <n>", "Maximum repair attempts before escalation guidance.", (value: string) => {
			const maxAttempts = Number(value);
			if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
				throw new Error("Invalid max repair attempts. Expected a positive integer.");
			}
			return maxAttempts;
		})
		.action(
			async (options: {
				taskId: string;
				projectPath?: string;
				workspaceRoot?: boolean;
				timeoutMs?: number;
				repairAttempt?: number;
				maxRepairAttempts?: number;
			}) => {
				await runTaskCommand(
					async () =>
						await runVerifyTaskAcceptanceCommand({
							cwd: process.cwd(),
							taskId: options.taskId,
							projectPath: options.projectPath,
							workspaceRoot: options.workspaceRoot === true,
							timeoutMs: options.timeoutMs,
							repairAttempt: options.repairAttempt,
							maxRepairAttempts: options.maxRepairAttempts,
						}),
				);
			},
		);

	task
		.command("unlink")
		.description("Remove an existing dependency link.")
		.requiredOption("--dependency-id <id>", "Dependency ID.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { dependencyId: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await unlinkTasks({
						cwd: process.cwd(),
						dependencyId: options.dependencyId,
						projectPath: options.projectPath,
					}),
			);
		});
}

function registerTaskStartCommand(task: Command): void {
	task
		.command("start")
		.description("Start a task session and move task to Planning or In Progress.")
		.requiredOption("--task-id <id>", "Task ID.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await startTask({
						cwd: process.cwd(),
						taskId: options.taskId,
						projectPath: options.projectPath,
					}),
			);
		});
}
