import { createDefaultExecutors, type ToolExecutors } from "@clinebot/core";
import type { AgentToolContext } from "@clinebot/shared";
import { AGENT_SANDBOX_EXTRA_TOOL_RUNNER } from "../cline-agent-sandbox-extra-tools";
import { createFileDiscoveryTools } from "../cline-file-discovery-tools";
import { createReadLargeFileTool } from "../cline-large-file-workflow";
import { createClineRetrievalTools } from "../cline-retrieval-tools";
import { createWriteFilesTool, createWriteFileTool } from "../cline-write-files-tool";

type SandboxBashInput = Parameters<NonNullable<ToolExecutors["bash"]>>[0];
type SandboxReadFileInput = Parameters<NonNullable<ToolExecutors["readFile"]>>[0];
type SandboxEditorInput = Parameters<NonNullable<ToolExecutors["editor"]>>[0];
type SandboxApplyPatchInput = Parameters<NonNullable<ToolExecutors["applyPatch"]>>[0];

interface SandboxKanbanExtraToolInput {
	toolName: string;
	input: unknown;
	sessionId: string;
	contextWindow: number | null;
	maxFileLines: number | null;
}

interface ToolRunnerSuccess {
	ok: true;
	result: unknown;
}

interface ToolRunnerFailure {
	ok: false;
	error: string;
}

type ToolRunnerResult = ToolRunnerSuccess | ToolRunnerFailure;

const tool = process.argv[2]?.trim();
const rawInput = process.argv[3] ?? "null";

function parseInput(): unknown {
	try {
		return JSON.parse(rawInput) as unknown;
	} catch (error) {
		throw new Error(`Invalid sandbox tool input JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function parseKanbanExtraToolInput(input: unknown): SandboxKanbanExtraToolInput {
	if (!input || typeof input !== "object") {
		throw new Error("Sandbox kanbanExtraTool requires an object input.");
	}
	const record = input as Record<string, unknown>;
	const toolName = typeof record.toolName === "string" ? record.toolName.trim() : "";
	const sessionId = typeof record.sessionId === "string" ? record.sessionId.trim() : "";
	if (!toolName || !sessionId) {
		throw new Error("Sandbox kanbanExtraTool requires toolName and sessionId.");
	}
	const contextWindow =
		typeof record.contextWindow === "number" && Number.isFinite(record.contextWindow)
			? Math.trunc(record.contextWindow)
			: null;
	const maxFileLines =
		typeof record.maxFileLines === "number" && Number.isFinite(record.maxFileLines)
			? Math.trunc(record.maxFileLines)
			: null;
	return {
		toolName,
		input: record.input,
		sessionId,
		contextWindow,
		maxFileLines,
	};
}

async function runKanbanExtraTool(input: unknown, cwd: string): Promise<unknown> {
	const request = parseKanbanExtraToolInput(input);
	const context: AgentToolContext = {
		agentId: "nklein-sandbox-extra-tool-runner",
		iteration: 0,
	};
	const tools = [
		...createClineRetrievalTools({ workspacePath: cwd }),
		...createFileDiscoveryTools({ workspacePath: cwd, contextWindow: request.contextWindow }),
		createReadLargeFileTool({
			sessionId: request.sessionId,
			workspacePath: cwd,
			contextWindow: request.contextWindow,
			storageRoot: "/tmp/nklein-large-file-workflows",
		}),
		createWriteFilesTool({ workspacePath: cwd, maxFileLines: request.maxFileLines }),
		createWriteFileTool({ workspacePath: cwd, maxFileLines: request.maxFileLines }),
	];
	const selectedTool = tools.find((candidate) => candidate.name === request.toolName);
	if (!selectedTool) {
		throw new Error(`Unsupported sandbox !Klein tool: ${request.toolName}.`);
	}
	return await selectedTool.execute(request.input, context);
}

async function runTool(): Promise<ToolRunnerResult> {
	if (!tool) {
		return { ok: false, error: "Missing sandbox tool name." };
	}
	const input = parseInput();
	const executors = createDefaultExecutors();
	const cwd = process.cwd();
	const context: AgentToolContext = {
		agentId: "nklein-sandbox-tool-runner",
		iteration: 0,
	};
	switch (tool) {
		case "bash":
			return {
				ok: true,
				result: await executors.bash?.(input as SandboxBashInput, cwd, context),
			};
		case "readFile":
			return {
				ok: true,
				result: await executors.readFile?.(input as SandboxReadFileInput, context),
			};
		case "search":
			return {
				ok: true,
				result: await executors.search?.(String(input), cwd, context),
			};
		case "editor":
			return {
				ok: true,
				result: await executors.editor?.(input as SandboxEditorInput, cwd, context),
			};
		case "applyPatch":
			return {
				ok: true,
				result: await executors.applyPatch?.(input as SandboxApplyPatchInput, cwd, context),
			};
		case AGENT_SANDBOX_EXTRA_TOOL_RUNNER:
			return {
				ok: true,
				result: await runKanbanExtraTool(input, cwd),
			};
		default:
			return { ok: false, error: `Unsupported sandbox tool: ${tool}.` };
	}
}

try {
	const result = await runTool();
	process.stdout.write(JSON.stringify(result));
	process.stdout.write("\n");
	if (!result.ok) {
		process.exitCode = 1;
	}
} catch (error) {
	const failure: ToolRunnerFailure = {
		ok: false,
		error: error instanceof Error ? error.message : String(error),
	};
	process.stdout.write(JSON.stringify(failure));
	process.stdout.write("\n");
	process.exitCode = 1;
}
