import type { ClineSdkStartSessionInput } from "./sdk-runtime-boundary";

type ToolRoutingRule = NonNullable<ClineSdkStartSessionInput["config"]["toolRoutingRules"]>[number];

const SMALL_LOCAL_MODEL_MARKERS = [
	"qwen",
	"llama",
	"mistral",
	"mixtral",
	"phi",
	"gemma",
	"deepseek-coder",
	"codellama",
];

const SMALL_LOCAL_MODEL_DISABLED_TOOLS: NonNullable<ToolRoutingRule["disableTools"]> = [
	"fetch_web_content",
	"skills",
	"ask_question",
	"editor",
];

export function buildKanbanModelToolRoutingRules(): ToolRoutingRule[] {
	return [
		{
			name: "kanban-small-local-model-tool-trim",
			mode: "any",
			modelIdIncludes: SMALL_LOCAL_MODEL_MARKERS,
			disableTools: SMALL_LOCAL_MODEL_DISABLED_TOOLS,
		},
	];
}
