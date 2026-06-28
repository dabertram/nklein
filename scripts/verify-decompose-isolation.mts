/**
 * Real-task DECOMPOSE host-path-isolation verification (§5.A HARDEN: "agents must never see host details").
 *
 * Companion to verify-strict-isolation.mts. Drives a REAL NKlein task-session against a locally running
 * LM Studio / Ollama endpoint, in an isolated HOME, asking the agent to read a spec and decompose the project.
 * It then asserts that NOTHING the agent EMITS (its reasoning/activity text, tool-input summaries, and final
 * message — captured off the live summary stream) contains the host project mount path. With the cwd fix
 * (the agent's working directory is `/workspaces/<taskId>`, never the host mount) and the decompose-result
 * relativization, a sandboxed planning agent should only ever surface sandbox/relative paths.
 *
 * Run:  HOME=/tmp/nklein-verify tsx scripts/verify-decompose-isolation.mts
 *   env: NKLEIN_VERIFY_PROVIDER (default lmstudio), NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL,
 *        NKLEIN_VERIFY_CONTEXT_WINDOW (default 40000), NKLEIN_VERIFY_TIMEOUT_MS (default 180000).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveNkleinRuntimeHomePath } from "../src/config/runtime-paths";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";
import { AgentSandboxManager } from "../src/nklein-agent/nklein-agent-sandbox";
import { createInMemoryNKleinTaskSessionService } from "../src/nklein-agent/nklein-task-session-service";

const execFileAsync = promisify(execFile);

const PROVIDER_ID = process.env.NKLEIN_VERIFY_PROVIDER?.trim() || "lmstudio";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const CONTEXT_WINDOW = Number(process.env.NKLEIN_VERIFY_CONTEXT_WINDOW ?? "40000");
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "180000");

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

const SPEC = `# Habit Tracker — Specification

Build a small local habit-tracking app.

## Goals
- Persist habits and daily check-ins to local storage.
- A UI to add habits, mark them done for the day, and see a streak count.
- A weekly summary view.

## Constraints
- TypeScript. No cloud services. Small, dependency-light.
`;

async function main(): Promise<void> {
	const home = homedir();
	if (!home.includes("nklein-verify") && process.env.NKLEIN_VERIFY_ALLOW_REAL_HOME !== "1") {
		throw new Error(
			`Refusing to run against HOME=${home}. Set HOME to an isolated dir (e.g. /tmp/nklein-verify) so the user's ~/.nklein/nklein is not touched.`,
		);
	}
	const modelId = await resolveModelId();
	// Never load models — only test ALREADY-loaded ones (user directive 2026-06-28). Refuse a non-resident model.
	await assertModelLoaded(BASE_URL, modelId);
	log(`Provider: ${PROVIDER_ID}  Model: ${modelId}  BaseUrl: ${BASE_URL}  ctx: ${CONTEXT_WINDOW}`);

	const manager = new AgentSandboxManager();
	await manager.assertAvailable();
	log("Docker sandbox available ✓");

	const project = await mkdtemp(join(tmpdir(), "nklein-verify-decompose-"));
	const projectReal = await realpath(project);
	await writeFile(join(project, "specification.md"), SPEC, "utf8");
	// A couple of real TS files so the repo-map orientation rail has symbols to render (verifies the repo map is
	// built from the HOST project root again under isolation, not the nonexistent sandbox path).
	await writeFile(
		join(project, "storage.ts"),
		"export interface Habit { id: string; name: string }\nexport function saveHabit(h: Habit): void {}\n",
		"utf8",
	);
	await writeFile(
		join(project, "app.ts"),
		"import { saveHabit } from './storage';\nexport function addHabit(name: string) { saveHabit({ id: '1', name }); }\n",
		"utf8",
	);
	await execFileAsync("git", ["-C", project, "init", "-q"]);
	await execFileAsync("git", ["-C", project, "config", "user.email", "verify@nklein.local"]);
	await execFileAsync("git", ["-C", project, "config", "user.name", "nklein-verify"]);
	await execFileAsync("git", ["-C", project, "add", "-A"]);
	await execFileAsync("git", ["-C", project, "commit", "-q", "-m", "seed spec"]);
	log(`Temp project: ${project}  (realpath: ${projectReal})`);

	// The host mount paths the agent must NEVER surface. Check raw + macOS-realpath + the shared tmp parent.
	const hostPathNeedles = Array.from(
		new Set([project, projectReal, await realpath(tmpdir()).catch(() => tmpdir())].filter(Boolean)),
	);

	const service = createInMemoryNKleinTaskSessionService({ agentSandboxManager: manager });
	const taskId = "verify-decompose-1";
	const observations = { containerSeen: false, advanced: false, lastState: "", error: "", decomposeSeen: false };

	// Capture everything the AGENT emits off the live summary stream (deduped) so we can scan it for host paths.
	const emitted: string[] = [];
	const seen = new Set<string>();
	const capture = (label: string, value: string | null | undefined): void => {
		if (!value) {
			return;
		}
		const key = `${label}:${value}`;
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		emitted.push(`[${label}] ${value}`);
	};

	const unsubscribe = service.onSummary((summary) => {
		if (summary.taskId !== taskId) {
			return;
		}
		observations.lastState = summary.state;
		if (summary.state === "running" || summary.state === "review" || summary.state === "completed") {
			observations.advanced = true;
		}
		const activity = summary.latestHookActivity;
		if (activity) {
			capture("text", activity.activityText);
			capture("toolInput", activity.toolInputSummary);
			capture("final", activity.finalMessage);
			if (activity.toolName === "decompose_project" || summary.state === "review" || summary.state === "completed") {
				observations.decomposeSeen = observations.decomposeSeen || activity.toolName === "decompose_project";
			}
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
			prompt:
				"You are the planning architect for this project. First read specification.md to understand the idea, " +
				"then break it into a small dependency-ordered set of executable cards and persist the plan by calling " +
				"the decompose_project tool. Do not implement the cards yourself.",
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
		}
		// Stop early once the agent has decomposed (or the task reached a terminal review/completed state).
		if (observations.decomposeSeen || observations.lastState === "completed" || observations.lastState === "review") {
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

	// Scan everything the agent emitted for any host mount path.
	const leaks = emitted.filter((line) => hostPathNeedles.some((needle) => line.includes(needle)));

	await rm(project, { recursive: true, force: true }).catch(() => null);
	const leftover = await dockerSandboxContainers();

	log("");
	log("=== Decompose host-path isolation result ===");
	log(`Sandbox container observed: ${observations.containerSeen ? "YES" : "NO"}`);
	log(`Session advanced: ${observations.advanced ? "YES" : "NO"} (last state: ${observations.lastState || "n/a"})`);
	log(`decompose_project called: ${observations.decomposeSeen ? "YES" : "NO"}`);
	log(`Host worktree created under ${worktreeRoot}: ${hostWorktreeCreated ? "YES ⚠️" : "NO ✓"}`);
	log(`Agent-emitted activities captured: ${emitted.length}`);
	log(`Host-path leaks in agent output: ${leaks.length === 0 ? "NONE ✓" : `${leaks.length} ⚠️`}`);
	for (const leak of leaks.slice(0, 10)) {
		log(`  LEAK: ${leak.slice(0, 240)}`);
	}
	if (observations.error) {
		log(`Start error: ${observations.error}`);
	}
	log(`Containers remaining after dispose: ${leftover.length === 0 ? "NONE ✓" : leftover.join(", ")}`);

	// Diagnostic: dump what the agent actually emitted (set NKLEIN_VERIFY_DUMP_ACTIVITIES=1) so a "decompose
	// not called" result can be triaged — reading loop vs. reasoning vs. a malformed/narrated tool call.
	if (process.env.NKLEIN_VERIFY_DUMP_ACTIVITIES === "1") {
		log("");
		log("=== Agent activities (oldest→newest, deduped) ===");
		emitted.forEach((line, index) => log(`  ${index + 1}. ${line.slice(0, 280)}`));
	}

	// The core assertion is the absence of host-path leaks. We also require the container appeared and no worktree.
	const ok = leaks.length === 0 && observations.containerSeen && !hostWorktreeCreated && leftover.length === 0;
	log("");
	log(
		ok
			? "PASS ✓ no host path leaked into the agent's output during a real decompose."
			: "INCOMPLETE — see above.",
	);
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
	process.exit(2);
});
