import { assertLocalModelBaseUrl } from "../core/local-model-base-url";
import {
	buildTerminalBenchAgentSystemPrompt,
	formatTerminalBenchExecResult,
	parseTerminalBenchAgentConfig,
	parseTerminalBenchExecRequest,
	type TerminalBenchAgentConfig,
	type TerminalBenchExecRequest,
	type TerminalBenchExecResult,
} from "../core/terminal-bench-agent";
import { createInMemoryNKleinSessionRuntime } from "./nklein-session-runtime";
import type { NKleinSessionRuntime } from "./nklein-session-runtime-types";
import type { AgentTool } from "./sdk-agent-types";

export interface TerminalBenchEnvironmentRpc {
	exec(request: TerminalBenchExecRequest): Promise<TerminalBenchExecResult>;
}

export interface TerminalBenchSessionResult {
	sessionId: string;
	result: unknown;
	submittedSummary: string | null;
	warnings: readonly string[];
}

export interface TerminalBenchSessionDeps {
	createRuntime?: () => NKleinSessionRuntime;
}

function createTerminalTools(rpc: TerminalBenchEnvironmentRpc, onSubmit: (summary: string) => void): AgentTool[] {
	const execTool: AgentTool = {
		name: "terminal_exec",
		description:
			"Execute one non-interactive shell command inside Harbor's persistent task container. Returns exit code, stdout, and stderr. The command may mutate the container.",
		inputSchema: {
			type: "object",
			properties: {
				command: { type: "string", description: "A complete non-interactive shell command." },
				cwd: { type: "string", description: "Optional absolute path inside the task container (default /root)." },
				timeoutSeconds: { type: "integer", minimum: 1, maximum: 1_800, description: "Command deadline." },
			},
			required: ["command"],
			additionalProperties: false,
		},
		timeoutMs: 1_810_000,
		retryable: false,
		maxRetries: 0,
		async execute(input) {
			return formatTerminalBenchExecResult(await rpc.exec(parseTerminalBenchExecRequest(input)));
		},
	};
	const submitTool: AgentTool = {
		name: "terminal_submit",
		description:
			"End the !Klein run and hand the unchanged Harbor-owned environment to Harbor's hidden verifier. This is not a self-certification.",
		inputSchema: {
			type: "object",
			properties: { summary: { type: "string", description: "Concise work performed and self-checks run." } },
			required: ["summary"],
			additionalProperties: false,
		},
		lifecycle: { completesRun: true },
		execute(input) {
			if (!input || typeof input !== "object" || Array.isArray(input))
				throw new Error("terminal_submit requires an object.");
			const summary = (input as Record<string, unknown>).summary;
			if (typeof summary !== "string" || !summary.trim())
				throw new Error("terminal_submit summary must be non-empty text.");
			onSubmit(summary.trim());
			return "Submitted to Harbor for independent verification.";
		},
	};
	return [execTool, submitTool];
}

export async function runTerminalBenchSession(
	rawConfig: TerminalBenchAgentConfig | unknown,
	rpc: TerminalBenchEnvironmentRpc,
	deps: TerminalBenchSessionDeps = {},
): Promise<TerminalBenchSessionResult> {
	const config = parseTerminalBenchAgentConfig(rawConfig);
	const baseUrl = assertLocalModelBaseUrl(config.baseUrl);
	const runtime = deps.createRuntime?.() ?? createInMemoryNKleinSessionRuntime();
	let submittedSummary: string | null = null;
	try {
		const start = await runtime.startTaskSession({
			taskId: config.taskId,
			cwd: config.workingDirectory,
			prompt: config.instruction,
			sourcePrompt: config.instruction,
			taskTitle: "Terminal-Bench task",
			providerId: config.providerId,
			modelId: config.modelId,
			role: "worker",
			mode: "act",
			executionMode: "agent",
			apiKey: process.env.NKLEIN_TERMINAL_MODEL_API_KEY ?? "local-only",
			baseUrl,
			contextWindow: config.contextWindow,
			maxTokensPerTurn: config.maxTokensPerTurn,
			apiTimeoutMs: 300_000,
			turnTimeoutMs: 30 * 60_000,
			systemPrompt: buildTerminalBenchAgentSystemPrompt(config.workingDirectory),
			toolPolicies: {
				"*": { enabled: false },
				terminal_exec: { enabled: true, autoApprove: true },
				terminal_submit: { enabled: true, autoApprove: true },
			},
			extraTools: createTerminalTools(rpc, (summary) => {
				submittedSummary = summary;
			}),
		});
		return {
			sessionId: start.sessionId,
			result: start.result,
			submittedSummary,
			warnings: start.warnings ?? [],
		};
	} finally {
		await runtime.dispose();
	}
}
