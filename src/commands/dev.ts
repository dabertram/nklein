import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { buildClineAdvisorRequest, type ClineAdvisorKind } from "../cline-sdk/cline-advisor";
import { writeClineDogfoodBacklog } from "../cline-sdk/cline-dogfood-engine";
import { runClineDevSmokeEval } from "../cline-sdk/cline-eval-harness";
import { buildClineModelFreshnessAdvisorRequest } from "../cline-sdk/cline-model-research";
import { resolveProjectInputPath } from "../projects/project-path";

interface DevSmokeEvalOptions {
	json?: boolean;
	parentDir?: string;
	evidenceRoot?: string;
	git?: boolean;
	write?: (text: string) => void;
}

interface DevDogfoodBacklogOptions {
	json?: boolean;
	projectPath?: string;
	telemetryRoot?: string;
	slug?: string;
	suggestion?: string;
	write?: (text: string) => void;
	cwd?: string;
}

interface DevAdvisorPromptOptions {
	json?: boolean;
	kind: ClineAdvisorKind;
	workspacePath?: string;
	repoSummary?: string;
	modelRegistrySummary?: string;
	runtimeConfigSummary?: string;
	telemetrySummary?: string;
	taskSummary?: string;
	userQuestion?: string;
	write?: (text: string) => void;
}

const DEFAULT_TELEMETRY_ROOT = join(homedir(), ".cline", "kanban", "telemetry");

function parseAdvisorKind(value: string): ClineAdvisorKind {
	if (
		value === "model_freshness" ||
		value === "mcp_discovery" ||
		value === "config_explainer" ||
		value === "log_analysis" ||
		value === "task_failure"
	) {
		return value;
	}
	throw new Error(
		"Invalid advisor kind. Expected one of: model_freshness, mcp_discovery, config_explainer, log_analysis, task_failure.",
	);
}

export async function runDevSmokeEvalCommand(options: DevSmokeEvalOptions = {}): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const result = await runClineDevSmokeEval({
		parentDir: options.parentDir,
		evidenceRootDir: options.evidenceRoot,
		initializeGit: options.git !== false,
	});
	if (options.json) {
		write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	write(`${result.passed ? "Dev smoke eval passed." : "Dev smoke eval failed."}\n`);
	write(`Workspace: ${result.workspacePath}\n`);
	write(`Evidence: ${result.evidenceBundlePath}\n`);
	write(`Command: ${result.acceptanceCommand}\n`);
	if (!result.passed && result.output.trim()) {
		write(`${result.output.trim()}\n`);
	}
}

export async function runDevDogfoodBacklogCommand(options: DevDogfoodBacklogOptions = {}): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const cwd = options.cwd ?? process.cwd();
	const workspacePath = resolveProjectInputPath(options.projectPath ?? cwd, cwd);
	const result = await writeClineDogfoodBacklog({
		workspacePath,
		telemetryRootDir: options.telemetryRoot ?? DEFAULT_TELEMETRY_ROOT,
		slug: options.slug,
		userSuggestions: options.suggestion ? [options.suggestion] : undefined,
	});
	if (options.json) {
		write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	write("Dogfood backlog artifacts written.\n");
	write(`Plan: ${result.rootPath}\n`);
	write(`Tasks: ${result.taskGraph.tasks.length}\n`);
	write(`Next: task decompose --slug ${result.taskGraph.slug} --project-path ${workspacePath}\n`);
}

export async function runDevAdvisorPromptCommand(options: DevAdvisorPromptOptions): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const request = buildClineAdvisorRequest(options.kind, {
		workspacePath: options.workspacePath,
		repoSummary: options.repoSummary,
		modelRegistrySummary: options.modelRegistrySummary,
		runtimeConfigSummary: options.runtimeConfigSummary,
		telemetrySummary: options.telemetrySummary,
		taskSummary: options.taskSummary,
		userQuestion: options.userQuestion,
	});
	if (options.json) {
		write(`${JSON.stringify(request, null, 2)}\n`);
		return;
	}
	write(`# ${request.title}\n\n${request.prompt}\n`);
}

export async function runDevCheckModelsCommand(
	options: { json?: boolean; write?: (text: string) => void } = {},
): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const request = await buildClineModelFreshnessAdvisorRequest();
	if (options.json) {
		write(`${JSON.stringify(request, null, 2)}\n`);
		return;
	}
	write(`# ${request.title}\n\n${request.prompt}\n`);
}

export function registerDevCommand(program: Command): void {
	const dev = program.command("dev").description("Developer-only Kanban diagnostics and smoke tests.");

	dev.command("smoke-eval")
		.description("Run the bundled dev smoke eval and write an evidence bundle.")
		.option("--json", "Print machine-readable JSON.")
		.option("--parent-dir <path>", "Parent directory for the throwaway workspace.")
		.option("--evidence-root <path>", "Directory for evidence bundles.")
		.option("--no-git", "Skip git initialization in the throwaway workspace.")
		.action(async (options: DevSmokeEvalOptions) => {
			await runDevSmokeEvalCommand(options);
		});

	dev.command("dogfood-backlog")
		.description("Generate dogfood improvement plan artifacts from local self-observation telemetry.")
		.option("--json", "Print machine-readable JSON.")
		.option("--project-path <path>", "Kanban repo path where .cline/kanban/plans should be written.")
		.option("--telemetry-root <path>", "Telemetry JSONL root. Defaults to ~/.cline/kanban/telemetry.")
		.option("--slug <slug>", "Plan slug under .cline/kanban/plans/<slug>.")
		.option("--suggestion <text>", "Seed the dogfood backlog with a user-described improvement.")
		.action(async (options: DevDogfoodBacklogOptions) => {
			await runDevDogfoodBacklogCommand(options);
		});

	dev.command("advisor-prompt")
		.description("Build a user-triggered advisor prompt for model, MCP, config, log, or task help.")
		.requiredOption(
			"--kind <kind>",
			"Advisor kind: model_freshness | mcp_discovery | config_explainer | log_analysis | task_failure.",
			parseAdvisorKind,
		)
		.option("--json", "Print machine-readable JSON.")
		.option("--workspace-path <path>", "Workspace path context.")
		.option("--repo-summary <text>", "Repo summary context.")
		.option("--model-registry-summary <text>", "Model registry context.")
		.option("--runtime-config-summary <text>", "Runtime config context.")
		.option("--telemetry-summary <text>", "Telemetry/log summary context.")
		.option("--task-summary <text>", "Task-specific context.")
		.option("--user-question <text>", "User question or pain point.")
		.action(async (options: DevAdvisorPromptOptions) => {
			await runDevAdvisorPromptCommand(options);
		});

	dev.command("check-models")
		.description("Build a user-triggered model freshness advisor prompt from the local model registry.")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevCheckModelsCommand(options);
		});
}
