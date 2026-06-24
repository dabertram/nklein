/**
 * Live verification of the §5.M chat runtime turn loop against a real local model (LM Studio / Ollama).
 *
 * Wires the real chat stores (session / transcript / long-term memory) + a real local-model completion into
 * `runChatTurn`, in an isolated store root, then drives one real turn and asserts: the model replied, both the
 * user message and the assistant reply were persisted to the transcript, and a seeded memory matching the query
 * was recalled into the model prompt. Proves the foundations compose into a working chat turn end-to-end.
 *
 * Run:  tsx scripts/verify-chat-runtime.mts
 *   env: NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL (default http://127.0.0.1:1234/v1).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChatTurn } from "../src/chat/chat-runtime";
import { appendChatMemory, readChatMemories } from "../src/chat/chat-memory-store";
import { createChatSession } from "../src/chat/chat-session-store";
import { appendChatMessage, readChatTranscript } from "../src/chat/chat-transcript-store";
import type { ChatPromptMessage } from "../src/chat/chat-turn-context";

const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

async function resolveModelId(): Promise<string> {
	if (MODEL_ID) {
		return MODEL_ID;
	}
	const res = await fetch(`${BASE_URL}/models`);
	const payload = (await res.json()) as { data?: Array<{ id?: string }> };
	const id = payload.data?.find((entry) => !entry.id?.includes("embed"))?.id ?? payload.data?.[0]?.id;
	if (!id) {
		throw new Error(`Could not resolve a model id from ${BASE_URL}/models`);
	}
	return id;
}

async function main(): Promise<void> {
	const modelId = await resolveModelId();
	log(`Model: ${modelId}  BaseUrl: ${BASE_URL}`);

	const rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-verify-"));
	const storeOptions = { rootDir };
	let lastPrompt: ChatPromptMessage[] = [];

	const complete = async (prompt: ChatPromptMessage[]): Promise<string> => {
		lastPrompt = prompt;
		const res = await fetch(`${BASE_URL}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: modelId,
				// `/no_think` keeps a reasoning model (e.g. qwen3) from spending the budget on hidden thinking.
				messages: prompt.map((message) => ({ role: message.role, content: message.content })),
				temperature: 0.2,
				max_tokens: 1024,
			}),
		});
		const json = (await res.json()) as {
			choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
		};
		const choice = json.choices?.[0]?.message;
		// Strip any inline <think>…</think> a reasoning model leaves in the content.
		const content = (choice?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
		return content || (choice?.reasoning_content ?? "").trim();
	};

	try {
		const session = await createChatSession(
			{ title: "Verify chat", goal: "Help the user with their TypeScript project" },
			storeOptions,
		);
		await appendChatMemory(
			{ sessionId: session.id, text: "The user prefers TypeScript strict mode and tabs over spaces." },
			storeOptions,
		);

		const result = await runChatTurn(
			{ session, userMessage: "What TypeScript settings do I prefer?", tokenBudget: 4000, memoryLimit: 5 },
			{
				readTranscript: (sessionId) => readChatTranscript(sessionId, storeOptions),
				readMemories: () => readChatMemories(storeOptions),
				appendMessage: (sessionId, input) => appendChatMessage(sessionId, input, storeOptions),
				complete,
				summarize: async (overflow) => `Earlier: ${overflow.length} messages.`,
				estimateTokens: (text) => Math.ceil(text.length / 4),
			},
		);

		const transcript = await readChatTranscript(session.id, storeOptions);
		const memoryNote = lastPrompt.find((m) => m.role === "system" && m.content.includes("remembered"));
		const goalNote = lastPrompt.find((m) => m.role === "system" && m.content.includes("objective"));

		const replyOk = result.assistantMessage.content.trim().length > 0;
		const persistedOk = transcript.length === 2 && transcript[0]?.role === "user" && transcript[1]?.role === "assistant";
		const recalledOk = Boolean(memoryNote && memoryNote.content.includes("strict mode"));
		const goalOk = Boolean(goalNote && goalNote.content.includes("TypeScript project"));

		log("");
		log("=== Chat runtime live verification ===");
		log(`Model replied (non-empty):              ${replyOk ? "YES ✓" : "NO ⚠️"}`);
		log(`User + assistant persisted to transcript: ${persistedOk ? "YES ✓" : "NO ⚠️"}`);
		log(`Seeded memory recalled into the prompt:  ${recalledOk ? "YES ✓" : "NO ⚠️"}`);
		log(`Session goal anchored into the prompt:   ${goalOk ? "YES ✓" : "NO ⚠️"}`);
		log("");
		log(`Assistant reply: ${result.assistantMessage.content.trim().slice(0, 200)}`);

		const ok = replyOk && persistedOk && recalledOk && goalOk;
		log("");
		log(ok ? "PASS ✓ a real chat turn composed memory + goal, called the model, and persisted." : "INCOMPLETE — see above.");
		process.exit(ok ? 0 : 1);
	} finally {
		await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
