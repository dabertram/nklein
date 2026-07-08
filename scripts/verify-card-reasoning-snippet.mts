/**
 * Live card-reasoning-SNIPPET verification (§5.V L3688, 2026-07-08): drives a REAL NKlein task session against a
 * loaded local reasoning model and asserts the board-card snippet pipeline end-to-end — reasoning messages stream
 * during the thinking phase, the client-side derivation (web-ui deriveReasoningSnippetByTask over client upsert
 * semantics) yields a snippet that UPDATES while the model thinks, and the snippet yields back to the activity line
 * once a non-reasoning message follows.
 *
 * Run:  HOME=/tmp/nklein-verify-reasoning tsx scripts/verify-card-reasoning-snippet.mts
 *   env: NKLEIN_VERIFY_MODEL (default the resident reasoning coder), NKLEIN_VERIFY_BASE_URL, NKLEIN_VERIFY_TIMEOUT_MS.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { deriveReasoningSnippetByTask } from "../web-ui/src/components/board-reasoning-snippets";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";
import type { RuntimeTaskChatMessage } from "../src/core/task-chat-api-contract";
import { AgentSandboxManager } from "../src/nklein-agent/nklein-agent-sandbox";
import { createInMemoryNKleinTaskSessionService } from "../src/nklein-agent/nklein-task-session-service";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "qwopus3.5-9b-coder-mtp";
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "180000");

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

// Tolerate ONLY the vendored SDK's stray `session_stop` rejection (harness stops sessions directly); die on the rest.
process.on("unhandledRejection", (reason) => {
	const err = reason as { name?: string; reason?: string; message?: string } | undefined;
	if (
		err?.reason === "session_stop" ||
		err?.name === "AgentRuntimeAbortError" ||
		String(err?.message ?? reason).includes("session_stop")
	) {
		log(`(tolerated stray session_stop rejection: ${err?.message ?? String(reason)})`);
		return;
	}
	log(`FATAL unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
	process.exit(2);
});

/** Mirror web-ui upsertTaskChatMessage: replace by id in place, append new — position preserved. */
function upsertClientStyle(messages: RuntimeTaskChatMessage[], next: RuntimeTaskChatMessage): void {
	const index = messages.findIndex((message) => message.id === next.id);
	if (index < 0) {
		messages.push(next);
	} else {
		messages[index] = next;
	}
}

async function main(): Promise<void> {
	// Never load models — only test already-loaded ones (user directive 2026-06-28).
	await assertModelLoaded(BASE_URL, MODEL_ID);
	const home = homedir();
	if (!home.includes("nklein-verify") && process.env.NKLEIN_VERIFY_ALLOW_REAL_HOME !== "1") {
		throw new Error(`Refusing to run against HOME=${home}. Use an isolated dir (e.g. /tmp/nklein-verify-reasoning).`);
	}
	log(`Model: ${MODEL_ID}  BaseUrl: ${BASE_URL}`);

	const manager = new AgentSandboxManager();
	await manager.assertAvailable();
	log("Docker sandbox available ✓");

	const project = await mkdtemp(join(tmpdir(), "nklein-verify-snippet-"));
	await writeFile(join(project, "specification.md"), "# Tiny task\nDecide whether 91 is prime.\n", "utf8");
	await execFileAsync("git", ["-C", project, "init", "-q"]);
	await execFileAsync("git", ["-C", project, "config", "user.email", "verify@nklein.local"]);
	await execFileAsync("git", ["-C", project, "config", "user.name", "nklein-verify"]);
	await execFileAsync("git", ["-C", project, "add", "-A"]);
	await execFileAsync("git", ["-C", project, "commit", "-q", "-m", "seed"]);

	const service = createInMemoryNKleinTaskSessionService({ agentSandboxManager: manager });
	const taskId = `verify-snippet-${Date.now()}`;
	const messagesByTask: Record<string, RuntimeTaskChatMessage[]> = { [taskId]: [] };
	const snippetsSeen: string[] = [];
	let snippetClearedByFollowUp = false;
	let sawSnippetBeforeFollowUp = false;

	service.onMessage((tid, message) => {
		if (tid !== taskId) {
			return;
		}
		upsertClientStyle(messagesByTask[taskId] as RuntimeTaskChatMessage[], message);
		const snippet = deriveReasoningSnippetByTask(messagesByTask)[taskId];
		if (snippet && snippet !== snippetsSeen.at(-1)) {
			snippetsSeen.push(snippet);
		}
		if (!snippet && sawSnippetBeforeFollowUp && message.role !== "reasoning") {
			snippetClearedByFollowUp = true; // activity line takes the card back after thinking.
		}
		if (snippet) {
			sawSnippetBeforeFollowUp = true;
		}
	});

	let startError: unknown = null;
	void service
		.startTaskSession({
			taskId,
			cwd: project,
			workspaceRoot: project,
			baseRef: "HEAD",
			prompt: "Think step by step about whether 91 is a prime number, then state the answer in one line. Keep it brief.",
			providerId: "lmstudio",
			modelId: MODEL_ID,
			baseUrl: BASE_URL,
			contextWindow: 40000,
			timeoutMode: "long",
		})
		.catch((error) => {
			startError = error;
		});

	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		// Success needs the snippet to UPDATE (≥2 distinct values) and then yield to a follow-up message.
		if (snippetsSeen.length >= 2 && snippetClearedByFollowUp) {
			break;
		}
		const summary = service.getSummary(taskId);
		if (summary && (summary.state === "completed" || summary.state === "review" || summary.state === "failed")) {
			break;
		}
		if (startError) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	log("");
	log(`distinct snippet updates observed during thinking: ${snippetsSeen.length}`);
	for (const [index, snippet] of snippetsSeen.slice(0, 5).entries()) {
		log(`  snippet[${index}]: ${JSON.stringify(snippet)}`);
	}
	log(`SNIPPET UPDATED DURING THINKING (>=2 distinct): ${snippetsSeen.length >= 2}`);
	log(`SNIPPET YIELDED TO FOLLOW-UP MESSAGE: ${snippetClearedByFollowUp}`);
	if (startError) {
		log(`startError: ${String(startError).slice(0, 400)}`);
	}

	await service.stopTaskSession(taskId).catch(() => undefined);
	// Dispose only THIS task's workspace; the manager's idle timer reaps the now-empty container.
	await manager.disposeWorkspace(taskId).catch(() => undefined);
	await rm(project, { recursive: true, force: true }).catch(() => undefined);
	process.exit(snippetsSeen.length >= 2 && snippetClearedByFollowUp ? 0 : 1);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
