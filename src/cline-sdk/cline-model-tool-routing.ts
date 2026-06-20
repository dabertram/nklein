import type { ClineSdkStartSessionInput } from "./sdk-runtime-boundary";

type ToolRoutingRule = NonNullable<ClineSdkStartSessionInput["config"]["toolRoutingRules"]>[number];

export const SMALL_LOCAL_MODEL_MARKERS = [
	"qwen",
	"llama",
	"mistral",
	"mixtral",
	"phi",
	"gemma",
	"deepseek-coder",
	"codellama",
];

/** True when the model id matches a known small/local family, used to apply conservative defaults. */
export function isSmallLocalModelId(modelId: string | null | undefined): boolean {
	const id = modelId?.trim().toLowerCase();
	if (!id) {
		return false;
	}
	return SMALL_LOCAL_MODEL_MARKERS.some((marker) => id.includes(marker));
}

const SMALL_LOCAL_MODEL_DISABLED_TOOLS: NonNullable<ToolRoutingRule["disableTools"]> = [
	"fetch_web_content",
	"skills",
	"ask_question",
	"editor",
];

export function buildKanbanModelToolRoutingRules(): ToolRoutingRule[] {
	// Cline core currently resolves omitted maxParallelToolCalls to sequential
	// execution; keep this rule focused on typed SDK tool selection.
	return [
		{
			name: "kanban-small-local-model-tool-trim",
			mode: "any",
			modelIdIncludes: SMALL_LOCAL_MODEL_MARKERS,
			disableTools: SMALL_LOCAL_MODEL_DISABLED_TOOLS,
		},
	];
}
