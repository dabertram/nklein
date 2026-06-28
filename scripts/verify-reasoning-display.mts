/**
 * Live reasoning-display verification (2026-06-27): drives a REAL NKlein task session against a local reasoning model
 * and asserts that the agent path actually emits `reasoning`-role messages (the in-card "Reasoning" block). Rules out a
 * real-runtime subtlety after the static trace concluded the reasoning_content → reasoning-message pipeline is wired.
 *
 * Run:  HOME=/tmp/nklein-verify-reasoning tsx scripts/verify-reasoning-display.mts
 *   env: NKLEIN_VERIFY_MODEL (default a known reasoning model), NKLEIN_VERIFY_BASE_URL, NKLEIN_VERIFY_TIMEOUT_MS.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentSandboxManager } from "../src/nklein-agent/nklein-agent-sandbox";
import { createInMemoryNKleinTaskSessionService } from "../src/nklein-agent/nklein-task-session-service";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "microsoft/phi-4-mini-reasoning";
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "150000");

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
	// Never load models — only test already-loaded ones (user directive 2026-06-28). Refuse a specified non-resident model.
	if (MODEL_ID) {
		await assertModelLoaded(BASE_URL, MODEL_ID);
	}
	const home = homedir();
	if (!home.includes("nklein-verify") && process.env.NKLEIN_VERIFY_ALLOW_REAL_HOME !== "1") {
		throw new Error(`Refusing to run against HOME=${home}. Use an isolated dir (e.g. /tmp/nklein-verify-reasoning).`);
	}
	log(`Model: ${MODEL_ID}  BaseUrl: ${BASE_URL}`);

	const manager = new AgentSandboxManager();
	await manager.assertAvailable();
	log("Docker sandbox available ✓");

	const project = await mkdtemp(join(tmpdir(), "nklein-verify-reasoning-"));
	await writeFile(join(project, "specification.md"), "# Tiny task\nDecide whether 51 is prime.\n", "utf8");
	await execFileAsync("git", ["-C", project, "init", "-q"]);
	await execFileAsync("git", ["-C", project, "config", "user.email", "verify@nklein.local"]);
	await execFileAsync("git", ["-C", project, "config", "user.name", "nklein-verify"]);
	await execFileAsync("git", ["-C", project, "add", "-A"]);
	await execFileAsync("git", ["-C", project, "commit", "-q", "-m", "seed"]);

	const service = createInMemoryNKleinTaskSessionService({ agentSandboxManager: manager });
	const taskId = `verify-reasoning-${Date.now()}`;
	const roleCounts: Record<string, number> = {};
	let reasoningPreview = "";

	service.onMessage((tid, message) => {
		if (tid !== taskId) {
			return;
		}
		roleCounts[message.role] = (roleCounts[message.role] ?? 0) + 1;
		if (message.role === "reasoning" && !reasoningPreview && message.content.trim()) {
			reasoningPreview = message.content.trim().slice(0, 160);
		}
	});

	let startError: unknown = null;
	void service
		.startTaskSession({
			taskId,
			cwd: project,
			workspaceRoot: project,
			baseRef: "HEAD",
			prompt: "Think step by step about whether 51 is a prime number, then state the answer in one line. Keep it brief.",
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
		if ((roleCounts.reasoning ?? 0) > 0) {
			break;
		}
		const summary = service.getSummary(taskId);
		if (summary && (summary.state === "completed" || summary.state === "review" || summary.state === "failed")) {
			break;
		}
		if (startError) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}

	log("");
	log(`message roles seen: ${JSON.stringify(roleCounts)}`);
	log(`REASONING MESSAGES EMITTED: ${(roleCounts.reasoning ?? 0) > 0}`);
	log(`reasoning preview: ${JSON.stringify(reasoningPreview)}`);
	if (startError) {
		log(`startError: ${String(startError).slice(0, 400)}`);
	}

	await service.stopTaskSession(taskId).catch(() => undefined);
	// Dispose only THIS task's workspace (not `stopNow()`, which would tear down sibling containers a concurrent
	// runtime may be using); the manager's idle timer reaps the now-empty container.
	await manager.disposeWorkspace(taskId).catch(() => undefined);
	await rm(project, { recursive: true, force: true }).catch(() => undefined);
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
