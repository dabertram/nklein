import type { NKleinSdkStartSessionInput } from "./sdk-runtime-boundary";

type ToolRoutingRule = NonNullable<NKleinSdkStartSessionInput["config"]["toolRoutingRules"]>[number];

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

/**
 * True for aimock simulator replay models (`sim/…`). A replay model's "capability" is its RECORDING: it will call
 * exactly the tools the recorded session called, so capability-based trims/defaults keyed off the recorded family
 * name in the id (e.g. `sim/qwen-fast-coder` matching the "qwen" marker) are false positives — trimming its
 * toolset manufactures unavailable-tool runtime errors the recorded run never had (N5 must_stay_quiet, sets 01/05).
 */
export function isSimulatorReplayModelId(modelId: string | null | undefined): boolean {
	return modelId?.trim().toLowerCase().startsWith("sim/") ?? false;
}

/** True when the model id matches a known small/local family, used to apply conservative defaults. */
export function isSmallLocalModelId(modelId: string | null | undefined): boolean {
	const id = modelId?.trim().toLowerCase();
	if (!id) {
		return false;
	}
	if (isSimulatorReplayModelId(id)) {
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

export function buildKanbanModelToolRoutingRules(sessionModelId?: string | null): ToolRoutingRule[] {
	// Simulator replay sessions get NO capability trims: the SDK rule matcher only supports include-markers, and
	// `sim/qwen-fast-coder` would match "qwen" — see isSimulatorReplayModelId for why that false positive matters.
	if (isSimulatorReplayModelId(sessionModelId)) {
		return [];
	}
	// NKlein core currently resolves omitted maxParallelToolCalls to sequential
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
