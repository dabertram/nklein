/**
 * Live verification of §5.B Increment C — auto-promote recovery.
 *
 * A started WORK card enters the Planning/Refinement lane and is *meant* to call the explicit `begin_implementation`
 * tool before it writes code. A weak/quantized local model may skip that and just start editing the repo. Increment C
 * recovers from the behavior: when such a card gets its FIRST approved repo-mutating tool, the runtime auto-promotes it
 * Planning → In Progress so the lane reflects reality (parse-and-recover, like narrated tool calls).
 *
 * This harness seeds a real workspace board with a work card sitting in Planning, starts a REAL Docker-sandboxed
 * session against a live LM Studio model with `onCardPromoted` wired (exactly as the runtime wires it for work cards),
 * nudges the agent to implement a trivial file change, and polls the on-disk board until the card reaches In Progress.
 * It reports HOW it advanced — `begin_implementation` (explicit) or the auto-promote recovery (the card moved while
 * `begin_implementation` was never called) — and asserts the lane advanced at all. It also scans the agent's emitted
 * output for host-path leaks (the §5.A invariant) as a bonus.
 *
 * Run:  HOME=/tmp/nklein-verify tsx scripts/verify-autopromote-recovery.mts
 *   env: NKLEIN_VERIFY_PROVIDER (default lmstudio), NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL,
 *        NKLEIN_VERIFY_CONTEXT_WINDOW (default 40000), NKLEIN_VERIFY_TIMEOUT_MS (default 240000).
 */
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RuntimeBoardData } from "../src/core/api-contract";
import type { NKleinCardPromotedEvent } from "../src/nklein-agent/nklein-promotion-tool";
import { AgentSandboxManager } from "../src/nklein-agent/nklein-agent-sandbox";
import { createInMemoryNKleinTaskSessionService } from "../src/nklein-agent/nklein-task-session-service";
import { loadWorkspaceState, saveWorkspaceState } from "../src/state/workspace-state";

const execFileAsync = promisify(execFile);

const PROVIDER_ID = process.env.NKLEIN_VERIFY_PROVIDER?.trim() || "lmstudio";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const CONTEXT_WINDOW = Number(process.env.NKLEIN_VERIFY_CONTEXT_WINDOW ?? "40000");
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "240000");

const TASK_ID = "verify-autopromote-card";
// The repo-mutating tools whose first approval should trigger the auto-promote (mirrors REPO_MAP_INVALIDATING_TOOL_NAMES).
const WRITE_TOOL_NAMES = new Set([
	"write_file",
	"write_files",
	"edit_file",
	"apply_patch",
	"bash",
	"terminal",
	"run_command",
]);

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
	const id = payload.data?.[0]?.id;
	if (!id) {
		throw new Error(`Could not resolve a model id from ${BASE_URL}/models`);
	}
	return id;
}

/** A board with one WORK card (startInPlanMode false) sitting in the Planning lane — the Increment C precondition. */
function seedBoard(): RuntimeBoardData {
	const now = Date.now();
	const card = {
		id: TASK_ID,
		title: "Create greeting file",
		prompt: "Create a file named GREETING.txt whose only line is: hello from the agent",
		startInPlanMode: false,
		baseRef: "HEAD",
		createdAt: now,
		updatedAt: now,
	};
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [card] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

async function columnOfCard(project: string): Promise<string | null> {
	const state = await loadWorkspaceState(project);
	for (const column of state.board.columns) {
		if (column.cards.some((c) => c.id === TASK_ID)) {
			return column.id;
		}
	}
	return null;
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

	const project = await mkdtemp(join(tmpdir(), "nklein-verify-autopromote-"));
	const projectReal = await realpath(project);
	await writeFile(
		join(project, "README.md"),
		"# Greeting demo\n\nA tiny project. The only task is to add a GREETING.txt file.\n",
		"utf8",
	);
	await execFileAsync("git", ["-C", project, "init", "-q"]);
	await execFileAsync("git", ["-C", project, "config", "user.email", "verify@nklein.local"]);
	await execFileAsync("git", ["-C", project, "config", "user.name", "nklein-verify"]);
	await execFileAsync("git", ["-C", project, "add", "-A"]);
	await execFileAsync("git", ["-C", project, "commit", "-q", "-m", "seed"]);
	// Seed the board: the work card starts in Planning, exactly as the start path would route it.
	await saveWorkspaceState(project, { board: seedBoard() });
	log(`Temp project: ${project}  (card seeded in Planning)`);

	const hostPathNeedles = Array.from(
		new Set([project, projectReal, await realpath(tmpdir()).catch(() => tmpdir())].filter(Boolean)),
	);

	const promotions: NKleinCardPromotedEvent[] = [];
	const service = createInMemoryNKleinTaskSessionService({
		agentSandboxManager: manager,
		// Wired exactly as the runtime wires it for a work card — its presence also activates the Increment C recovery.
		onCardPromoted: (event) => {
			promotions.push(event);
		},
	});

	const observations = {
		containerSeen: false,
		beginImplCalled: false,
		writeToolSeen: false,
		reachedInProgress: false,
		firstInProgressVia: "" as "" | "begin_implementation" | "auto-promote",
		lastState: "",
		error: "",
	};

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
		if (summary.taskId !== TASK_ID) {
			return;
		}
		observations.lastState = summary.state;
		const activity = summary.latestHookActivity;
		if (activity) {
			capture("text", activity.activityText);
			capture("toolInput", activity.toolInputSummary);
			capture("final", activity.finalMessage);
			const toolName = activity.toolName?.trim().toLowerCase() ?? "";
			if (toolName === "begin_implementation") {
				observations.beginImplCalled = true;
			}
			if (WRITE_TOOL_NAMES.has(toolName)) {
				observations.writeToolSeen = true;
			}
		}
	});

	let startError: unknown = null;
	const startPromise = service
		.startTaskSession({
			taskId: TASK_ID,
			cwd: project,
			workspaceRoot: project,
			baseRef: "HEAD",
			startInPlanMode: false,
			prompt:
				"The plan for this card is already confirmed and current — there is nothing to re-plan. Implement it now: " +
				"create a file named GREETING.txt in the project root whose only line is `hello from the agent`. " +
				"Write the file directly with your file-writing tool, then finish.",
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
		const column = await columnOfCard(project);
		if (!observations.reachedInProgress && (column === "in_progress" || column === "review" || column === "completed")) {
			observations.reachedInProgress = true;
			// If the card advanced and begin_implementation was never seen, it was the auto-promote recovery.
			observations.firstInProgressVia = observations.beginImplCalled ? "begin_implementation" : "auto-promote";
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

	const finalColumn = await columnOfCard(project);
	await service.stopTaskSession(TASK_ID).catch(() => null);
	unsubscribe();
	await service.dispose().catch(() => null);
	await startPromise.catch(() => null);

	const leaks = emitted.filter((line) => hostPathNeedles.some((needle) => line.includes(needle)));
	await rm(project, { recursive: true, force: true }).catch(() => null);
	const leftover = await dockerSandboxContainers();

	log("");
	log("=== Increment C auto-promote recovery result ===");
	log(`Sandbox container observed: ${observations.containerSeen ? "YES" : "NO"}`);
	log(`Write/mutating tool approved: ${observations.writeToolSeen ? "YES" : "NO"}`);
	log(`begin_implementation called: ${observations.beginImplCalled ? "YES (explicit path)" : "NO"}`);
	log(`onCardPromoted fired: ${promotions.length} time(s)`);
	for (const event of promotions.slice(0, 3)) {
		log(`  promoted from ${event.fromColumnId}${event.refinementNotes ? ` (notes: ${event.refinementNotes})` : ""}`);
	}
	log(`Card reached In Progress: ${observations.reachedInProgress ? "YES ✓" : "NO ⚠️"} (final column: ${finalColumn ?? "n/a"})`);
	log(`Advanced via: ${observations.firstInProgressVia || "n/a"}`);
	log(`Host-path leaks in agent output: ${leaks.length === 0 ? "NONE ✓" : `${leaks.length} ⚠️`}`);
	for (const leak of leaks.slice(0, 5)) {
		log(`  LEAK: ${leak.slice(0, 240)}`);
	}
	if (observations.error) {
		log(`Start error: ${observations.error}`);
	}
	log(`Containers remaining after dispose: ${leftover.length === 0 ? "NONE ✓" : leftover.join(", ")}`);

	// PASS = the lane advanced (the north-star guarantee). The recovery path is specifically proven when the card
	// reached In Progress while begin_implementation was NEVER called.
	const laneAdvanced = observations.reachedInProgress;
	const recoveryProven = observations.reachedInProgress && !observations.beginImplCalled && promotions.length > 0;
	const ok = laneAdvanced && observations.containerSeen && leaks.length === 0 && leftover.length === 0;
	log("");
	if (ok && recoveryProven) {
		log("PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).");
	} else if (ok) {
		log("PASS ✓ the lane advanced to In Progress (via begin_implementation; recovery seam wired + idempotent).");
	} else {
		log("INCOMPLETE — see above.");
	}
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
