import type { AgentTool } from "@clinebot/shared";
import type { AgentSandboxManager } from "./cline-agent-sandbox";
import { createFileDiscoveryTools } from "./cline-file-discovery-tools";
import { createReadLargeFileTool, releaseClineLargeFileWorkflow } from "./cline-large-file-workflow";
import { createClineRetrievalTools } from "./cline-retrieval-tools";
import { createWriteFilesTool, createWriteFileTool } from "./cline-write-files-tool";

export const AGENT_SANDBOX_EXTRA_TOOL_RUNNER = "kanbanExtraTool";

export interface AgentSandboxExtraToolOptions {
	sessionId: string;
	contextWindow?: number | null;
	maxFileLines?: number | null;
}

function parseSandboxToolResult(result: string): unknown {
	try {
		return JSON.parse(result) as unknown;
	} catch {
		return result;
	}
}

function proxySandboxTool(
	tool: AgentTool,
	manager: AgentSandboxManager,
	taskId: string,
	options: AgentSandboxExtraToolOptions,
): AgentTool {
	return {
		...tool,
		async execute(input) {
			const result = await manager.runTool(taskId, AGENT_SANDBOX_EXTRA_TOOL_RUNNER, {
				toolName: tool.name,
				input,
				sessionId: options.sessionId,
				contextWindow: options.contextWindow ?? null,
				maxFileLines: options.maxFileLines ?? null,
			});
			return parseSandboxToolResult(result);
		},
	};
}

export function createAgentSandboxExtraTools(
	manager: AgentSandboxManager,
	taskId: string,
	options: AgentSandboxExtraToolOptions,
): AgentTool[] {
	const definitionWorkspacePath = "/";
	const readLargeFileDefinitionSessionId = `${options.sessionId}-sandbox-definition`;
	const tools = [
		...createClineRetrievalTools({ workspacePath: definitionWorkspacePath }),
		...createFileDiscoveryTools({
			workspacePath: definitionWorkspacePath,
			contextWindow: options.contextWindow,
		}),
		createReadLargeFileTool({
			sessionId: readLargeFileDefinitionSessionId,
			workspacePath: definitionWorkspacePath,
			contextWindow: options.contextWindow,
			storageRoot: "/tmp/nklein-sandbox-definition",
		}),
		createWriteFilesTool({
			workspacePath: definitionWorkspacePath,
			maxFileLines: options.maxFileLines,
		}),
		createWriteFileTool({
			workspacePath: definitionWorkspacePath,
			maxFileLines: options.maxFileLines,
		}),
	];
	releaseClineLargeFileWorkflow(readLargeFileDefinitionSessionId);
	return tools.map((tool) => proxySandboxTool(tool, manager, taskId, options));
}
