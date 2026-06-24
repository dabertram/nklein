import { createInterface } from "node:readline";
import type { Command } from "commander";
import { createChatModelDeps } from "../chat/chat-local-llm-adapter";
import { readChatMemories } from "../chat/chat-memory-store";
import { type ChatRuntimeDeps, runChatConversation, runChatTurn } from "../chat/chat-runtime";
import { createChatSession, getChatSession } from "../chat/chat-session-store";
import { appendChatMessage, readChatTranscript } from "../chat/chat-transcript-store";
import { LocalLlmClient } from "../nklein-sdk/nklein-local-llm-client";

/**
 * `nklein chat` (todo §5.M) — a board-independent chat entry point that drives one turn of the unified chat
 * agent against a loaded local model. It wires the §5.M foundations (session / transcript / memory + recall,
 * lean context window, the turn loop) to a fail-closed `LocalLlmClient`, persisting the turn to the user's
 * runtime home. The model is discovered from the live local endpoint (AGENTS.md), overridable via flags. This is
 * the simple-completion entry point; the tool-using multi-turn agent loop + streaming + web-ui are the next layer.
 */

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:1234/v1";
const DEFAULT_CHAT_TOKEN_BUDGET = 8000;

/** Rough token estimate for the lean-window budget (≈4 chars/token); the runtime can supply a precise one later. */
function estimateChatTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Discover a currently-loaded, non-embedding model from the live local endpoint. */
export async function discoverLoadedModelId(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
	try {
		const res = await fetchImpl(`${baseUrl.replace(/\/+$/u, "")}/models`);
		if (!res.ok) {
			return null;
		}
		const payload = (await res.json()) as { data?: Array<{ id?: string }> };
		const models = payload.data ?? [];
		const chatModel = models.find((entry) => entry.id && !entry.id.includes("embed")) ?? models[0];
		return chatModel?.id ?? null;
	} catch {
		return null;
	}
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
	json?: boolean;
	write?: (text: string) => void;
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
	const modelDeps = createChatModelDeps(client);
	const tokenBudget = options.tokenBudget ?? DEFAULT_CHAT_TOKEN_BUDGET;
	const runtimeDeps: ChatRuntimeDeps = {
		readTranscript: (sessionId) => readChatTranscript(sessionId),
		readMemories: () => readChatMemories(),
		appendMessage: (sessionId, input) => appendChatMessage(sessionId, input),
		...modelDeps,
		estimateTokens: estimateChatTokens,
	};

	const message = options.message?.trim();
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
		new Promise((resolve) => {
			const next = queued.shift();
			if (next !== undefined) {
				resolve(next);
			} else if (closed) {
				resolve(null);
			} else {
				waiters.push(resolve);
			}
		});
	try {
		await runChatConversation({ session, tokenBudget, memoryLimit: 5 }, { ...runtimeDeps, readLine, write });
	} finally {
		rl.close();
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
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: ChatSendOptions) => {
			await runChatSendCommand(options);
		});
}
