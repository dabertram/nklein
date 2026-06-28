/**
 * Live verification of the §5.M chat send-turn path (the tRPC endpoint's backing) against a real local model.
 *
 * Builds the chat service exactly as the runtime API does — `createChatService` with `resolveLocalChatModelDeps`
 * (discovers a loaded local model from the live endpoint) — then creates a session and sends a turn, asserting the
 * model replied and both messages persisted to the transcript. Proves `chat.sendMessage` works end-to-end live.
 *
 * Run:  tsx scripts/verify-chat-send.mts
 *   env: NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL (default http://127.0.0.1:1234/v1).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChatService } from "../src/chat/chat-service";
import { resolveLocalChatModelDeps } from "../src/chat/local-chat-model";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";

const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim();

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
	// Never load models — only test already-loaded ones (user directive 2026-06-28). Refuse a specified non-resident model.
	if (MODEL_ID) {
		await assertModelLoaded(BASE_URL, MODEL_ID);
	}
	const rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-send-verify-"));
	try {
		const service = createChatService({
			rootDir,
			resolveModelDeps: () =>
				resolveLocalChatModelDeps({ baseUrl: BASE_URL, ...(MODEL_ID ? { modelId: MODEL_ID } : {}) }),
		});
		const session = await service.createSession({ title: "Live send", goal: "Answer concisely." });
		const result = await service.sendMessage({ sessionId: session.id, message: "Reply with exactly the word: pong" });
		const transcript = await service.readTranscript(session.id);

		const replyOk = (result?.assistantMessage.content ?? "").trim().length > 0;
		const persistedOk = transcript.length === 2 && transcript[0]?.role === "user" && transcript[1]?.role === "assistant";

		log("");
		log("=== Chat send-turn live verification ===");
		log(`Model replied (non-empty):                ${replyOk ? "YES ✓" : "NO ⚠️"}`);
		log(`User + assistant persisted to transcript: ${persistedOk ? "YES ✓" : "NO ⚠️"}`);
		log(`Reply: ${result?.assistantMessage.content.trim().slice(0, 160)}`);

		const ok = replyOk && persistedOk;
		log("");
		log(ok ? "PASS ✓ chat.sendMessage ran a real turn and persisted it." : "INCOMPLETE — see above.");
		process.exit(ok ? 0 : 1);
	} finally {
		await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
