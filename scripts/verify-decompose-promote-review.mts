/**
 * Live CHAINED pipeline verification (Suite 10 PROMOTE half, todo ~L3872): decompose → apply → start a GENERATED
 * card → observe it reach In Progress (explicit `begin_implementation` OR the Increment C auto-promote recovery) →
 * reach review. One real Docker-sandboxed session per stage against a live local model; the service applies the
 * decomposition to the ON-DISK board itself (the `onDecompositionApplied` seam), so the harness observes the same
 * lane movements the runtime UI would.
 *
 * MODEL SWEEP: with NKLEIN_VERIFY_SWEEP=1 it runs the chain across EVERY model currently listed at /v1/models
 * (never loads or unloads anything — user directive 2026-06-28). A model that drops off /v1/models mid-sweep is
 * recorded as dropped and the sweep continues (crash-resilience is a later task).
 *
 * Run:  HOME=/tmp/nklein-verify tsx scripts/verify-decompose-promote-review.mts
 *   env: NKLEIN_VERIFY_PROVIDER (default lmstudio), NKLEIN_VERIFY_MODEL (single-model run), NKLEIN_VERIFY_SWEEP=1,
 *        NKLEIN_VERIFY_BASE_URL, NKLEIN_VERIFY_CONTEXT_WINDOW (default 40000),
 *        NKLEIN_VERIFY_TIMEOUT_MS (per-stage budget, default 240000).
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RuntimeBoardData } from "../src/core/api-contract";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";
import { resolvePowerAwareTimeoutMs } from "../src/core/power-aware-timeout";
import { AgentSandboxManager } from "../src/nklein-agent/nklein-agent-sandbox";
import type { NKleinDecompositionAppliedEvent } from "../src/nklein-agent/nklein-decomposition-tool";
import type { NKleinCardPromotedEvent } from "../src/nklein-agent/nklein-promotion-tool";
import { createInMemoryNKleinTaskSessionService } from "../src/nklein-agent/nklein-task-session-service";
import { loadWorkspaceState, saveWorkspaceState } from "../src/state/workspace-state";

const execFileAsync = promisify(execFile);

const PROVIDER_ID = process.env.NKLEIN_VERIFY_PROVIDER?.trim() || "lmstudio";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";
const SWEEP = process.env.NKLEIN_VERIFY_SWEEP === "1";
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const CONTEXT_WINDOW = Number(process.env.NKLEIN_VERIFY_CONTEXT_WINDOW ?? "40000");
const BASE_TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "240000");

const SOURCE_TASK_ID = "verify-chain-decompose";

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

async function listLoadedModels(): Promise<string[]> {
	const { stdout } = await execFileAsync("curl", ["-s", "--max-time", "5", `${BASE_URL}/models`]);
	const payload = JSON.parse(stdout) as { data?: Array<{ id?: string }> };
	return (payload.data ?? []).map((entry) => entry.id ?? "").filter((id) => id.length > 0);
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

function emptyBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

async function columnOfCard(project: string, cardId: string): Promise<string | null> {
	const state = await loadWorkspaceState(project);
	for (const column of state.board.columns) {
		if (column.cards.some((card) => card.id === cardId)) {
			return column.id;
		}
	}
	return null;
}

interface ChainResult {
	model: string;
	decomposeApplied: boolean;
	generatedCards: number;
	rootStarted: string | null;
	reachedInProgress: boolean;
	advancedVia: "" | "begin_implementation" | "auto-promote";
	reachedReview: boolean;
	dropped: boolean;
	error: string;
}

async function runChainForModel(modelId: string, stageTimeoutMs: number): Promise<ChainResult> {
	const result: ChainResult = {
		model: modelId,
		decomposeApplied: false,
		generatedCards: 0,
		rootStarted: null,
		reachedInProgress: false,
		advancedVia: "",
		reachedReview: false,
		dropped: false,
		error: "",
	};

	const project = await mkdtemp(join(tmpdir(), "nklein-verify-chain-"));
	const manager = new AgentSandboxManager();
	const decompositionEvents: NKleinDecompositionAppliedEvent[] = [];
	const promotions: NKleinCardPromotedEvent[] = [];
	let beginImplCalled = false;
	const service = createInMemoryNKleinTaskSessionService({
		agentSandboxManager: manager,
		onDecompositionApplied: (event) => {
			decompositionEvents.push(event);
		},
		onCardPromoted: (event) => {
			promotions.push(event);
		},
	});
	const emitted: string[] = [];
	const seenActivity = new Set<string>();
	const unsubscribe = service.onSummary((summary) => {
		if (summary.latestHookActivity?.toolName?.trim().toLowerCase() === "begin_implementation") {
			beginImplCalled = true;
		}
		const activity = summary.latestHookActivity;
		for (const [label, value] of [
			["text", activity?.activityText],
			["toolInput", activity?.toolInputSummary],
			["final", activity?.finalMessage],
		] as const) {
			if (value && !seenActivity.has(`${label}:${value}`)) {
				seenActivity.add(`${label}:${value}`);
				emitted.push(`[${summary.taskId}][${label}] ${value}`);
			}
		}
	});

	try {
		await writeFile(join(project, "specification.md"), SPEC, "utf8");
		await execFileAsync("git", ["-C", project, "init", "-q"]);
		await execFileAsync("git", ["-C", project, "config", "user.email", "verify@nklein.local"]);
		await execFileAsync("git", ["-C", project, "config", "user.name", "nklein-verify"]);
		await execFileAsync("git", ["-C", project, "add", "-A"]);
		await execFileAsync("git", ["-C", project, "commit", "-q", "-m", "seed spec"]);
		await saveWorkspaceState(project, { board: emptyBoard() });

		// ── Stage 1: DECOMPOSE — live plan-mode session must call decompose_project; the service applies it. ──
		let startError: unknown = null;
		const decomposeStart = service
			.startTaskSession({
				taskId: SOURCE_TASK_ID,
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
				// NOT plan mode: matches the 2026-06-25 PASS configuration of verify-decompose-isolation (its PLAN_MODE
				// default is 0 — plan mode is only for arming the stall nudger, not required for decompose_project).
				startInPlanMode: false,
			})
			.catch((error) => {
				startError = error;
			});

		let deadline = Date.now() + stageTimeoutMs;
		while (Date.now() < deadline && decompositionEvents.length === 0 && !startError) {
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
		await service.stopTaskSession(SOURCE_TASK_ID).catch(() => null);
		await decomposeStart.catch(() => null);
		if (startError) {
			result.error = `decompose start: ${String(startError).slice(0, 300)}`;
			return result;
		}
		const applied = decompositionEvents[0];
		if (!applied) {
			result.error = "decompose_project never applied within the stage budget";
			if (process.env.NKLEIN_VERIFY_DUMP_ACTIVITIES === "1") {
				log("=== Agent activities (oldest→newest, deduped) ===");
				emitted.forEach((line, index) => log(`  ${index + 1}. ${line.slice(0, 280)}`));
			}
			return result;
		}
		result.decomposeApplied = true;
		result.generatedCards = Object.keys(applied.taskIdByPlanTaskId).length;

		// ── Stage 2: PROMOTE — start a generated ROOT card; lane must advance to In Progress. ──
		const rootId = applied.rootTaskIds[0];
		if (!rootId) {
			result.error = "decomposition applied but produced no startable root card";
			return result;
		}
		const state = await loadWorkspaceState(project);
		const rootCard = state.board.columns.flatMap((column) => column.cards).find((card) => card.id === rootId);
		if (!rootCard) {
			result.error = `root card ${rootId} not found on the board after apply`;
			return result;
		}
		result.rootStarted = `${rootId} (“${rootCard.title.slice(0, 60)}”)`;

		let rootStartError: unknown = null;
		const rootStart = service
			.startTaskSession({
				taskId: rootId,
				cwd: project,
				workspaceRoot: project,
				baseRef: "HEAD",
				prompt: rootCard.prompt,
				providerId: PROVIDER_ID,
				modelId,
				baseUrl: BASE_URL,
				contextWindow: Number.isFinite(CONTEXT_WINDOW) ? CONTEXT_WINDOW : 40000,
				timeoutMode: "long",
				startInPlanMode: false,
			})
			.catch((error) => {
				rootStartError = error;
			});

		deadline = Date.now() + stageTimeoutMs;
		while (Date.now() < deadline && !rootStartError) {
			const column = await columnOfCard(project, rootId);
			if (column === "in_progress" || column === "review" || column === "completed") {
				result.reachedInProgress = true;
				result.advancedVia = beginImplCalled ? "begin_implementation" : "auto-promote";
			}
			if (column === "review" || column === "completed") {
				result.reachedReview = true;
				break;
			}
			const summary = service.getSummary(rootId);
			if (summary && (summary.state === "review" || summary.state === "completed")) {
				result.reachedReview = true;
				break;
			}
			if (summary && summary.state === "failed") {
				result.error = "generated card session failed";
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
		if (rootStartError) {
			result.error = `root start: ${String(rootStartError).slice(0, 300)}`;
		}
		await service.stopTaskSession(rootId).catch(() => null);
		await rootStart.catch(() => null);
		return result;
	} catch (error) {
		result.error = String(error).slice(0, 300);
		return result;
	} finally {
		unsubscribe();
		await service.dispose().catch(() => null);
		await rm(project, { recursive: true, force: true }).catch(() => null);
		// A model unloading/crashing mid-run shows up as it vanishing from /v1/models — record, don't block.
		result.dropped = !(await listLoadedModels().catch(() => [] as string[])).includes(modelId);
	}
}

async function main(): Promise<void> {
	const power = await resolvePowerAwareTimeoutMs(BASE_TIMEOUT_MS);
	const home = homedir();
	if (!home.includes("nklein-verify") && process.env.NKLEIN_VERIFY_ALLOW_REAL_HOME !== "1") {
		throw new Error(`Refusing to run against HOME=${home}. Use an isolated dir (e.g. /tmp/nklein-verify).`);
	}
	const manager = new AgentSandboxManager();
	await manager.assertAvailable();
	log("Docker sandbox available ✓");

	const loaded = await listLoadedModels();
	const models = SWEEP ? loaded : [MODEL_ID || loaded[0] || ""];
	for (const modelId of models) {
		await assertModelLoaded(BASE_URL, modelId); // never load — only verify already-loaded models.
	}
	log(`Chain: decompose → apply → start root card → In Progress → review`);
	log(`Models: ${models.join(", ")}  (per-stage budget ${power.timeoutMs}ms)`);

	const results: ChainResult[] = [];
	for (const modelId of models) {
		log("");
		log(`── model: ${modelId} ──`);
		if (!(await listLoadedModels().catch(() => [] as string[])).includes(modelId)) {
			log(`   dropped from /v1/models before its turn — recorded, sweep continues.`);
			results.push({
				model: modelId,
				decomposeApplied: false,
				generatedCards: 0,
				rootStarted: null,
				reachedInProgress: false,
				advancedVia: "",
				reachedReview: false,
				dropped: true,
				error: "model dropped before run",
			});
			continue;
		}
		const result = await runChainForModel(modelId, power.timeoutMs);
		results.push(result);
		log(`   decompose applied: ${result.decomposeApplied ? "YES" : "NO"} (${result.generatedCards} cards)`);
		log(`   root started: ${result.rootStarted ?? "n/a"}`);
		log(`   reached In Progress: ${result.reachedInProgress ? `YES via ${result.advancedVia}` : "NO"}`);
		log(`   reached review: ${result.reachedReview ? "YES" : "NO"}`);
		if (result.dropped) {
			log(`   ⚠️ model dropped from /v1/models during/after the run`);
		}
		if (result.error) {
			log(`   error: ${result.error}`);
		}
	}

	log("");
	log("=== decompose→promote→review sweep summary ===");
	for (const result of results) {
		const verdict =
			result.decomposeApplied && result.reachedInProgress && result.reachedReview
				? "FULL PASS"
				: result.decomposeApplied && result.reachedInProgress
					? "PROMOTE PASS (review not reached in budget)"
					: result.dropped
						? "DROPPED"
						: "FAIL";
		log(`  ${result.model}: ${verdict}${result.advancedVia ? ` [${result.advancedVia}]` : ""}`);
	}
	const passing = results.filter((result) => result.decomposeApplied && result.reachedInProgress);
	log("");
	log(
		passing.length > 0
			? `PASS ✓ ${passing.length}/${results.length} model(s) completed decompose→start→promote live.`
			: "INCOMPLETE — no model completed the chain.",
	);
	process.exit(passing.length > 0 ? 0 : 1);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
