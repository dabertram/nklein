import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { buildNKleinAdvisorRequest, type NKleinAdvisorKind } from "../nklein-sdk/nklein-advisor";
import { writeNKleinDogfoodBacklog } from "../nklein-sdk/nklein-dogfood-engine";
import { runNKleinDevSmokeEval } from "../nklein-sdk/nklein-eval-harness";
import { assertLocalProviderAllowed } from "../nklein-sdk/nklein-local-only-policy";
import { buildNKleinModelFreshnessAdvisorRequest } from "../nklein-sdk/nklein-model-research";
import { resolveProjectInputPath } from "../projects/project-path";

interface DevSmokeEvalOptions {
	json?: boolean;
	parentDir?: string;
	evidenceRoot?: string;
	telemetryRoot?: string;
	git?: boolean;
	providerId?: string;
	modelId?: string;
	endpoint?: string;
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
	kind: NKleinAdvisorKind;
	workspacePath?: string;
	repoSummary?: string;
	modelRegistrySummary?: string;
	runtimeConfigSummary?: string;
	telemetrySummary?: string;
	taskSummary?: string;
	userQuestion?: string;
	write?: (text: string) => void;
}

type DevAdvisorShortcutOptions = Omit<DevAdvisorPromptOptions, "kind">;

const DEFAULT_TELEMETRY_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "telemetry");

function buildDevSmokeEvalModelObservation(options: DevSmokeEvalOptions) {
	const providerId = options.providerId?.trim();
	const modelId = options.modelId?.trim();
	const endpoint = options.endpoint?.trim();
	if (!providerId && !modelId && !endpoint) {
		return undefined;
	}
	if (!providerId || !modelId) {
		throw new Error("--provider-id and --model-id are required together when recording smoke eval capability.");
	}
	assertLocalProviderAllowed({ providerId, baseUrl: endpoint || null });
	return {
		providerId,
		modelId,
		endpoint: endpoint || undefined,
	};
}

function parseAdvisorKind(value: string): NKleinAdvisorKind {
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
	const result = await runNKleinDevSmokeEval({
		parentDir: options.parentDir,
		evidenceRootDir: options.evidenceRoot,
		telemetryRootDir: options.telemetryRoot ?? DEFAULT_TELEMETRY_ROOT,
		initializeGit: options.git !== false,
		modelObservation: buildDevSmokeEvalModelObservation(options),
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
	const result = await writeNKleinDogfoodBacklog({
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
	const request = buildNKleinAdvisorRequest(options.kind, {
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

export async function runDevAdvisorShortcutCommand(
	kind: NKleinAdvisorKind,
	options: DevAdvisorShortcutOptions = {},
): Promise<void> {
	await runDevAdvisorPromptCommand({
		...options,
		kind,
	});
}

export async function runDevCheckModelsCommand(
	options: { json?: boolean; write?: (text: string) => void } = {},
): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const request = await buildNKleinModelFreshnessAdvisorRequest();
	if (options.json) {
		write(`${JSON.stringify(request, null, 2)}\n`);
		return;
	}
	write(`# ${request.title}\n\n${request.prompt}\n`);
}

export function registerDevCommand(program: Command): void {
	const dev = program.command("dev").description("Developer-only !Klein diagnostics and smoke tests.");

	const addAdvisorContextOptions = (command: ReturnType<Command["command"]>) => {
		return command
			.option("--json", "Print machine-readable JSON.")
			.option("--workspace-path <path>", "Workspace path context.")
			.option("--repo-summary <text>", "Repo summary context.")
			.option("--model-registry-summary <text>", "Model registry context.")
			.option("--runtime-config-summary <text>", "Runtime config context.")
			.option("--telemetry-summary <text>", "Telemetry/log summary context.")
			.option("--task-summary <text>", "Task-specific context.")
			.option("--user-question <text>", "User question or pain point.");
	};

	dev.command("smoke-eval")
		.description("Run the bundled dev smoke eval and write an evidence bundle.")
		.option("--json", "Print machine-readable JSON.")
		.option("--parent-dir <path>", "Parent directory for the throwaway workspace.")
		.option("--evidence-root <path>", "Directory for evidence bundles.")
		.option("--telemetry-root <path>", "Telemetry JSONL root to include guard/overflow/timeout signals.")
		.option("--no-git", "Skip git initialization in the throwaway workspace.")
		.option("--provider-id <id>", "Provider id to score in the model capability registry.")
		.option("--model-id <id>", "Model id to score in the model capability registry.")
		.option("--endpoint <url>", "Optional model endpoint to score in the model capability registry.")
		.action(async (options: DevSmokeEvalOptions) => {
			await runDevSmokeEvalCommand(options);
		});

	dev.command("dogfood-backlog")
		.description("Generate dogfood improvement plan artifacts from local self-observation telemetry.")
		.option("--json", "Print machine-readable JSON.")
		.option("--project-path <path>", "!Klein repo path where .nklein/nklein/plans should be written.")
		.option("--telemetry-root <path>", "Telemetry JSONL root. Defaults to ~/.nklein/nklein/telemetry.")
		.option("--slug <slug>", "Plan slug under .nklein/nklein/plans/<slug>.")
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

	addAdvisorContextOptions(
		dev.command("find-mcp-plugins").description("Build a user-triggered MCP discovery prompt."),
	).action(async (options: DevAdvisorShortcutOptions) => {
		await runDevAdvisorShortcutCommand("mcp_discovery", options);
	});

	addAdvisorContextOptions(
		dev.command("explain-config").description("Build a user-triggered runtime config advisor prompt."),
	).action(async (options: DevAdvisorShortcutOptions) => {
		await runDevAdvisorShortcutCommand("config_explainer", options);
	});

	addAdvisorContextOptions(
		dev.command("analyze-logs").description("Build a user-triggered !Klein logs advisor prompt."),
	).action(async (options: DevAdvisorShortcutOptions) => {
		await runDevAdvisorShortcutCommand("log_analysis", options);
	});

	addAdvisorContextOptions(
		dev.command("explain-task-failure").description("Build a user-triggered task failure advisor prompt."),
	).action(async (options: DevAdvisorShortcutOptions) => {
		await runDevAdvisorShortcutCommand("task_failure", options);
	});

	dev.command("check-models")
		.description("Build a user-triggered model freshness advisor prompt from the local model registry.")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevCheckModelsCommand(options);
		});
}
