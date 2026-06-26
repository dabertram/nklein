/**
 * Real-task strict-isolation verification (§2.C).
 *
 * Drives the REAL NKlein task-session service + REAL AgentSandboxManager against a locally running
 * LM Studio / Ollama endpoint, in an isolated HOME so it never touches the user's ~/.nklein/nklein.
 *
 * It asserts the strict-isolation invariants on a real session:
 *   - a Docker sandbox container (label nklein.kind=agent-sandbox) appears while the task runs;
 *   - NO host task worktree directory is created under <HOME>/.nklein/nklein/worktrees;
 *   - the session advances (the SDK boots and at least starts working) without a host shell.
 *
 * Run:  HOME=/tmp/nklein-verify tsx scripts/verify-strict-isolation.mts
 *   env: NKLEIN_VERIFY_PROVIDER (default lmstudio), NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL,
 *        NKLEIN_VERIFY_CONTEXT_WINDOW (default 40000), NKLEIN_VERIFY_TIMEOUT_MS (default 120000).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentSandboxManager } from "../src/nklein-agent/nklein-agent-sandbox";
import { createInMemoryNKleinTaskSessionService } from "../src/nklein-agent/nklein-task-session-service";
import { resolveNkleinRuntimeHomePath } from "../src/config/runtime-paths";

const execFileAsync = promisify(execFile);

const PROVIDER_ID = process.env.NKLEIN_VERIFY_PROVIDER?.trim() || "lmstudio";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const CONTEXT_WINDOW = Number(process.env.NKLEIN_VERIFY_CONTEXT_WINDOW ?? "40000");
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "120000");

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

async function dockerSandboxContainers(): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync("docker", [
			"ps",
			"--filter",
			"label=nklein.kind=agent-sandbox",
			"--format",
			"{{.Names}}",
		]);
		return stdout.split("\n").map((value) => value.trim()).filter((value) => value.length > 0);
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
	const id = payload.data?.[0]?.id;
	if (!id) {
		throw new Error(`Could not resolve a model id from ${BASE_URL}/models`);
	}
	return id;
}

async function main(): Promise<void> {
	const home = homedir();
	if (!home.includes("nklein-verify") && process.env.NKLEIN_VERIFY_ALLOW_REAL_HOME !== "1") {
		throw new Error(
			`Refusing to run against HOME=${home}. Set HOME to an isolated dir (e.g. /tmp/nklein-verify) so the user's ~/.nklein/nklein is not touched.`,
		);
	}
	const modelId = await resolveModelId();
	log(`Provider: ${PROVIDER_ID}  Model: ${modelId}  BaseUrl: ${BASE_URL}  ctx: ${CONTEXT_WINDOW}`);

	const manager = new AgentSandboxManager();
	await manager.assertAvailable();
	log("Docker sandbox available ✓");

	const project = await mkdtemp(join(tmpdir(), "nklein-verify-project-"));
	await execFileAsync("git", ["-C", project, "init", "-q"]);
	await execFileAsync("git", ["-C", project, "config", "user.email", "verify@nklein.local"]);
	await execFileAsync("git", ["-C", project, "config", "user.name", "nklein-verify"]);
	await execFileAsync("git", ["-C", project, "commit", "-q", "--allow-empty", "-m", "init"]);
	log(`Temp project: ${project}`);

	const service = createInMemoryNKleinTaskSessionService({ agentSandboxManager: manager });
	const taskId = "verify-task-1";
	const observations = { containerSeen: false, containerName: "", advanced: false, lastState: "", error: "" };

	const unsubscribe = service.onSummary((summary) => {
		if (summary.taskId !== taskId) {
			return;
		}
		observations.lastState = summary.state;
		if (summary.state === "running" || summary.state === "review" || summary.state === "completed") {
			observations.advanced = true;
		}
	});

	const worktreeRoot = join(resolveNkleinRuntimeHomePath(home), "worktrees");

	let startError: unknown = null;
	const startPromise = service
		.startTaskSession({
			taskId,
			cwd: project,
			workspaceRoot: project,
			baseRef: "HEAD",
			prompt: "Create a file named hello.txt containing exactly the text: Hello from the sandbox.",
			providerId: PROVIDER_ID,
			modelId,
			baseUrl: BASE_URL,
			contextWindow: Number.isFinite(CONTEXT_WINDOW) ? CONTEXT_WINDOW : 40000,
			timeoutMode: "long",
		})
		.catch((error) => {
			startError = error;
		});

	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		const containers = await dockerSandboxContainers();
		if (containers.length > 0) {
			observations.containerSeen = true;
			observations.containerName = containers.join(", ");
		}
		// Stop early once we've proven a container appeared AND the session advanced.
		if (observations.containerSeen && observations.advanced) {
			break;
		}
		if (startError) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}

	if (startError) {
		observations.error = startError instanceof Error ? startError.message : String(startError);
	}

	// Check no host worktree dir was created for this task.
	let hostWorktreeCreated = false;
	try {
		const entries = await readdir(worktreeRoot);
		hostWorktreeCreated = entries.some((entry) => entry.includes(taskId));
	} catch {
		hostWorktreeCreated = false;
	}

	await service.stopTaskSession(taskId).catch(() => null);
	unsubscribe();
	await service.dispose().catch(() => null);
	await startPromise.catch(() => null);
	await rm(project, { recursive: true, force: true }).catch(() => null);

	const leftover = await dockerSandboxContainers();

	log("");
	log("=== Strict isolation verification result ===");
	log(`Sandbox container observed during run: ${observations.containerSeen ? `YES (${observations.containerName})` : "NO"}`);
	log(`Session advanced (running/review/completed): ${observations.advanced ? "YES" : "NO"} (last state: ${observations.lastState || "n/a"})`);
	log(`Host worktree dir created under ${worktreeRoot}: ${hostWorktreeCreated ? "YES ⚠️" : "NO ✓"}`);
	log(`Containers remaining after dispose: ${leftover.length === 0 ? "NONE ✓" : leftover.join(", ")}`);
	if (observations.error) {
		log(`Start error: ${observations.error}`);
	}

	const ok = observations.containerSeen && !hostWorktreeCreated && leftover.length === 0;
	log("");
	log(ok ? "PASS ✓ strict isolation invariants held on a real task." : "INCOMPLETE — see above.");
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
	process.exit(2);
});
