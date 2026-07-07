/**
 * Live restart→resume strict-isolation verification (todo §5.A / §5.U).
 *
 * Proves the fix for "a task resumed after a runtime process restart re-preps its Docker sandbox" — i.e.
 * the rebuild path (startRuntimeTaskSessionFromLaunchConfig) prepares a sandbox + sandbox tools instead of
 * running the agent with host file tools on a non-existent sandbox cwd (invariant #2).
 *
 * Flow (against a live LM Studio / Ollama endpoint + real Docker, in an isolated HOME):
 *   1. Service A starts a real isolated task → a sandbox container appears; let it advance, then DISPOSE A
 *      (simulating a runtime process shutdown). The SDK session record persists on disk in HOME.
 *   2. A FRESH service B (new in-memory maps — the "restarted process") reloadTaskSession(taskId)s it. The
 *      rebuild must re-prep a NEW sandbox container for the resumed task.
 *   3. Assert: a container appeared during B's resume, no host worktree was created, the agent emitted no
 *      host project path, and no containers leak after dispose.
 *
 * Run:  HOME=/tmp/nklein-verify tsx scripts/verify-restart-resume-isolation.mts
 *   env: NKLEIN_VERIFY_PROVIDER (default lmstudio), NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL,
 *        NKLEIN_VERIFY_CONTEXT_WINDOW (default 40000), NKLEIN_VERIFY_TIMEOUT_MS (default 150000).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveNkleinRuntimeHomePath } from "../src/config/runtime-paths";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";
import { resolvePowerAwareTimeoutMs } from "../src/core/power-aware-timeout";
import { AgentSandboxManager } from "../src/nklein-agent/nklein-agent-sandbox";
import { createInMemoryNKleinTaskSessionService } from "../src/nklein-agent/nklein-task-session-service";

const execFileAsync = promisify(execFile);

const PROVIDER_ID = process.env.NKLEIN_VERIFY_PROVIDER?.trim() || "lmstudio";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const CONTEXT_WINDOW = Number(process.env.NKLEIN_VERIFY_CONTEXT_WINDOW ?? "40000");
const BASE_TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "150000");
const TASK_ID = "verify-restart-task-1";

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

// Resilience: tolerate the vendored SDK's stray `session_stop` rejection from a session stopped mid-run (see
// src/server/runtime-process-guards.ts) — this harness drives + stops sessions directly, so without this the stray
// rejection can crash the process before the result prints. Swallow ONLY that benign abort; fail loudly on anything else.
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

async function dockerSandboxContainers(): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync("docker", [
			"ps",
			"--filter",
			"label=nklein.kind=agent-sandbox",
			"--format",
			"{{.Names}}",
		]);
		return stdout
			.split("\n")
			.map((value) => value.trim())
			.filter((value) => value.length > 0);
	} catch {
		return [];
	}
}

async function resolveModelId(): Promise<string> {
	if (MODEL_ID) {
		return MODEL_ID;
	}
	const { stdout } = await execFileAsync("curl", ["-s", "--max-time", "5", `${BASE_URL}/models`]);
	const payload = JSON.parse(stdout) as { data?: Array<{ id?: string }> };
	const id = payload.data?.find((entry) => !entry.id?.includes("embed"))?.id ?? payload.data?.[0]?.id;
	if (!id) {
		throw new Error(`Could not resolve a model id from ${BASE_URL}/models`);
	}
	return id;
}

async function waitForContainer(deadline: number): Promise<string> {
	while (Date.now() < deadline) {
		const containers = await dockerSandboxContainers();
		if (containers.length > 0) {
			return containers.join(", ");
		}
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
	return "";
}

async function main(): Promise<void> {
	// Power-aware: Low Power Mode (~50% throughput) ⇒ scale the budget so slow models don't spuriously time out.
	const power = await resolvePowerAwareTimeoutMs(BASE_TIMEOUT_MS);
	const TIMEOUT_MS = power.timeoutMs;
	const home = homedir();
	if (!home.includes("nklein-verify") && process.env.NKLEIN_VERIFY_ALLOW_REAL_HOME !== "1") {
		throw new Error(
			`Refusing to run against HOME=${home}. Set HOME to an isolated dir (e.g. /tmp/nklein-verify) so the user's ~/.nklein/nklein is not touched.`,
		);
	}
	const modelId = await resolveModelId();
	log(`Provider: ${PROVIDER_ID}  Model: ${modelId}  BaseUrl: ${BASE_URL}  ctx: ${CONTEXT_WINDOW}`);

	const managerA = new AgentSandboxManager();
	await managerA.assertAvailable();
	log("Docker sandbox available ✓");
	// Never load models — only test already-loaded ones (user directive 2026-06-28). Refuse a specified non-resident model.
	if (MODEL_ID) {
		await assertModelLoaded(BASE_URL, MODEL_ID);
	}

	const project = await mkdtemp(join(tmpdir(), "nklein-verify-project-"));
	await execFileAsync("git", ["-C", project, "init", "-q"]);
	await execFileAsync("git", ["-C", project, "config", "user.email", "verify@nklein.local"]);
	await execFileAsync("git", ["-C", project, "config", "user.name", "nklein-verify"]);
	await execFileAsync("git", ["-C", project, "commit", "-q", "--allow-empty", "-m", "init"]);
	log(`Temp project: ${project}`);

	const worktreeRoot = join(resolveNkleinRuntimeHomePath(home), "worktrees");
	const leakedHostPaths: string[] = [];
	const containerWindow = Number.isFinite(CONTEXT_WINDOW) ? CONTEXT_WINDOW : 40000;

	// --- Phase 1: start the task in service A, then dispose A (simulated process shutdown). ---
	const serviceA = createInMemoryNKleinTaskSessionService({ agentSandboxManager: managerA });
	let advancedA = false;
	const unsubA = serviceA.onSummary((summary) => {
		if (summary.taskId === TASK_ID && ["running", "review", "awaiting_review", "completed"].includes(summary.state)) {
			advancedA = true;
		}
	});
	let startError: unknown = null;
	const startPromise = serviceA
		.startTaskSession({
			taskId: TASK_ID,
			cwd: project,
			workspaceRoot: project,
			baseRef: "HEAD",
			prompt: "Create a file named hello.txt containing exactly: Hello from the sandbox.",
			providerId: PROVIDER_ID,
			modelId,
			baseUrl: BASE_URL,
			contextWindow: containerWindow,
			timeoutMode: "long",
		})
		.catch((error) => {
			startError = error;
		});

	const deadline = Date.now() + TIMEOUT_MS;
	const containerA = await waitForContainer(deadline);
	// Let the first session advance a little so a real record is persisted.
	while (Date.now() < deadline && !advancedA && !startError) {
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
	log(`Phase 1 — service A: container=${containerA || "NONE"}  advanced=${advancedA ? "yes" : "no"}`);

	await serviceA.stopTaskSession(TASK_ID).catch(() => null);
	unsubA();
	await serviceA.dispose().catch(() => null);
	await startPromise.catch(() => null);
	// Give Docker a moment to tear down A's container so the next container we see is B's.
	await new Promise((resolve) => setTimeout(resolve, 3000));
	const afterADispose = await dockerSandboxContainers();
	log(`Phase 1 — after service A dispose: containers=${afterADispose.length === 0 ? "NONE ✓" : afterADispose.join(", ")}`);

	// --- Phase 2: a FRESH service B (the "restarted process") resumes the task. ---
	const managerB = new AgentSandboxManager();
	await managerB.assertAvailable();
	const serviceB = createInMemoryNKleinTaskSessionService({ agentSandboxManager: managerB });
	const unsubB = serviceB.onSummary((summary) => {
		if (summary.taskId !== TASK_ID) {
			return;
		}
		const haystack = `${summary.workspacePath ?? ""} ${summary.latestHookActivity?.activityText ?? ""} ${summary.latestHookActivity?.toolInputSummary ?? ""}`;
		if (haystack.includes(project)) {
			leakedHostPaths.push(haystack.trim());
		}
	});
	const unsubBMsg = serviceB.onMessage((taskId, message) => {
		if (taskId === TASK_ID && typeof message.content === "string" && message.content.includes(project)) {
			leakedHostPaths.push(message.content.slice(0, 200));
		}
	});

	let resumeError: unknown = null;
	const resumePromise = serviceB.reloadTaskSession(TASK_ID).catch((error) => {
		resumeError = error;
	});
	const resumeDeadline = Date.now() + TIMEOUT_MS;
	const containerB = await waitForContainer(resumeDeadline);
	// Let the resumed session advance briefly.
	const briefDeadline = Date.now() + 20000;
	while (Date.now() < briefDeadline && !resumeError) {
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
	log(`Phase 2 — service B (resume): container=${containerB || "NONE"}  resumeError=${resumeError ? "yes" : "no"}`);

	let hostWorktreeCreated = false;
	try {
		const entries = await readdir(worktreeRoot);
		hostWorktreeCreated = entries.some((entry) => entry.includes(TASK_ID));
	} catch {
		hostWorktreeCreated = false;
	}

	await serviceB.stopTaskSession(TASK_ID).catch(() => null);
	unsubB();
	unsubBMsg();
	await serviceB.dispose().catch(() => null);
	await resumePromise.catch(() => null);
	await rm(project, { recursive: true, force: true }).catch(() => null);
	await new Promise((resolve) => setTimeout(resolve, 2000));
	const leftover = await dockerSandboxContainers();

	log("");
	log("=== Restart→resume isolation verification result ===");
	log(`Phase 1 sandbox container observed:        ${containerA ? `YES (${containerA})` : "NO"}`);
	log(`Phase 2 RESUME re-prepped a container:     ${containerB ? `YES (${containerB}) ✓` : "NO ⚠️"}`);
	log(`Host worktree dir created:                 ${hostWorktreeCreated ? "YES ⚠️" : "NO ✓"}`);
	log(`Host project path leaked to the agent:     ${leakedHostPaths.length === 0 ? "NO ✓" : `YES ⚠️ (${leakedHostPaths.length})`}`);
	log(`Containers remaining after dispose:        ${leftover.length === 0 ? "NONE ✓" : leftover.join(", ")}`);
	if (resumeError) {
		log(`Resume error: ${resumeError instanceof Error ? resumeError.message : String(resumeError)}`);
	}
	for (const leak of leakedHostPaths.slice(0, 5)) {
		log(`  leak: ${leak}`);
	}

	const ok = Boolean(containerB) && !hostWorktreeCreated && leakedHostPaths.length === 0 && leftover.length === 0;
	log("");
	log(ok ? "PASS ✓ a resumed-after-restart task re-preps its sandbox; no host leak." : "INCOMPLETE — see above.");
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
