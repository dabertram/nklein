import type { AgentSandboxManager } from "./nklein-agent-sandbox";
import { createEditFileTool } from "./nklein-edit-file-tool";
import { createFileDiscoveryTools } from "./nklein-file-discovery-tools";
import { createReadLargeFileTool, releaseNKleinLargeFileWorkflow } from "./nklein-large-file-workflow";
import { createNKleinRetrievalTools } from "./nklein-retrieval-tools";
import { createWriteFilesTool, createWriteFileTool } from "./nklein-write-files-tool";
import type { AgentTool } from "./sdk-agent-types";

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
		...createNKleinRetrievalTools({ workspacePath: definitionWorkspacePath }),
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
		createEditFileTool({
			workspacePath: definitionWorkspacePath,
			maxFileLines: options.maxFileLines,
		}),
	];
	releaseNKleinLargeFileWorkflow(readLargeFileDefinitionSessionId);
	return tools.map((tool) => proxySandboxTool(tool, manager, taskId, options));
}
