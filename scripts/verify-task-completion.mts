/**
 * Real-task COMPLETION verification (§5.V Pipeline e2e — the stage after decompose).
 *
 * Companion to verify-strict-isolation.mts. Instead of interrupting once the sandbox container appears, this
 * runs a single small implementation card to a TERMINAL state (review/completed) against live LM Studio +
 * Docker — proving a small local model can run a card to completion. Reports the final state and (with
 * NKLEIN_VERIFY_DUMP_ACTIVITIES=1) exactly what the agent did, so a non-completion can be triaged.
 *
 * Run:  HOME=/tmp/nklein-verify NKLEIN_VERIFY_MODEL=<id> tsx scripts/verify-task-completion.mts
 *   env: NKLEIN_VERIFY_PROVIDER (default lmstudio), NKLEIN_VERIFY_BASE_URL, NKLEIN_VERIFY_CONTEXT_WINDOW
 *        (default 40000), NKLEIN_VERIFY_TIMEOUT_MS (default 240000), NKLEIN_VERIFY_DUMP_ACTIVITIES.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolvePowerAwareTimeoutMs } from "../src/core/power-aware-timeout";
import { AgentSandboxManager } from "../src/nklein-agent/nklein-agent-sandbox";
import { createInMemoryNKleinTaskSessionService } from "../src/nklein-agent/nklein-task-session-service";

const execFileAsync = promisify(execFile);

const PROVIDER_ID = process.env.NKLEIN_VERIFY_PROVIDER?.trim() || "lmstudio";
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const CONTEXT_WINDOW = Number(process.env.NKLEIN_VERIFY_CONTEXT_WINDOW ?? "40000");
const BASE_TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "240000");

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

// A stray session_stop (or any late SDK promise) must not crash the harness before it reports — log + survive.
process.on("unhandledRejection", (reason) => {
	log(`[harness] unhandledRejection (ignored): ${reason instanceof Error ? reason.message : String(reason)}`);
});

async function resolveModelId(): Promise<string> {
	const explicit = process.env.NKLEIN_VERIFY_MODEL?.trim();
	if (explicit) {
		return explicit;
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
		throw new Error(`Refusing to run against HOME=${home}. Set HOME to an isolated dir (e.g. /tmp/nklein-verify).`);
	}
	const modelId = await resolveModelId();
	// Power-aware timeout: Low Power Mode (less heat) can cut throughput ~50% → scale the base budget by the OS power
	// mode (low ≈ ×2). NKLEIN_POWER_TIMEOUT_SCALE overrides (1 disables).
	const power = await resolvePowerAwareTimeoutMs(BASE_TIMEOUT_MS);
	const TIMEOUT_MS = power.timeoutMs;
	log(
		`Provider: ${PROVIDER_ID}  Model: ${modelId}  ctx: ${CONTEXT_WINDOW}  ` +
			`timeout: ${TIMEOUT_MS}ms (power=${power.mode} ×${power.multiplier}${power.source === "env_override" ? " env" : ""}, base ${BASE_TIMEOUT_MS}ms)`,
	);

	const manager = new AgentSandboxManager();
	await manager.assertAvailable();
	log("Docker sandbox available ✓");

	const project = await mkdtemp(join(tmpdir(), "nklein-verify-completion-"));
	await execFileAsync("git", ["-C", project, "init", "-q"]);
	await execFileAsync("git", ["-C", project, "config", "user.email", "verify@nklein.local"]);
	await execFileAsync("git", ["-C", project, "config", "user.name", "nklein-verify"]);
	await execFileAsync("git", ["-C", project, "commit", "-q", "--allow-empty", "-m", "init"]);
	log(`Temp project: ${project}`);

	const service = createInMemoryNKleinTaskSessionService({ agentSandboxManager: manager });
	const taskId = "verify-completion-1";
	const obs = { advanced: false, terminal: false, terminalState: "", lastState: "", error: "" };

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
		obs.lastState = summary.state;
		if (summary.state === "running" || summary.state === "awaiting_review" || summary.state === "completed") {
			obs.advanced = true;
		}
		// The session's done-state is "awaiting_review" (work captured, awaiting human review), not "review".
		if (summary.state === "awaiting_review" || summary.state === "completed") {
			obs.terminal = true;
			if (!obs.terminalState) {
				obs.terminalState = summary.state;
			}
		}
		const activity = summary.latestHookActivity;
		if (activity) {
			capture("text", activity.activityText);
			capture("toolInput", activity.toolInputSummary);
			capture("final", activity.finalMessage);
		}
	});

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
		if (obs.terminal || startError) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	if (startError) {
		obs.error = startError instanceof Error ? startError.message : String(startError);
	}

	await service.stopTaskSession(taskId).catch(() => null);
	unsubscribe();
	await service.dispose().catch(() => null);
	await startPromise.catch(() => null);

	// Delivery check (informational — the PASS gate stays on reaching a terminal state): the captured result lands
	// as an `nklein/tasks/<task>` branch; confirm the file is there with the right content. If none is found in the
	// project repo, the in-memory service only CAPTURES the patch (the trusted product runtime applies it) — useful
	// to know for designing the review→merge→deliver e2e.
	let resultBranch = "";
	let deliveredHello: string | null = null;
	try {
		const { stdout } = await execFileAsync("git", [
			"-C",
			project,
			"for-each-ref",
			"--format=%(refname:short)",
			"refs/heads/nklein",
		]);
		resultBranch =
			stdout
				.split("\n")
				.map((line) => line.trim())
				.find((line) => line.includes(taskId)) ?? "";
		if (resultBranch) {
			deliveredHello = await execFileAsync("git", ["-C", project, "show", `${resultBranch}:hello.txt`])
				.then(({ stdout: content }) => content)
				.catch(() => null);
		}
	} catch {
		/* no nklein/tasks branch in the project repo */
	}

	await rm(project, { recursive: true, force: true }).catch(() => null);

	log("");
	log("=== Task completion result ===");
	log(`Session advanced (running/review/completed): ${obs.advanced ? "YES" : "NO"}`);
	log(
		`Reached terminal (awaiting_review/completed): ${obs.terminal ? `YES (${obs.terminalState})` : `NO (last: ${obs.lastState || "n/a"})`}`,
	);
	if (obs.error) {
		log(`Start error: ${obs.error}`);
	}
	log(`Result branch in project repo: ${resultBranch || "none found (captured in sandbox; applied by the runtime)"}`);
	log(
		`Delivered hello.txt: ${
			deliveredHello === null
				? "n/a"
				: deliveredHello.includes("Hello from the sandbox")
					? "CONTENT MATCHES ✓"
					: `unexpected (${JSON.stringify(deliveredHello.slice(0, 80))})`
		}`,
	);
	if (process.env.NKLEIN_VERIFY_DUMP_ACTIVITIES === "1") {
		log("");
		log("=== Agent activities (oldest→newest, deduped) ===");
		emitted.forEach((line, index) => log(`  ${index + 1}. ${line.slice(0, 280)}`));
	}

	log("");
	// A structured, paste-ready row for docs/dev/model-sweep-log.md (the per-run scoreboard) — the harness collects the
	// facts; a human/agent adds the judgment note (🚀/🐢/🐞/…).
	log(
		`SWEEP-ROW | ${new Date().toISOString()} | C0 single-card | model=${modelId} | ` +
			`result=${obs.terminal ? "PASS ✓" : "INCOMPLETE ⏳"} | terminal=${obs.terminal ? obs.terminalState : obs.lastState || "n/a"} | ` +
			`power=${power.mode}×${power.multiplier}`,
	);
	log(
		obs.terminal
			? "PASS ✓ a small local model ran the card to a terminal state (awaiting_review/completed) with its result captured."
			: "INCOMPLETE — the card did not reach awaiting_review/completed within the timeout (see activities).",
	);
	process.exit(obs.terminal ? 0 : 1);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
