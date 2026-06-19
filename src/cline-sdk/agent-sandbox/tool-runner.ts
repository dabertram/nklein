import { createDefaultExecutors, type ToolExecutors } from "@clinebot/core";
import type { AgentToolContext } from "@clinebot/shared";

type SandboxBashInput = Parameters<NonNullable<ToolExecutors["bash"]>>[0];
type SandboxReadFileInput = Parameters<NonNullable<ToolExecutors["readFile"]>>[0];
type SandboxEditorInput = Parameters<NonNullable<ToolExecutors["editor"]>>[0];
type SandboxApplyPatchInput = Parameters<NonNullable<ToolExecutors["applyPatch"]>>[0];

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
