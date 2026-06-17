export type ClineAdvisorKind =
	| "model_freshness"
	| "mcp_discovery"
	| "config_explainer"
	| "log_analysis"
	| "task_failure";

export interface ClineAdvisorContext {
	workspacePath?: string | null;
	repoSummary?: string | null;
	modelRegistrySummary?: string | null;
	runtimeConfigSummary?: string | null;
	telemetrySummary?: string | null;
	taskSummary?: string | null;
	userQuestion?: string | null;
}

export interface ClineAdvisorRequest {
	kind: ClineAdvisorKind;
	title: string;
	prompt: string;
	requiresWebResearch: boolean;
	recommendedSources: string[];
}

const MODEL_FRESHNESS_SOURCES = [
	"https://artificialanalysis.ai/",
	"https://llm-stats.com/",
	"https://openrouter.ai/models",
];
const MCP_DISCOVERY_SOURCES = [
	"https://mcp.so/",
	"https://smithery.ai/",
	"https://glama.ai/mcp",
	"https://github.com/punkpeye/awesome-mcp-servers",
];

function clean(value: string | null | undefined): string {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : "Not provided.";
}

function contextBlock(context: ClineAdvisorContext): string {
	return [
		`Workspace: ${clean(context.workspacePath)}`,
		`Repo summary: ${clean(context.repoSummary)}`,
		`Model registry: ${clean(context.modelRegistrySummary)}`,
		`Runtime config: ${clean(context.runtimeConfigSummary)}`,
		`Telemetry: ${clean(context.telemetrySummary)}`,
		`Task: ${clean(context.taskSummary)}`,
		`User question: ${clean(context.userQuestion)}`,
	].join("\n");
}

function buildPrompt(input: {
	kind: ClineAdvisorKind;
	instruction: string;
	context: ClineAdvisorContext;
	sources: readonly string[];
}): string {
	const sourceLines =
		input.sources.length > 0
			? ["Recommended sources:", ...input.sources.map((source) => `- ${source}`)].join("\n")
			: "Recommended sources: none.";
	return [
		"You are Kanban's on-demand advisor. This is user-triggered guidance only; do not apply changes, install tools, or start background work.",
		"",
		input.instruction,
		"",
		sourceLines,
		"",
		"Context:",
		contextBlock(input.context),
		"",
		"Return concise recommendations with evidence, trade-offs, and explicit next steps. If evidence is missing, say what should be checked instead of guessing.",
	].join("\n");
}

export function buildClineAdvisorRequest(kind: ClineAdvisorKind, context: ClineAdvisorContext): ClineAdvisorRequest {
	if (kind === "model_freshness") {
		return {
			kind,
			title: "Check For Better Models",
			requiresWebResearch: true,
			recommendedSources: MODEL_FRESHNESS_SOURCES,
			prompt: buildPrompt({
				kind,
				context,
				sources: MODEL_FRESHNESS_SOURCES,
				instruction:
					"Compare the connected model roster against current model leaderboards and provider catalogs. Recommend per-role swaps only when a comparable model appears materially better for coding, speed, context, price, or local runnability.",
			}),
		};
	}
	if (kind === "mcp_discovery") {
		return {
			kind,
			title: "Find Useful MCP Plugins",
			requiresWebResearch: true,
			recommendedSources: MCP_DISCOVERY_SOURCES,
			prompt: buildPrompt({
				kind,
				context,
				sources: MCP_DISCOVERY_SOURCES,
				instruction:
					"Research MCP servers relevant to this project. Include trust signals such as maintenance, auth, permissions, popularity, and risk. Never recommend automatic installation.",
			}),
		};
	}
	if (kind === "config_explainer") {
		return {
			kind,
			title: "Explain This Config",
			requiresWebResearch: false,
			recommendedSources: [],
			prompt: buildPrompt({
				kind,
				context,
				sources: [],
				instruction:
					"Explain the runtime configuration and suggest conservative improvements for model roles, context scope, timeouts, and auto-review behavior.",
			}),
		};
	}
	if (kind === "log_analysis") {
		return {
			kind,
			title: "Analyze Kanban Logs",
			requiresWebResearch: false,
			recommendedSources: [],
			prompt: buildPrompt({
				kind,
				context,
				sources: [],
				instruction:
					"Analyze the provided logs and telemetry for likely causes of failures, stalls, slowdowns, or configuration mistakes. Prioritize high-confidence explanations.",
			}),
		};
	}
	return {
		kind,
		title: "Explain Task Failure",
		requiresWebResearch: false,
		recommendedSources: [],
		prompt: buildPrompt({
			kind,
			context,
			sources: [],
			instruction:
				"Explain why this task failed or stalled using the task summary, transcript clues, verification output, and telemetry. Suggest the smallest next recovery step.",
		}),
	};
}
