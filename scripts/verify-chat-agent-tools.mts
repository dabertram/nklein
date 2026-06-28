/**
 * Live verification of the §5.M tool-using chat agent against a real local model (LM Studio / Ollama).
 *
 * Wires the real tools-aware local client (`completeWithTools`), the concrete read-only workspace tools, the
 * policy-gated + audited executor, and the real chat stores into `runChatAgentTurn`, in an isolated store root
 * pointed at a tiny on-disk workspace. It then asks a question only answerable by reading a file, and asserts the
 * agent actually CALLED a tool (read_file), the executor audited the call, the tool ran inside the workspace, and
 * the final answer reflects the file content. Proves the tool-using loop composes end-to-end with a real model.
 *
 * Run:  tsx scripts/verify-chat-agent-tools.mts
 *   env: NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL (default http://127.0.0.1:1234/v1).
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChatAgentTurn } from "../src/chat/chat-agent-turn";
import { appendChatToolExchange, createChatAgentModel } from "../src/chat/chat-local-llm-adapter";
import { readChatMemories } from "../src/chat/chat-memory-store";
import { createChatSession } from "../src/chat/chat-session-store";
import { type ChatToolAuditRecord, createGatedChatToolExecutor } from "../src/chat/chat-tool-executor";
import { appendChatMessage, readChatTranscript } from "../src/chat/chat-transcript-store";
import { createWorkspaceReadTools } from "../src/chat/chat-workspace-tools";
import { LocalLlmClient } from "../src/nklein-agent/nklein-local-llm-client";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";

const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";
const SECRET = "the deploy token is hunter2-fjord-lantern";

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
	// Never load models — only test already-loaded ones (user directive 2026-06-28). Refuse a specified non-resident model.
	if (MODEL_ID) {
		await assertModelLoaded(BASE_URL, MODEL_ID);
	}
	const modelId = await resolveModelId();
	log(`Model: ${modelId}  BaseUrl: ${BASE_URL}`);

	const rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-agent-verify-"));
	const storeOptions = { rootDir };
	const workspace = join(rootDir, "workspace");

	try {
		await mkdir(workspace, { recursive: true });
		await writeFile(join(workspace, "NOTES.md"), `# Project notes\n\n${SECRET}\n`, "utf8");

		const client = new LocalLlmClient({ providerId: "lmstudio", modelId, baseUrl: BASE_URL });
		const { tools, definitions } = createWorkspaceReadTools(workspace);
		const model = createChatAgentModel(client, definitions, { sampling: { temperature: 0.2, maxTokens: 1024 } });

		const audit: ChatToolAuditRecord[] = [];
		const executeTool = createGatedChatToolExecutor({
			sessionId: "verify",
			mode: "isolated_readonly",
			tools,
			recordAudit: async (record) => {
				audit.push(record);
			},
		});

		const session = await createChatSession(
			{
				title: "Verify agent tools",
				goal: "Answer questions about the user's project by reading its files. You can call read_file and list_dir; the file you need is NOTES.md.",
			},
			storeOptions,
		);

		const result = await runChatAgentTurn(
			{
				session,
				userMessage: "Read NOTES.md in the workspace and tell me the exact deploy token it records.",
				tokenBudget: 4000,
				maxIterations: 4,
			},
			{
				readTranscript: (sessionId) => readChatTranscript(sessionId, storeOptions),
				readMemories: () => readChatMemories(storeOptions),
				appendMessage: (sessionId, input) => appendChatMessage(sessionId, input, storeOptions),
				summarize: async (overflow) => `Earlier: ${overflow.length} messages.`,
				estimateTokens: (text) => Math.ceil(text.length / 4),
				model,
				executeTool,
				appendToolExchange: appendChatToolExchange,
			},
		);

		const transcript = await readChatTranscript(session.id, storeOptions);
		const calledReadFile = result.steps.some((step) => step.toolCall.name === "read_file");
		// The audit record identifies the tool by its `action` (actionKind); `detail` is the path arg (e.g. "NOTES.md"),
		// NOT the tool name — so the old `detail === "read_file"` check never matched and falsely failed every model.
		// read_file's actionKind is "sandbox_read" (the `calledReadFile` gate above confirms it was read_file specifically).
		const auditedRead = audit.some((record) => record.action === "sandbox_read" && record.executed);
		const answerHasToken = result.assistantMessage.content.toLowerCase().includes("hunter2-fjord-lantern");
		const persistedOk = transcript.length === 2 && transcript[0]?.role === "user" && transcript[1]?.role === "assistant";

		log("");
		log("=== Tool-using chat agent live verification ===");
		log(`Agent CALLED read_file:                  ${calledReadFile ? "YES ✓" : "NO ⚠️"}`);
		log(`Executor audited an executed read:       ${auditedRead ? "YES ✓" : "NO ⚠️"}`);
		log(`Final answer contains the file's secret: ${answerHasToken ? "YES ✓" : "NO ⚠️"}`);
		log(`User + assistant persisted:              ${persistedOk ? "YES ✓" : "NO ⚠️"}`);
		log(`Tool steps: ${result.steps.length}  hitIterationLimit: ${result.hitIterationLimit}`);
		log("");
		log(`Assistant reply: ${result.assistantMessage.content.trim().slice(0, 240)}`);

		const ok = calledReadFile && auditedRead && answerHasToken && persistedOk;
		log("");
		log(
			ok
				? "PASS ✓ a real model called a workspace tool through the gated executor and answered from the file."
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
