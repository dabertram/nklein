import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Command } from "commander";
import { type ChatAgentTurnDeps, runChatAgentConversation, runChatAgentTurn } from "../chat/chat-agent-turn";
import { createBoardMutationTools, createBoardReadTools } from "../chat/chat-board-tools";
import { createBrowserTools } from "../chat/chat-browser-tool";
import { createCommandRunTool } from "../chat/chat-command-tool";
import { createFocusChainTools, readChatFocusChain } from "../chat/chat-focus-chain";
import { recordChatHostAction } from "../chat/chat-host-action-audit-store";
import { appendChatToolExchange, createChatAgentModel, createChatModelDeps } from "../chat/chat-local-llm-adapter";
import { readChatMemories } from "../chat/chat-memory-store";
import { type ChatRuntimeDeps, runChatConversation, runChatTurn } from "../chat/chat-runtime";
import { createChatSession, getChatSession } from "../chat/chat-session-store";
import { createGatedChatToolExecutor } from "../chat/chat-tool-executor";
import { appendChatMessage, readChatTranscript } from "../chat/chat-transcript-store";
import { createWorkspaceReadTools, createWorkspaceWriteTools } from "../chat/chat-workspace-tools";
import { DEFAULT_LOCAL_CHAT_BASE_URL, discoverLoadedModelId } from "../chat/local-chat-model";
import { LocalLlmClient } from "../nklein-agent/nklein-local-llm-client";

/**
 * `nklein chat` (todo §5.M) — a board-independent chat entry point that drives one turn of the unified chat
 * agent against a loaded local model. It wires the §5.M foundations (session / transcript / memory + recall,
 * lean context window, the turn loop) to a fail-closed `LocalLlmClient`, persisting the turn to the user's
 * runtime home. The model is discovered from the live local endpoint (AGENTS.md), overridable via flags. This is
 * the simple-completion entry point; the tool-using multi-turn agent loop + streaming + web-ui are the next layer.
 */

const DEFAULT_LOCAL_BASE_URL = DEFAULT_LOCAL_CHAT_BASE_URL;
const DEFAULT_CHAT_TOKEN_BUDGET = 8000;

/** Rough token estimate for the lean-window budget (≈4 chars/token); the runtime can supply a precise one later. */
function estimateChatTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

interface ChatSendOptions {
	message?: string;
	session?: string;
	title?: string;
	goal?: string;
	baseUrl?: string;
	model?: string;
	provider?: string;
	tokenBudget?: number;
	/** When set, the chat is tool-using: read-only workspace tools rooted at this directory are offered to the model. */
	workspace?: string;
	/** With `--workspace`, also offer the mutating `write_file` tool (each write is confirm-gated + audited). */
	allowWrite?: boolean;
	/** With `--workspace`, also offer `run_command` (host_command); elevates to sandbox_with_host_escape, each run confirmed + audited. */
	allowCommands?: boolean;
	/** With `--workspace`, also offer `browse_url` (headless browser, a host_command); elevates to a host-capable mode, each navigation confirmed + audited. */
	browser?: boolean;
	json?: boolean;
	write?: (text: string) => void;
}

const DEFAULT_CHAT_AGENT_MAX_ITERATIONS = 6;

/** A line reader over stdin for the interactive REPL, with a `close` to release the readline interface. */
function createStdinLineReader(): { readLine: () => Promise<string | null>; close: () => void } {
	const rl = createInterface({ input: process.stdin });
	const queued: string[] = [];
	const waiters: Array<(line: string | null) => void> = [];
	let closed = false;
	rl.on("line", (line) => {
		const waiter = waiters.shift();
		if (waiter) {
			waiter(line);
		} else {
			queued.push(line);
		}
	});
	rl.on("close", () => {
		closed = true;
		for (const waiter of waiters.splice(0)) {
			waiter(null);
		}
	});
	const readLine = (): Promise<string | null> =>
		new Promise((resolveLine) => {
			const next = queued.shift();
			if (next !== undefined) {
				resolveLine(next);
			} else if (closed) {
				resolveLine(null);
			} else {
				waiters.push(resolveLine);
			}
		});
	return { readLine, close: () => rl.close() };
}

export async function runChatSendCommand(options: ChatSendOptions = {}): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const baseUrl = options.baseUrl?.trim() || DEFAULT_LOCAL_BASE_URL;
	const providerId = options.provider?.trim() || "lmstudio";
	const modelId = options.model?.trim() || (await discoverLoadedModelId(baseUrl));
	if (!modelId) {
		throw new Error(`No loaded model found at ${baseUrl}. Load a model or pass --model.`);
	}

	const session = options.session
		? await getChatSession(options.session)
		: await createChatSession({
				title: options.title ?? "CLI chat",
				...(options.goal ? { goal: options.goal } : {}),
			});
	if (!session) {
		throw new Error(`Chat session not found: ${options.session}`);
	}

	// LocalLlmClient fails closed against cloud (invariant #1) in its constructor.
	const client = new LocalLlmClient({ providerId, modelId, baseUrl });
	const tokenBudget = options.tokenBudget ?? DEFAULT_CHAT_TOKEN_BUDGET;
	const message = options.message?.trim();

	// Tool-using path: `--workspace` offers the read-only workspace tools (sandbox_read; isolated_readonly mode) and
	// drives the multi-turn agent loop through the policy-gated + audited executor (the §5.M host-access invariant).
	// `--allow-write` additionally offers `write_file`, whose every call is confirm-gated (a stdin y/N prompt) + audited.
	if (options.workspace) {
		const workspaceRoot = resolve(options.workspace);
		const read = createWorkspaceReadTools(workspaceRoot);
		const boardTools = createBoardReadTools(workspaceRoot);
		// Focus chain (§5.M G4): always offered (sandbox_read = always-allowed) so the agent maintains its checklist.
		const focusTools = createFocusChainTools(session.id);
		const writeTools = options.allowWrite ? createWorkspaceWriteTools(workspaceRoot) : { tools: [], definitions: [] };
		// `--allow-commands` offers run_command (a host_command), which the gate denies in isolated_readonly — so it
		// also elevates the session to the host-capable `sandbox_with_host_escape` mode, where every host action is a
		// confirmed, audited escape hatch (the §5.M invariant). Reads stay free; the command itself is confirm-prompted.
		const commandTools = options.allowCommands ? createCommandRunTool(workspaceRoot) : { tools: [], definitions: [] };
		// `--allow-commands` is the CLI's "can act" flag → the host-capable mode where the `control_plane` board write
		// `create_card` is allowed (it's denied in the default isolated_readonly / read-only mode).
		const boardMutationTools = options.allowCommands
			? createBoardMutationTools(workspaceRoot)
			: { tools: [], definitions: [] };
		// `--browser` offers browse_url (a host_command); like --allow-commands it elevates to the host-capable mode so
		// the gate confirms (rather than denies) it — each navigation is then confirm-prompted + audited (§5.M G6).
		const browserTools = options.browser ? createBrowserTools() : { tools: [], definitions: [] };
		const mode = options.allowCommands || options.browser ? "sandbox_with_host_escape" : "isolated_readonly";
		const tools = [
			...read.tools,
			...boardTools.tools,
			...focusTools.tools,
			...boardMutationTools.tools,
			...writeTools.tools,
			...commandTools.tools,
			...browserTools.tools,
		];
		const definitions = [
			...read.definitions,
			...boardTools.definitions,
			...focusTools.definitions,
			...boardMutationTools.definitions,
			...writeTools.definitions,
			...commandTools.definitions,
			...browserTools.definitions,
		];

		// A confirm-gated tool needs an interactive prompt; the REPL also needs stdin. Open one reader for both.
		const reader =
			options.allowWrite || options.allowCommands || options.browser || !message ? createStdinLineReader() : null;
		const confirm = reader
			? async (call: { name: string; arguments: Record<string, unknown> }): Promise<boolean> => {
					const command = typeof call.arguments.command === "string" ? call.arguments.command : null;
					const path = typeof call.arguments.path === "string" ? call.arguments.path : null;
					const url = typeof call.arguments.url === "string" ? call.arguments.url : null;
					const target = command ? ` (${command})` : path ? ` (${path})` : url ? ` (${url})` : "";
					write(`Allow ${call.name}${target}? [y/N] `);
					const answer = await reader.readLine();
					return answer?.trim().toLowerCase() === "y";
				}
			: undefined;

		const executeTool = createGatedChatToolExecutor({
			sessionId: session.id,
			mode,
			tools,
			...(confirm ? { confirm } : {}),
			recordAudit: async (record) => {
				await recordChatHostAction({ ...record });
			},
		});
		const agentDeps: ChatAgentTurnDeps = {
			readTranscript: (sessionId) => readChatTranscript(sessionId),
			readMemories: () => readChatMemories(),
			appendMessage: (sessionId, input) => appendChatMessage(sessionId, input),
			summarize: createChatModelDeps(client).summarize,
			estimateTokens: estimateChatTokens,
			model: createChatAgentModel(client, definitions),
			executeTool,
			appendToolExchange: appendChatToolExchange,
			readFocusChain: (sessionId) => readChatFocusChain(sessionId),
		};

		try {
			if (message) {
				const result = await runChatAgentTurn(
					{
						session,
						userMessage: message,
						tokenBudget,
						memoryLimit: 5,
						maxIterations: DEFAULT_CHAT_AGENT_MAX_ITERATIONS,
					},
					agentDeps,
				);
				if (options.json) {
					const toolsUsed = result.steps.map((step) => step.toolCall.name);
					write(
						`${JSON.stringify({ sessionId: session.id, reply: result.assistantMessage.content, toolsUsed }, null, 2)}\n`,
					);
					return;
				}
				write(`Session: ${session.id}${session.goal ? ` · goal: ${session.goal}` : ""}\n`);
				write(`Model: ${providerId}:${modelId}  ·  tools: ${tools.map((tool) => tool.name).join(", ")}\n\n`);
				if (result.steps.length > 0) {
					write(`  (used: ${result.steps.map((step) => step.toolCall.name).join(", ")})\n`);
				}
				write(`${result.assistantMessage.content}\n`);
				return;
			}

			if (!reader) {
				throw new Error("Interactive chat requires a stdin reader.");
			}
			write(`Session: ${session.id}${session.goal ? ` · goal: ${session.goal}` : ""}\n`);
			write(
				`Model: ${providerId}:${modelId}  ·  tools: ${tools.map((tool) => tool.name).join(", ")}  ·  type /exit to quit\n`,
			);
			await runChatAgentConversation(
				{ session, tokenBudget, memoryLimit: 5, maxIterations: DEFAULT_CHAT_AGENT_MAX_ITERATIONS },
				{ ...agentDeps, readLine: reader.readLine, write },
			);
		} finally {
			reader?.close();
		}
		return;
	}

	// Plain completion path (no tools).
	const modelDeps = createChatModelDeps(client);
	const runtimeDeps: ChatRuntimeDeps = {
		readTranscript: (sessionId) => readChatTranscript(sessionId),
		readMemories: () => readChatMemories(),
		appendMessage: (sessionId, input) => appendChatMessage(sessionId, input),
		...modelDeps,
		estimateTokens: estimateChatTokens,
	};

	if (message) {
		const result = await runChatTurn({ session, userMessage: message, tokenBudget, memoryLimit: 5 }, runtimeDeps);
		if (options.json) {
			write(`${JSON.stringify({ sessionId: session.id, reply: result.assistantMessage.content }, null, 2)}\n`);
			return;
		}
		write(`Session: ${session.id}${session.goal ? ` · goal: ${session.goal}` : ""}\n`);
		write(`Model: ${providerId}:${modelId}\n\n`);
		write(`${result.assistantMessage.content}\n`);
		return;
	}

	// Interactive REPL (no --message): converse until EOF (Ctrl-D) or `/exit`.
	write(`Session: ${session.id}${session.goal ? ` · goal: ${session.goal}` : ""}\n`);
	write(`Model: ${providerId}:${modelId}  ·  type /exit to quit\n`);
	const reader = createStdinLineReader();
	try {
		await runChatConversation(
			{ session, tokenBudget, memoryLimit: 5 },
			{ ...runtimeDeps, readLine: reader.readLine, write },
		);
	} finally {
		reader.close();
	}
}

export function registerChatCommand(program: Command): void {
	program
		.command("chat")
		.description(
			"Chat with the unified agent on a loaded local model (board-independent). Omit --message for an interactive session.",
		)
		.option("--message <text>", "Send a single message and print the reply; omit for an interactive REPL.")
		.option("--session <id>", "Continue an existing chat session; otherwise a new one is created.")
		.option("--title <title>", "Title for a newly created session.")
		.option("--goal <goal>", "Standing objective kept in focus across the session's turns.")
		.option("--base-url <url>", "Local model endpoint. Defaults to LM Studio's localhost endpoint.")
		.option("--model <id>", "Model id. Defaults to the loaded model discovered from the endpoint.")
		.option("--provider <id>", "Local provider id. Defaults to lmstudio.")
		.option("--token-budget <n>", "Lean-window token budget.", (value) => Number.parseInt(value, 10))
		.option(
			"--workspace <dir>",
			"Make the chat tool-using: offer read-only workspace tools (read_file/list_dir) rooted at this directory.",
		)
		.option("--allow-write", "With --workspace, also offer write_file; each write is confirm-prompted and audited.")
		.option(
			"--allow-commands",
			"With --workspace, also offer run_command; each command is confirm-prompted and audited (host-capable mode).",
		)
		.option(
			"--browser",
			"With --workspace, also offer browse_url (headless browser); each navigation is confirm-prompted and audited.",
		)
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: ChatSendOptions) => {
			await runChatSendCommand(options);
		});
}
