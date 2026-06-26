/**
 * Live verification of the §5.AC temporal-awareness "knows today" lighthouse against a real local model.
 *
 * Drives one `runChatTurn` with the real host clock injected (the §5.AC wiring) and asks the model a question whose
 * correct answer depends on knowing the REAL current date — one a model reasoning from its (past) training-cutoff
 * prior would get wrong. Asserts: (1) the `<current_datetime>` block actually leads the prompt, and (2) the model's
 * reply reflects the injected year (not a stale prior). The override proof — placing a date that's in the past
 * relative to "now" but in the future relative to the model's training as PAST — is logged as the strong signal.
 *
 * Run:  tsx scripts/verify-temporal-awareness-live.mts
 *   env: NKLEIN_VERIFY_MODEL (default: first non-embed loaded), NKLEIN_VERIFY_BASE_URL (default :1234/v1).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChatMemories } from "../src/chat/chat-memory-store";
import { runChatTurn } from "../src/chat/chat-runtime";
import { createChatSession } from "../src/chat/chat-session-store";
import { appendChatMessage, readChatTranscript } from "../src/chat/chat-transcript-store";
import type { ChatPromptMessage } from "../src/chat/chat-turn-context";
import { resolveTemporalAwareness } from "../src/core/temporal-awareness";

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
	const now = new Date();
	const t = resolveTemporalAwareness(now);
	log(`Model: ${modelId}  BaseUrl: ${BASE_URL}  Now: ${t.todayIso} (year ${t.year})`);

	const rootDir = await mkdtemp(join(tmpdir(), "nklein-temporal-verify-"));
	const storeOptions = { rootDir };
	let lastPrompt: ChatPromptMessage[] = [];

	const complete = async (prompt: ChatPromptMessage[]): Promise<string> => {
		lastPrompt = prompt;
		const res = await fetch(`${BASE_URL}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: modelId,
				messages: prompt.map((message) => ({ role: message.role, content: message.content })),
				temperature: 0.1,
				max_tokens: 1024,
			}),
		});
		const json = (await res.json()) as {
			choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
		};
		const choice = json.choices?.[0]?.message;
		const content = (choice?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
		return content || (choice?.reasoning_content ?? "").trim();
	};

	try {
		const session = await createChatSession({ title: "Verify temporal" }, storeOptions);
		// A past month of the CURRENT year — in the past relative to "now", but a model anchored on a ~2024 training
		// prior would call it "the future". The grounded answer uses the injected date.
		const userMessage =
			`What is the current year? And relative to today's date, is ${t.year}-03-01 in the past or the future? ` +
			`Answer in one short sentence.`;

		const result = await runChatTurn(
			{ session, userMessage, tokenBudget: 4000 },
			{
				readTranscript: (sessionId) => readChatTranscript(sessionId, storeOptions),
				readMemories: () => readChatMemories(storeOptions),
				appendMessage: (sessionId, input) => appendChatMessage(sessionId, input, storeOptions),
				complete,
				summarize: async () => "",
				estimateTokens: (text) => Math.ceil(text.length / 4),
				now: () => now,
			},
		);

		const reply = result.assistantMessage.content.trim();
		const replyLower = reply.toLowerCase();
		const temporalNote = lastPrompt.find((m) => m.role === "system" && m.content.includes("<current_datetime>"));
		const temporalBlockOk = Boolean(temporalNote?.content.includes(t.todayIso));
		const temporalLeadsOk = lastPrompt[0]?.role === "system" && lastPrompt[0].content.includes("<current_datetime>");
		const yearOk = reply.includes(String(t.year));
		// Strong override signal: the model correctly places a current-year past month in the PAST.
		const pastSignal = /\bpast\b|already (happened|passed|occurred)|earlier this year|behind us|has passed/i.test(
			replyLower,
		);

		log("");
		log("=== §5.AC temporal-awareness live verification ===");
		log(`<current_datetime> block carries today's date:  ${temporalBlockOk ? "YES ✓" : "NO ⚠️"}`);
		log(`Temporal block LEADS the prompt (first note):    ${temporalLeadsOk ? "YES ✓" : "NO ⚠️"}`);
		log(`Reply reflects the injected year (${t.year}):        ${yearOk ? "YES ✓" : "NO ⚠️"}`);
		log(`Reply places ${t.year}-03-01 in the PAST (override): ${pastSignal ? "YES ✓ (strong)" : "—  (weak/unclear)"}`);
		log("");
		log(`Question: ${userMessage}`);
		log(`Reply:    ${reply.slice(0, 300)}`);

		// Gate on the wiring (block leads + carries the date) AND the model echoing the injected year.
		const ok = temporalBlockOk && temporalLeadsOk && yearOk;
		log("");
		log(
			ok
				? `PASS ✓ the model knew the real year from the injected date${pastSignal ? " and placed the past-month correctly (training-prior overridden)" : ""}.`
				: "INCOMPLETE — see above.",
		);
		process.exit(ok ? 0 : 1);
	} finally {
		await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
