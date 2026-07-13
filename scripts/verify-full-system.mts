/**
 * FULL-SYSTEM e2e: boot the REAL runtime (isolated HOME, free port) and prove a small scaffolded project's GENERATED
 * RESULT is actually VALID — not merely that the card "reached review". (§5.AI full-system layer.)
 *
 * Flow: boot `src/cli.ts` via `bootFullSystemRuntime` → pin the live model → `createDevTestProject` scaffolds the
 * `small-model-smoke` project (a tiny TS CLI shipping a REAL uncapped-score bug) → start a direct fix card → watch the
 * real runtime until the card reaches a terminal state → check out the `nklein/tasks/<task>` result branch and run a
 * HARNESS-OWNED oracle (a canonical cap-invariant test the agent cannot game) → classify PASS / PARTIAL / INCOMPLETE.
 *
 * Single-model harness (reads `NKLEIN_VERIFY_MODEL`, falls back to the first loaded model) so the existing
 * `verify-all-models.mts` sweep driver can fan it across the LM Studio roster (which already honors the deepseek-drop
 * caveat). Run isolated:
 *   HOME=/tmp/nklein-full-system NKLEIN_VERIFY_MODEL=<id> npx tsx scripts/verify-full-system.mts
 *   npx tsx scripts/verify-all-models.mts verify-full-system        # the model sweep (minimize deepseek)
 *
 * Env: NKLEIN_VERIFY_BASE_URL (default http://127.0.0.1:1234/v1), NKLEIN_VERIFY_TIMEOUT_MS (default 360000).
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS } from "../src/core/runtime-config-api-contract";
import {
	resolveSettledTaskCaptureOutcome,
	type SettledTaskCaptureOutcome,
} from "../src/core/task-evidence-capture";
import {
	createTaskResultBranchRef,
	createTaskResultEvidenceRef,
} from "../src/workspace/task-result-branches";
import { bootFullSystemRuntime, type FullSystemRuntime } from "./full-system-harness.mts";

const execFileAsync = promisify(execFile);

const LMSTUDIO_BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "360000");
const CAPTURE_GRACE_MS = 75_000;
const TERMINAL_STATES = new Set(["awaiting_review", "completed", "failed", "interrupted"]);

/** A direct, small-model-friendly fix prompt for the scaffolded uncapped-score bug. */
const FIX_PROMPT = [
	"Fix the scoring bug in src/habit-score.ts described in specification.md.",
	"calculateHabitScore must never return more than 100: a perfect week (completedDays === targetDays) with any",
	"streakDays must return exactly 100, not 120. Cap the final score at 100. Keep targetDays <= 0 returning 0 and",
	"the score for non-perfect weeks unchanged. Only edit src/habit-score.ts.",
].join(" ");

/**
 * The HARNESS-OWNED validity oracle: a canonical cap-invariant test exercising the agent's `src/habit-score.ts`. We run
 * ONLY this (not `npm test`) so the agent cannot pass by leaving its own tests green without fixing the cap.
 */
const ORACLE_TEST = `import test from "node:test";
import assert from "node:assert/strict";
import { calculateHabitScore } from "../src/habit-score.ts";

test("regression: a non-perfect week still scores 86", () => {
	assert.equal(calculateHabitScore({ completedDays: 4, targetDays: 5, streakDays: 3 }), 86);
});

test("the fix: a perfect week with a long streak is capped at exactly 100", () => {
	assert.equal(calculateHabitScore({ completedDays: 5, targetDays: 5, streakDays: 10 }), 100);
});

test("invariant: the score is always within 0..100", () => {
	for (const completedDays of [0, 2, 5, 7]) {
		for (const targetDays of [0, 1, 5]) {
			for (const streakDays of [0, 3, 50]) {
				const score = calculateHabitScore({ completedDays, targetDays, streakDays });
				assert.ok(score >= 0 && score <= 100, \`score \${score} out of range for \${completedDays}/\${targetDays}/\${streakDays}\`);
			}
		}
	}
});

test("a zero target still returns 0", () => {
	assert.equal(calculateHabitScore({ completedDays: 5, targetDays: 0, streakDays: 3 }), 0);
});
`;

type Verdict = "PASS" | "PARTIAL" | "INCOMPLETE";

interface SessionView {
	state?: string;
	reviewReason?: string | null;
	exitCode?: number | null;
	heartbeatStatus?: string | null;
	latestHookActivity?: {
		activityText?: string | null;
		toolName?: string | null;
		hookEventName?: string | null;
		finalMessage?: string | null;
	} | null;
}

interface WorkspaceStateView {
	// The REAL board shape: cards live per-COLUMN (there is no top-level cards array — reading `board.cards`
	// was the root cause of the perpetual "Cards on board: 0" report; the runtime was never wrong).
	board?: { columns?: { cards?: unknown[] }[] };
	sessions?: Record<string, SessionView>;
}

/** Count every card across the board's columns (the board has no flat cards array). */
function countBoardCards(state: WorkspaceStateView | null): number | null {
	const columns = state?.board?.columns;
	if (!Array.isArray(columns)) {
		return null;
	}
	return columns.reduce((total, column) => total + (column.cards?.length ?? 0), 0);
}

function log(line = ""): void {
	process.stdout.write(`${line}\n`);
}

// A late SDK/session promise must not crash the harness before it reports — log + survive.
process.on("unhandledRejection", (reason) => {
	log(`[harness] unhandledRejection (ignored): ${reason instanceof Error ? reason.message : String(reason)}`);
});

async function resolveModelId(): Promise<string> {
	const explicit = process.env.NKLEIN_VERIFY_MODEL?.trim();
	if (explicit) {
		return explicit;
	}
	const response = await fetch(`${LMSTUDIO_BASE_URL}/models`, { signal: AbortSignal.timeout(5000) });
	const payload = (await response.json()) as { data?: Array<{ id?: string }> };
	// Skip embedding models (they cannot run a chat/agent task) and de-prioritize deepseek (slow; reserved for later).
	const ids = (payload.data ?? []).map((entry) => entry.id).filter((id): id is string => Boolean(id) && !/embed/i.test(id));
	const id = ids.find((candidate) => !/deepseek/i.test(candidate)) ?? ids[0];
	if (!id) {
		throw new Error(`Could not resolve a runnable loaded model id from ${LMSTUDIO_BASE_URL}/models`);
	}
	return id;
}

/** Resolve (and create if needed) an isolated HOME so the booted runtime never touches the real ~/.nklein. */
async function resolveIsolatedHome(): Promise<{ home: string; created: boolean }> {
	const current = process.env.HOME ?? homedir();
	if (current.includes("nklein-verify") || current.includes("nklein-full-system")) {
		return { home: current, created: false };
	}
	const home = await mkdtemp(join(tmpdir(), "nklein-full-system-"));
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	return { home, created: true };
}

interface OracleResult {
	branchFound: boolean;
	valid: boolean;
	detail: string;
	/** The agent's `src/habit-score.ts` from the result branch — kept so a PARTIAL is triageable after teardown. */
	agentSource: string | null;
	/** The oracle test output (only the failing lines matter) — kept for the same reason. */
	oracleOutput: string | null;
}

/**
 * Run the harness oracle against the agent's result. HERMETIC by construction: we extract ONLY the result branch's
 * `src/` tree (via `git archive` — so no `git worktree`, and thus none of the shared `.git/config`/`core.bare`
 * cross-talk that plagues this repo) into a clean temp project the harness fully owns: a controlled `package.json`
 * (`"type":"module"`, so the `.js` oracle test is always ESM) and ONLY the oracle test. This isolates the run from
 * anything else the small model may have perturbed in its result branch — a dropped `"type":"module"`, a mangled
 * `tsconfig`, a sibling test — which was the root of the environment-sensitive false-failures (a file-level load
 * error with no named subtest failure, i.e. the test file couldn't even be imported, not an assertion failing).
 */
async function resolveCapturedArtifactCommit(workspacePath: string, taskId: string): Promise<string | null> {
	for (const resultRef of [createTaskResultBranchRef(taskId), createTaskResultEvidenceRef(taskId)]) {
		const commit = await execFileAsync(
			"git",
			["-C", workspacePath, "rev-parse", "--verify", `${resultRef}^{commit}`],
		).then(
			({ stdout }) => stdout.trim() || null,
			() => null,
		);
		if (commit) {
			return commit;
		}
	}
	return null;
}

async function verifyCapturedCommit(workspacePath: string, commit: string): Promise<string | null> {
	return await execFileAsync("git", ["-C", workspacePath, "rev-parse", "--verify", `${commit}^{commit}`]).then(
		({ stdout }) => stdout.trim() || null,
		() => null,
	);
}

async function runResultOracle(
	workspacePath: string,
	captureOutcome: SettledTaskCaptureOutcome | "capture_unsettled",
	captureCommit: string | null,
): Promise<OracleResult> {
	if (captureOutcome !== "result_branch" || !captureCommit) {
		const detail =
			captureOutcome === "no_changes"
				? "no result branch (capture settled: the sandbox produced no file changes)"
				: captureOutcome === "capture_failed"
					? "no result branch (capture failed; inspect the runtime diagnostics)"
					: "no result branch (capture did not settle before the deadline)";
		return { branchFound: false, valid: false, detail, agentSource: null, oracleOutput: null };
	}
	// Pin the exact commit observed when the current capture marker settled. Never re-resolve the mutable task ref: a
	// bounce can update it between source extraction and the oracle and silently test a different round.
	const resultRef = captureCommit;
	// Capture the agent's edited source up front so a non-PASS stays triageable even after the project is torn down.
	const agentSource = await execFileAsync("git", ["-C", workspacePath, "show", `${resultRef}:src/habit-score.ts`])
		.then(({ stdout }) => stdout)
		.catch(() => null);
	const hermetic = await mkdtemp(join(tmpdir(), "nklein-full-system-oracle-"));
	try {
		// Extract just the result branch's src/ tree into the hermetic project (no worktree → no shared git state).
		const tarPath = join(hermetic, "src.tar");
		await execFileAsync("git", ["-C", workspacePath, "archive", "--format=tar", "-o", tarPath, resultRef, "src"]);
		await execFileAsync("tar", ["-xf", tarPath, "-C", hermetic]);
		await rm(tarPath, { force: true });
		// Harness-owned manifest + oracle test — neither is influenced by the model's result branch.
		await writeFile(join(hermetic, "package.json"), `${JSON.stringify({ name: "oracle", private: true, type: "module" }, null, 2)}\n`, "utf8");
		await mkdir(join(hermetic, "test"), { recursive: true });
		await writeFile(join(hermetic, "test", "habit-score.test.js"), ORACLE_TEST, "utf8");
		const result = await execFileAsync(
			"node",
			["--experimental-strip-types", "--test", "test/habit-score.test.js"],
			{ cwd: hermetic },
		).then(
			({ stdout, stderr }) => ({ ok: true, out: `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}` }),
			(error: { stdout?: string; stderr?: string; code?: number }) => ({
				ok: false,
				out: `[exit ${error.code ?? "?"}]\n[stdout]\n${error.stdout ?? ""}\n[stderr]\n${error.stderr ?? ""}`,
			}),
		);
		const summaryLine = result.out.split("\n").find((line) => /(?:#\s*)?fail\s/.test(line)) ?? "";
		return {
			branchFound: true,
			valid: result.ok,
			detail: result.ok ? "oracle passed — the cap bug is fixed" : `oracle FAILED — ${summaryLine.trim() || "see code"}`,
			agentSource,
			oracleOutput: result.ok ? null : result.out,
		};
	} finally {
		await rm(hermetic, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function main(): Promise<void> {
	const { home, created: createdHome } = await resolveIsolatedHome();
	const modelId = await resolveModelId();
	log(`Full-system e2e · model=${modelId} · HOME=${home}`);

	let runtime: FullSystemRuntime | null = null;
	let workspaceId: string | null = null;
	let workspacePath: string | null = null;
	let restoreModel: { modelId: string; baseUrl: string } | null = null;
	let restoreGuardrails: unknown = null;
	const observed = {
		terminalState: "",
		lastState: "",
		started: false,
		startError: "",
		cards: 0,
		reviewReason: "" as string | null | undefined,
		heartbeat: "" as string | null | undefined,
		lastActivity: "" as string | null | undefined,
		lastTool: "" as string | null | undefined,
		captureOutcome: null as SettledTaskCaptureOutcome | "capture_unsettled" | null,
		resultCommit: null as string | null,
	};

	try {
		runtime = await bootFullSystemRuntime({ home });
		log(`Runtime up on :${runtime.port}`);

		// Pin the live model + apply the lenient background-eval guardrails (slow small models shouldn't be parked early).
		const before = await runtime.trpc.runtime.getConfig.query();
		restoreModel = { modelId: before.nkleinProviderSettings.modelId, baseUrl: before.nkleinProviderSettings.baseUrl };
		restoreGuardrails = before.swarmGuardrails;
		await runtime.trpc.runtime.saveNKleinProviderSettings.mutate({ providerId: "lmstudio", modelId, baseUrl: LMSTUDIO_BASE_URL });
		await runtime.trpc.runtime.saveConfig.mutate({ swarmGuardrails: BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS }).catch(() => undefined);

		// Scaffold the small verifiable project through the REAL project-creation path.
		const created = await runtime.trpc.projects.createDevTestProject.mutate({ registryId: "small-model-smoke" });
		if (!created.ok || !created.project || !created.task || !created.workspacePath) {
			throw new Error(`createDevTestProject failed: ${created.error ?? "unknown"}`);
		}
		workspaceId = created.project.id;
		workspacePath = created.workspacePath;
		const seedTaskId = created.task.id;
		log(`Scaffolded ${created.scenario?.id ?? "small-model-smoke"} → project=${workspaceId.slice(0, 8)} at ${workspacePath}`);

		// Start a DIRECT fix card (startInPlanMode:false) on the project's actual base branch.
		const ws = runtime.workspaceClient(workspaceId);
		const baseRef = (await execFileAsync("git", ["-C", workspacePath, "rev-parse", "--abbrev-ref", "HEAD"]))
			.stdout.trim() || "main";
		const started = await ws.runtime.startTaskSession.mutate({
			taskId: seedTaskId,
			prompt: FIX_PROMPT,
			taskTitle: "Cap the habit score at 100",
			baseRef,
			agentId: "nklein",
			startInPlanMode: false,
		});
		observed.started = started.ok;
		if (!started.ok) {
			observed.startError = started.error ?? "unknown";
			throw new Error(`startTaskSession failed: ${observed.startError}`);
		}
		log(`Started fix card seed=${seedTaskId.slice(0, 8)} on base ${baseRef}; watching (timeout ${(TIMEOUT_MS / 60000).toFixed(0)}m)…`);

		// Watch until BOTH the session is terminal and its asynchronous result capture settles. `awaiting_review` is
		// emitted before fire-and-forget finalization writes the result ref; the former one-shot branch probe created the
		// historical intermittent "nothing was captured" false PARTIAL (P0.8).
		const deadline = Date.now() + TIMEOUT_MS;
		let captureDeadline: number | null = null;
		while (Date.now() < (captureDeadline ?? deadline)) {
			await new Promise((settle) => setTimeout(settle, observed.terminalState ? 250 : 5000));
			const state = (await ws.workspace.getState.query().catch(() => null)) as WorkspaceStateView | null;
			observed.cards = countBoardCards(state) ?? observed.cards;
			const session = state?.sessions?.[seedTaskId];
			if (session?.state) {
				observed.lastState = session.state;
				observed.reviewReason = session.reviewReason;
				observed.heartbeat = session.heartbeatStatus;
				observed.lastActivity = session.latestHookActivity?.activityText ?? observed.lastActivity;
				observed.lastTool = session.latestHookActivity?.toolName ?? observed.lastTool;
				if (TERMINAL_STATES.has(session.state)) {
					observed.terminalState = session.state;
					// The model/runtime deadline governs reaching terminal. Once it does, capture gets its own bounded grace
					// because legal git add/diff operations may consume most of the original deadline's final seconds.
					captureDeadline ??= Date.now() + CAPTURE_GRACE_MS;
					const markerCommit =
						session.latestHookActivity?.hookEventName === "sandbox_patch_captured"
							? session.latestHookActivity.finalMessage?.trim() || null
							: null;
					const resultCommit = workspacePath
						? markerCommit
							? await verifyCapturedCommit(workspacePath, markerCommit)
							: await resolveCapturedArtifactCommit(workspacePath, seedTaskId)
						: null;
					observed.captureOutcome = resolveSettledTaskCaptureOutcome({
						hookEventName: session.latestHookActivity?.hookEventName ?? null,
						resultBranchExists: Boolean(resultCommit),
					});
					if (observed.captureOutcome) {
						observed.resultCommit = observed.captureOutcome === "result_branch" ? resultCommit : null;
						break;
					}
				}
			}
		}
		if (observed.terminalState && !observed.captureOutcome) {
			observed.captureOutcome = "capture_unsettled";
		}

		// Verify the GENERATED result with the harness oracle.
		const oracle =
			observed.terminalState && workspacePath && observed.captureOutcome
				? await runResultOracle(workspacePath, observed.captureOutcome, observed.resultCommit)
				: { branchFound: false, valid: false, detail: "card never reached a terminal state" };

		const verdict: Verdict = !observed.terminalState ? "INCOMPLETE" : oracle.valid ? "PASS" : "PARTIAL";
		log("");
		log("=== Full-system result ===");
		log(`Started:        ${observed.started ? "yes" : `NO (${observed.startError})`}`);
		log(`Terminal state: ${observed.terminalState || `none (last: ${observed.lastState || "n/a"})`}`);
		log(`Capture outcome: ${observed.captureOutcome ?? "none"}`);
		log(`Cards on board: ${observed.cards}`);
		log(`Result oracle:  ${oracle.detail}`);
		if (verdict !== "PASS") {
			// Collect proper diagnostics for a non-PASS (timeout/interrupt/partial): the last session detail + the
			// real runtime stderr tail (where an SDK/model error or heartbeat loss that aborted the session shows up).
			log("");
			log("--- triage: last session detail ---");
			log(`  lastState=${observed.lastState || "n/a"} reviewReason=${observed.reviewReason ?? "n/a"} heartbeat=${observed.heartbeat ?? "n/a"}`);
			log(`  lastTool=${observed.lastTool ?? "n/a"} lastActivity=${(observed.lastActivity ?? "n/a").slice(0, 200)}`);
			log("--- triage: runtime stderr tail ---");
			for (const line of (runtime?.stderrTail() ?? "(no runtime)").split("\n").slice(-40)) {
				log(`  ${line}`);
			}
			log("--- triage: LM Studio dev log tail (lms log stream) ---");
			for (const line of (runtime?.lmStudioLogTail() ?? "(no runtime)").split("\n").slice(-50)) {
				log(`  ${line}`);
			}
			const lmsAnomalies = runtime?.lmStudioLogAnomalies();
			if (lmsAnomalies) {
				log(`--- triage: ${lmsAnomalies} ---`);
			}
		}
		if (!oracle.valid && (oracle.agentSource || oracle.oracleOutput)) {
			// Keep a PARTIAL triageable: the project is torn down in cleanup, so the evidence must live in this report.
			log("");
			log("--- triage: FULL oracle output ---");
			for (const line of (oracle.oracleOutput ?? "").split("\n").slice(0, 60)) {
				log(`  ${line}`);
			}
			log("--- triage: agent's src/habit-score.ts ---");
			for (const line of (oracle.agentSource ?? "(not captured)").split("\n").slice(0, 40)) {
				log(`  ${line}`);
			}
		}
		log("");
		log(
			verdict === "PASS"
				? "PASS ✓ the real stack ran a small model to a terminal state AND the generated result is VALID (cap bug fixed)."
				: verdict === "PARTIAL"
					? "PARTIAL — reached a terminal state but the generated result is INVALID (see oracle)."
					: "INCOMPLETE — the card did not reach a terminal state within the timeout.",
		);
		process.exitCode = verdict === "PASS" ? 0 : 1;
	} finally {
		log("\ncleanup: restoring model/guardrails, removing project, stopping runtime…");
		if (runtime) {
			if (restoreModel) {
				await runtime.trpc.runtime.saveNKleinProviderSettings.mutate({ providerId: "lmstudio", ...restoreModel }).catch(() => undefined);
			}
			if (restoreGuardrails !== null) {
				await runtime.trpc.runtime.saveConfig.mutate({ swarmGuardrails: restoreGuardrails }).catch(() => undefined);
			}
			if (workspaceId) {
				await runtime.trpc.projects.remove.mutate({ projectId: workspaceId }).catch(() => undefined);
			}
			await runtime.stop().catch(() => undefined);
		}
		// Remove only an isolated HOME this script itself created (never a caller-provided one).
		if (createdHome) {
			await rm(home, { recursive: true, force: true }).catch(() => undefined);
		}
		log("done.");
	}
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
