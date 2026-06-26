/**
 * Live verification of the §5.M chat agent's CONFIRM gate with a real mutating tool (LM Studio / Ollama).
 *
 * Wires the read + write workspace tools through the policy-gated + audited executor in `isolated_readonly` mode
 * (where a `sandbox_write` is a *confirm* action) into `runChatAgentTurn`, with a confirm callback that records the
 * prompt and approves. It asks a real model to create a file, then asserts: the agent CALLED write_file, the gate
 * INVOKED the confirm callback, the file was actually written to the workspace with the requested content, and the
 * audit recorded a confirmed + executed sandbox_write. Proves the confirmation + audit path runs with a real tool.
 *
 * Run:  tsx scripts/verify-chat-agent-write.mts
 *   env: NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL (default http://127.0.0.1:1234/v1).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChatAgentTurn } from "../src/chat/chat-agent-turn";
import { appendChatToolExchange, createChatAgentModel } from "../src/chat/chat-local-llm-adapter";
import { readChatMemories } from "../src/chat/chat-memory-store";
import { createChatSession } from "../src/chat/chat-session-store";
import { type ChatToolAuditRecord, createGatedChatToolExecutor } from "../src/chat/chat-tool-executor";
import { appendChatMessage, readChatTranscript } from "../src/chat/chat-transcript-store";
import { createWorkspaceReadTools, createWorkspaceWriteTools } from "../src/chat/chat-workspace-tools";
import { LocalLlmClient } from "../src/nklein-agent/nklein-local-llm-client";

const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";
const PHRASE = "hello from the agent";
const TARGET = "notes.txt";

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

	const rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-write-verify-"));
	const storeOptions = { rootDir };
	const workspace = join(rootDir, "workspace");

	try {
		const client = new LocalLlmClient({ providerId: "lmstudio", modelId, baseUrl: BASE_URL });
		const read = createWorkspaceReadTools(workspace);
		const write = createWorkspaceWriteTools(workspace);
		const tools = [...read.tools, ...write.tools];
		const definitions = [...read.definitions, ...write.definitions];
		const model = createChatAgentModel(client, definitions, { sampling: { temperature: 0.2, maxTokens: 1024 } });

		const confirmPrompts: string[] = [];
		const audit: ChatToolAuditRecord[] = [];
		const executeTool = createGatedChatToolExecutor({
			sessionId: "verify",
			mode: "isolated_readonly",
			tools,
			confirm: async (call) => {
				confirmPrompts.push(call.name);
				return true; // auto-approve for the verification
			},
			recordAudit: async (record) => {
				audit.push(record);
			},
		});

		const session = await createChatSession(
			{
				title: "Verify write gate",
				goal: `Create files in the workspace as asked. To create a file, call write_file with a workspace-relative path and the content.`,
			},
			storeOptions,
		);

		const result = await runChatAgentTurn(
			{
				session,
				userMessage: `Create a file named ${TARGET} in the workspace whose contents are exactly: ${PHRASE}`,
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

		const calledWrite = result.steps.some((step) => step.toolCall.name === "write_file");
		const confirmInvoked = confirmPrompts.includes("write_file");
		let fileContent: string | null = null;
		try {
			fileContent = await readFile(join(workspace, TARGET), "utf8");
		} catch {
			fileContent = null;
		}
		const fileWritten = fileContent !== null && fileContent.includes(PHRASE);
		const auditedConfirmedExecuted = audit.some(
			(record) => record.action === "sandbox_write" && record.decision === "confirm" && record.confirmed && record.executed,
		);

		log("");
		log("=== Chat agent CONFIRM-gate live verification ===");
		log(`Agent CALLED write_file:                    ${calledWrite ? "YES ✓" : "NO ⚠️"}`);
		log(`Confirm gate was invoked:                   ${confirmInvoked ? "YES ✓" : "NO ⚠️"}`);
		log(`File written to workspace with content:     ${fileWritten ? "YES ✓" : "NO ⚠️"}`);
		log(`Audit: confirmed + executed sandbox_write:  ${auditedConfirmedExecuted ? "YES ✓" : "NO ⚠️"}`);
		log(`Tool steps: ${result.steps.length}  hitIterationLimit: ${result.hitIterationLimit}`);
		log("");
		log(`Assistant reply: ${result.assistantMessage.content.trim().slice(0, 200)}`);
		log(`File content: ${fileContent === null ? "(not written)" : JSON.stringify(fileContent)}`);

		const ok = calledWrite && confirmInvoked && fileWritten && auditedConfirmedExecuted;
		log("");
		log(
			ok
				? "PASS ✓ a real model drove a write through the confirm gate; it ran only after approval and was audited."
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
