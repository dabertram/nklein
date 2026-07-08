import { selectPhaseManifestTools } from "../core/manifest-phase-gate";
import { type RunPhase, runPhasePolicy } from "../core/run-state-machine";
import { manifestForChatAction, type ToolCapabilityManifest } from "../core/tool-capability-manifest";
import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
import type { ChatTool } from "./chat-tool-executor";

export interface ChatPhaseToolPlan {
	phase: RunPhase;
	tools: ChatTool[];
	definitions: LocalLlmToolDefinition[];
	offeredToolNames: string[];
	maxIterations: number;
}

interface ManifestedChatTool {
	tool: ChatTool;
	manifest: ToolCapabilityManifest;
}

export function buildChatPhaseToolPlan(input: {
	phase: RunPhase;
	tools: readonly ChatTool[];
	definitions: readonly LocalLlmToolDefinition[];
}): ChatPhaseToolPlan {
	const policy = runPhasePolicy(input.phase);
	const manifestedTools: ManifestedChatTool[] = input.tools.map((tool) => ({
		tool,
		manifest: manifestForChatAction(tool.actionKind),
	}));
	const selectedTools =
		policy.maxToolCalls > 0 ? selectPhaseManifestTools(input.phase, manifestedTools).map(({ tool }) => tool) : [];
	const selectedToolNames = new Set(selectedTools.map((tool) => tool.name));
	const selectedDefinitions = input.definitions.filter((definition) => selectedToolNames.has(definition.name));

	return {
		phase: input.phase,
		tools: selectedTools,
		definitions: selectedDefinitions,
		offeredToolNames: selectedDefinitions.map((definition) => definition.name),
		maxIterations: policy.maxToolCalls,
	};
}
