/**
 * §5.AI continuous dev-test evaluation rail (first usable version). Runs SEVERAL dev-test projects **in parallel**
 * against the live local model + Docker, streams a watchable live view of each project's TASK FLOW (decompose → cards
 * → tool calls → terminal state), and collects per-project runtime evidence — success AND failure — into a report you
 * can read (and feed back into todo.md). This is the "watch the dev projects do their work + harvest real evidence"
 * instance the user asked for; the always-on / idle-aware / restart-survivable + auto-into-todos layers (the full §5.AI)
 * sit on the §5.AF durable scheduler and come later.
 *
 * Requires a runtime already running on :3484 (`npm run dev:full`), a live LM Studio with the model loaded, and Docker
 * (strict isolation, same as real tasks). It pins the model + raises that model's per-request concurrency (§5.T) so the
 * single endpoint genuinely serves the projects concurrently, then RESTORES both + removes the throwaway projects.
 *
 * Run:  tsx scripts/dev-test-rail.mts --projects mid_task,complex_dag --model qwen/qwen3-8b-m5max --max-wait-ms 900000
 *       tsx scripts/dev-test-rail.mts --count 3                       # the first 3 built-in presets (deterministic)
 *       tsx scripts/dev-test-rail.mts --count 3 --select random       # 3 RANDOM built-in presets (rotate coverage)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import {
	EMPTY_DRIVE_STALL_STATE,
	fingerprintDriveLanes,
	observeDriveProgress,
} from "../src/core/drive-stall-watchdog.js";
import type { RailEvidenceReport, RailLaneEvidence } from "../src/core/rail-evidence.js";
import { resolveRailEvidenceDir } from "../src/state/rail-evidence-store.js";
import { BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS } from "../src/core/runtime-config-api-contract";
import { resolveNKleinDevTestProjectScenario } from "../src/nklein-agent/nklein-dev-test-project";
import type { RuntimeAppRouter } from "../src/trpc/app-router";

const URL_BASE = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:3484";
const TRPC_URL = `${URL_BASE}/api/trpc`;
/** Model endpoint to pin (§5.AI optional: point at a dedicated-LLM machine via `--endpoint` or NKLEIN_MODEL_ENDPOINT). */
const ENDPOINT_BASE_URL =
	arg("endpoint", "") || process.env.NKLEIN_MODEL_ENDPOINT?.trim() || "http://127.0.0.1:1234/v1";
/**
 * The built-in presets `createDevTestProject` accepts as `preset`.
 *
 * Anything else in `--projects` is a REGISTRY id (a folder under dev-test-projects/) and must be sent as
 * `registryId` instead — the request schema has both fields and validates `preset` against this closed list. The
 * rail sent every selector as `preset`, so `--projects 42_analysis_unchecked_error_audit` failed schema validation
 * with "Invalid option: expected one of mid_task|…" and the rail exited "No dev-test projects could be created".
 * That made the rail unable to drive the 30 non-build registry projects it exists to evaluate (live 2026-09-08).
 */
const BUILTIN_PRESETS = ["mid_task", "complex_dag", "audio_vst", "daw_foundation"] as const;
const TERMINAL_STATES = new Set(["awaiting_review", "completed", "failed"]);
/**
 * Lanes a card can still be WORKING in. A project is done when every card has left all of them.
 *
 * Live 2026-09-08: the rail declared a project finished the moment its SEED card went terminal — and for a
 * decompose project the seed finishing means "the plan exists", not "the work is done". Project 39 was recorded as
 * a failure with SIX cards sitting untouched in Planning: the rail exited, the batch driver moved on and seeded
 * project 40, and 39's cards were left competing for a strictly-serial endpoint they had already lost. The seed
 * state was a plausible signal standing in for the fact that mattered.
 */
const WORKING_LANES = new Set(["backlog", "planning", "ready", "in_progress", "review"]);
const NARRATION_MARKERS = /<\|?\s*(?:tool_call|function_call|python_tag)\s*\|?>|\[TOOL_CALLS\]|<function\s*=|\[TOOL_REQUEST\]/i;

function arg(name: string, fallback: string): string {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 && process.argv[index + 1] ? (process.argv[index + 1] as string) : fallback;
}
function log(line = ""): void {
	process.stdout.write(`${line}\n`);
}

type Preset = Parameters<typeof resolveNKleinDevTestProjectScenario>[0];

interface CapturedMessage {
	taskId: string;
	role: string;
	toolName: string | null;
	content: string;
	at: number;
}

/** One project's live lane on the rail. */
interface Lane {
	label: string;
	preset: Preset;
	workspaceId: string;
	seedTaskId: string;
	ws: ReturnType<typeof createTRPCProxyClient<RuntimeAppRouter>>;
	socket: WebSocket;
	messages: CapturedMessage[];
	startedOk: boolean;
	startError: string | null;
	/** taskId → latest known session state (live cascade view). */
	sessionStates: Map<string, string>;
	terminalState: string | null;
	cardCount: number;
	/** Cards still in a working lane — the project is not done while this is above zero. */
	workingCardCount: number;
	frames: number;
}

/** Fisher–Yates: an unbiased in-place shuffle (the naive `sort(() => Math.random() - 0.5)` is NOT uniform). */
function shuffleInPlace<T>(items: T[]): T[] {
	for (let i = items.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		const swapped = items[i] as T;
		items[i] = items[j] as T;
		items[j] = swapped;
	}
	return items;
}

/**
 * §5.AI selection policy: `--projects a,b` (explicit user choice; registry ids also work) takes precedence; otherwise
 * `--select first|random` picks `--count` projects from the built-in presets — `first` (default) is deterministic for
 * reproducible runs, `random` rotates coverage across the proven presets. (Registry-wide random — picking from the full
 * §5.O registry via `projects.listDevTestProjects` — is the richer follow-up; this keeps the rail's selection on the
 * createDevTestProject-proven presets.)
 */
/** Reduce a finished lane to its structured evidence (the single source of truth for both the printed report + JSON). */
function buildLaneEvidence(lane: Lane): RailLaneEvidence {
	const toolNames = lane.messages.filter((message) => message.toolName).map((message) => message.toolName as string);
	const toolCalls: Record<string, number> = {};
	for (const name of toolNames) {
		toolCalls[name] = (toolCalls[name] ?? 0) + 1;
	}
	const repeats = new Map<string, number>();
	for (const message of lane.messages) {
		if (message.toolName) {
			const key = `${message.toolName}:${message.content}`;
			repeats.set(key, (repeats.get(key) ?? 0) + 1);
		}
	}
	const reachedReview = [...lane.sessionStates.values()].some((state) => state === "awaiting_review");
	const verdict: RailLaneEvidence["verdict"] = !lane.startedOk
		? "failed_to_start"
		: lane.terminalState === "awaiting_review" || reachedReview
			? "delivered"
			: lane.terminalState === "failed"
				? "failed"
				: "non_terminal";
	return {
		label: lane.label,
		workspaceId: lane.workspaceId,
		startedOk: lane.startedOk,
		startError: lane.startError,
		verdict,
		cards: lane.cardCount,
		decomposed: toolNames.includes("decompose_project") || lane.cardCount > 1,
		wsFrames: lane.frames,
		sessionStates: Object.fromEntries([...lane.sessionStates]),
		toolCalls,
		totalToolCalls: toolNames.length,
		narrationLeaks: lane.messages.filter(
			(message) => message.role === "assistant" && NARRATION_MARKERS.test(message.content),
		).length,
		hotRepeats: [...repeats.values()].filter((count) => count > 2).length,
	};
}

function selectPresets(): Preset[] {
	const explicit = arg("projects", "").trim();
	if (explicit) {
		return explicit.split(",").map((value) => value.trim()).filter(Boolean) as Preset[];
	}
	const count = Math.max(1, Math.min(BUILTIN_PRESETS.length, Number.parseInt(arg("count", "2"), 10)));
	const policy = arg("select", "first").trim().toLowerCase();
	if (policy === "random") {
		return shuffleInPlace([...BUILTIN_PRESETS]).slice(0, count) as unknown as Preset[];
	}
	return BUILTIN_PRESETS.slice(0, count) as unknown as Preset[];
}

/** Set when the watch loop ends on the stall watchdog rather than on a settled board — see the exit code below. */
let stalled = false;

async function main(): Promise<void> {
	const model = arg("model", "qwen/qwen3-8b-m5max");
	const presets = selectPresets();
	const maxWaitMs = Number.parseInt(arg("max-wait-ms", "900000"), 10); // generous default: 15 min (small models are slow)
	const concurrency = Math.max(presets.length, Number.parseInt(arg("concurrency", String(presets.length)), 10));
	// Bound the SILENCE inside the deadline, not just the deadline. Live 2026-09-08: the agent in the rig's model
	// seat was killed by its own harness and the drive sat in a 90-minute window with nothing to show for it.
	//
	// The first cut used 15 minutes on the reasoning that it is "far longer than any single card turn". That was
	// measured against a fast endpoint and is wrong for a human-speed model seat: 2026-09-09 the seat averaged
	// ~3.2 minutes PER TURN on a strictly-serial endpoint, so a card waiting behind two others is legitimately
	// silent for longer than 15 minutes — and SIX consecutive projects were re-queued as "stalled" while the seat
	// was in fact answering steadily and five of their suites reached a verified green. A false stall costs a whole
	// project; a slow true stall costs the difference between 15 and 45 minutes, once, and the responder is
	// replaced promptly on its own notification. 45 wins on both counts. `0` disables.
	const stallMs = Number.parseInt(arg("stall-ms", "2700000"), 10);
	// A wedge is unambiguous where a stall is not (see the watchdog below), so it does not need the stall's margin.
	const wedgeMs = Number.parseInt(arg("wedge-ms", "1200000"), 10);

	const base = createTRPCProxyClient<RuntimeAppRouter>({ links: [httpBatchLink({ url: TRPC_URL })] });

	// ── Pin the model + raise its per-request concurrency so the one endpoint serves the projects concurrently. ──
	const before = await base.runtime.getConfig.query();
	const original = before.nkleinProviderSettings;
	const originalGuardrails = before.swarmGuardrails;
	const useGenerousGuardrails = arg("guardrails", "generous").trim().toLowerCase() === "generous";
	log(`Rail: ${presets.length} projects in parallel on ${model} (concurrency ${concurrency})`);
	log(`Projects: ${presets.join(", ")}\n`);
	await base.runtime.saveNKleinProviderSettings.mutate({ providerId: "lmstudio", modelId: model, baseUrl: ENDPOINT_BASE_URL });
	// A HARD pin, not a provider default (live 2026-09-14: the provider default alone let the router auto-discover
	// every loaded model on the endpoint and rank the operator-idled m5max model above the m4mini alias the rail
	// was told to drive). `modelSelectionMode: "pinned"` on every role makes the named model the assignment as
	// long as it is loaded and fits; the original roles are restored on cleanup.
	const originalModelRoles = before.modelRoles ?? {};
	const pinnedRole = { providerId: "lmstudio", modelId: model, modelSelectionMode: "pinned" as const };
	await base.runtime.saveConfig
		.mutate({ modelRoles: { architect: pinnedRole, worker: pinnedRole, reviewer: pinnedRole } })
		.then(() => log(`Pinned architect/worker/reviewer to ${model} (modelSelectionMode: pinned).`))
		.catch((error) => log(`(could not pin the role models: ${error instanceof Error ? error.message : String(error)})`));
	await base.runtime.saveNKleinModelMaxConcurrentRequests
		.mutate({ providerId: "lmstudio", modelId: model, baseUrl: ENDPOINT_BASE_URL, maxConcurrentRequests: concurrency })
		.catch((error) => log(`(could not set per-model concurrency: ${error instanceof Error ? error.message : String(error)})`));
	if (useGenerousGuardrails) {
		// §5.AI: lenient slow-progress guardrails so a slow-but-progressing small model isn't parked prematurely.
		await base.runtime.saveConfig
			.mutate({ swarmGuardrails: BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS })
			.then(() => log("Applied the generous 'background eval' swarm guardrails (turns/wall-time/no-diff)."))
			.catch((error) => log(`(could not set generous guardrails: ${error instanceof Error ? error.message : String(error)})`));
	}

	const lanes: Lane[] = [];
	const cleanup = async () => {
		for (const lane of lanes) {
			try {
				lane.socket.close();
			} catch {}
		}
		await base.runtime.saveNKleinModelMaxConcurrentRequests
			.mutate({ providerId: "lmstudio", modelId: model, baseUrl: ENDPOINT_BASE_URL, maxConcurrentRequests: null })
			.catch(() => undefined);
		await base.runtime.saveNKleinProviderSettings
			.mutate({ providerId: "lmstudio", modelId: original.modelId, baseUrl: original.baseUrl })
			.catch(() => undefined);
		await base.runtime.saveConfig.mutate({ modelRoles: originalModelRoles }).catch(() => undefined);
		if (useGenerousGuardrails) {
			await base.runtime.saveConfig.mutate({ swarmGuardrails: originalGuardrails }).catch(() => undefined);
		}
		// TRASH EVERY CARD FIRST. `projects.remove` takes the project out of the index; it does not stop the
		// SESSIONS driving its cards. Live 2026-09-09: project 41 was still working — 2 completed, 6 in review —
		// for twenty minutes after the rail exited and the batch driver had already filed it as failed and moved
		// on. Those turns compete with the next project for a strictly-serial endpoint, and worse, the driver
		// captures the queue slice ABOVE ITS MARK, so an abandoned project's traffic lands inside the next
		// project's recording. Trashing is the sanctioned stop: the board-liveness watchdog sweeps a trashed
		// card's session and its `::review` reservation on the next tick (P0.TRASHSTOP / P0.TRASHREVIEW).
		for (const lane of lanes) {
			try {
				const state = (await lane.ws.workspace.getState.query()) as {
					board?: { columns?: { id?: string; cards?: unknown[] }[] };
				};
				const columns = state.board?.columns ?? [];
				const trash = columns.find((column) => column.id === "trash");
				let moved = 0;
				const abandonedTaskIds: string[] = [];
				if (trash) {
					for (const column of columns) {
						if (column.id === "trash" || !column.cards?.length) continue;
						moved += column.cards.length;
						abandonedTaskIds.push(...column.cards.map((card) => card.id));
						trash.cards = [...(trash.cards ?? []), ...column.cards];
						column.cards = [];
					}
					if (moved > 0) {
						await lane.ws.workspace.saveState.mutate(state as never);
						log(`  ${lane.label}: trashed ${moved} card(s).`);
					}
				}
				// P1.ZOMBIEBOARD: trashing is not stopping. A card whose session is mid-turn restores itself out of trash,
				// and `projects.remove` below blinds the watchdog that would have stopped it — so RETIRE every session
				// first (ledger entry + stop); only then is the workspace safe to remove.
				let retired = 0;
				for (const taskId of abandonedTaskIds) {
					const result = await lane.ws.runtime.retireTaskSession
						.mutate({ taskId, reason: "terminal_lane_card", detail: `dev-test-rail cleanup: ${lane.label} abandoned` })
						.catch(() => null);
					if (result?.ok) retired += 1;
				}
				if (abandonedTaskIds.length > 0) {
					log(`  ${lane.label}: retired ${retired}/${abandonedTaskIds.length} session(s) before removing the workspace.`);
				}
			} catch (error) {
				log(`  ${lane.label}: could not trash cards before removal (${error instanceof Error ? error.message : String(error)})`);
			}
		}
		for (const lane of lanes) {
			for (let attempt = 0; attempt < 4; attempt += 1) {
				await base.projects.remove.mutate({ projectId: lane.workspaceId }).catch(() => undefined);
				const stillThere = (await base.projects.list.query().catch(() => ({ projects: [] }))).projects.some(
					(project) => project.id === lane.workspaceId,
				);
				if (!stillThere) break;
				await new Promise((resolve) => setTimeout(resolve, 800));
			}
		}
	};

	try {
		// ── Create + subscribe + start each project. ──
		for (const preset of presets) {
			const isBuiltinPreset = (BUILTIN_PRESETS as readonly string[]).includes(preset);
			const created = await base.projects.createDevTestProject
				.mutate(isBuiltinPreset ? { preset } : { registryId: preset })
				.catch((error) => ({ ok: false, error: String(error) }) as const);
			if (!("ok" in created) || !created.ok || !("project" in created) || !created.project || !created.task) {
				log(`✗ ${preset}: createDevTestProject failed (${(created as { error?: string }).error ?? "unknown"}) — skipping`);
				continue;
			}
			const workspaceId = created.project.id;
			const seedTaskId = created.task.id;
			const ws = createTRPCProxyClient<RuntimeAppRouter>({
				links: [httpBatchLink({ url: TRPC_URL, headers: () => ({ "x-nklein-workspace-id": workspaceId }) })],
			});
			const lane: Lane = {
				label: preset,
				preset,
				workspaceId,
				seedTaskId,
				ws,
				socket: new WebSocket(`${URL_BASE.replace(/^http/, "ws")}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceId)}`),
				messages: [],
				startedOk: false,
				startError: null,
				sessionStates: new Map(),
				terminalState: null,
				cardCount: 0,
				workingCardCount: 0,
				frames: 0,
			};
			lane.socket.addEventListener("message", (event) => {
				lane.frames += 1;
				try {
					const frame = JSON.parse(String(event.data)) as {
						type?: string;
						taskId?: string;
						message?: { role?: string; content?: string; meta?: { toolName?: string | null } };
					};
					if (frame.type === "task_chat_message" && frame.taskId) {
						const message = frame.message ?? {};
						lane.messages.push({
							taskId: frame.taskId,
							role: message.role ?? "?",
							toolName: message.meta?.toolName ?? null,
							content: message.content ?? "",
							at: Date.now(),
						});
					}
				} catch {}
			});
			await new Promise<void>((resolve) => {
				lane.socket.addEventListener("open", () => resolve());
				lane.socket.addEventListener("error", () => resolve());
			});
			lanes.push(lane);

			const scenario = resolveNKleinDevTestProjectScenario(preset);
			const started = await ws.runtime.startTaskSession
				.mutate({ taskId: seedTaskId, prompt: scenario.prompt, taskTitle: scenario.title, baseRef: "main", agentId: "nklein", startInPlanMode: false })
				.catch((error) => ({ ok: false, error: String(error) }) as const);
			lane.startedOk = "ok" in started ? started.ok : false;
			lane.startError = "error" in started ? (started.error ?? null) : null;
			log(`▶ ${preset}: project=${workspaceId.slice(0, 8)} seed=${seedTaskId.slice(0, 8)} start=${lane.startedOk ? "ok" : `FAILED(${lane.startError})`}`);
		}

		if (lanes.length === 0) {
			throw new Error("No dev-test projects could be created — nothing to run.");
		}

		// ── Live watch loop: render every project's task flow until all terminal or deadline. ──
		log(`\nWatching ${lanes.length} projects (deadline ${(maxWaitMs / 60000).toFixed(0)} min)…\n`);
		const deadline = Date.now() + maxWaitMs;
		let stallState = { ...EMPTY_DRIVE_STALL_STATE, unchangedSince: Date.now() };
		let wedgeState = { ...EMPTY_DRIVE_STALL_STATE, unchangedSince: Date.now() };
		let stalledFor: number | null = null;
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 7000));
			let allTerminal = true;
			const rows: string[] = [];
			for (const lane of lanes) {
				// The board arrives as COLUMNS, not a flat card list. The old `board.cards` read was always
				// undefined, so `cardCount` silently stayed 0 for every run — and the evidence report's
				// `decomposed: … || lane.cardCount > 1` fallback could therefore never fire.
				const state = (await lane.ws.workspace.getState.query().catch(() => null)) as {
					board?: { columns?: { id?: string; cards?: unknown[] }[] };
					sessions?: Record<string, { state?: string }>;
				} | null;
				const columns = state?.board?.columns;
				if (columns) {
					lane.cardCount = columns.reduce((total, column) => total + (column.cards?.length ?? 0), 0);
					lane.workingCardCount = columns
						.filter((column) => WORKING_LANES.has(column.id ?? ""))
						.reduce((total, column) => total + (column.cards?.length ?? 0), 0);
				}
				for (const [taskId, session] of Object.entries(state?.sessions ?? {})) {
					if (session.state) lane.sessionStates.set(taskId, session.state);
				}
				const seed = lane.sessionStates.get(lane.seedTaskId);
				if (seed && TERMINAL_STATES.has(seed) && lane.terminalState === null) lane.terminalState = seed;
				const running = [...lane.sessionStates.values()].filter((s) => s === "running").length;
				const reviewing = [...lane.sessionStates.values()].filter((s) => s === "awaiting_review").length;
				const lastTool = [...lane.messages].reverse().find((message) => message.toolName)?.toolName ?? "—";
				const seedDone = seed && TERMINAL_STATES.has(seed);
				// DONE = the board has cards and none of them is in a working lane. That is the whole condition.
				//
				// It used to ALSO require the seed session to reach a terminal state, and that cost project 39 a
				// fully-shipped drive on 2026-09-09: all 7 cards completed, `tests/manifest.json` with every mutant
				// killed and `complete:true`, `npm test` 20/20 green — board `{completed: 7}`, nothing open — and the
				// rail kept waiting because the decompose card's session never reported a terminal state after it
				// finished. Forty-five minutes later the stall watchdog fired and the project was recorded as
				// "the model seat stopped answering". A settled board is the fact; the seed's session state is a
				// proxy for it that can be missing, and a proxy that can veto the fact is worse than no proxy.
				//
				// `cardCount > 0` keeps the early moments honest: before the seed has produced anything there are no
				// cards, and zero working cards must not read as "done".
				const boardSettled = lane.cardCount > 0 && lane.workingCardCount === 0;
				if (!boardSettled) allTerminal = false;
				rows.push(
					`  ${lane.label.padEnd(14)} cards=${String(lane.cardCount).padStart(2)} ` +
						`working=${String(lane.workingCardCount).padStart(2)} ` +
						`seed=${(seed ?? "starting").padEnd(14)}${seedDone ? "" : "*"} running=${running} review=${reviewing} ` +
						`msgs=${String(lane.messages.length).padStart(4)} last_tool=${lastTool}`,
				);
			}
			log(`[${new Date().toLocaleTimeString()}] task flow:`);
			for (const row of rows) log(row);
			log();
			if (allTerminal) {
				log("Every project's board settled: seed terminal and no card left in a working lane.\n");
				break;
			}
			/**
			 * A WEDGED board — cards that should be moving, with nothing driving them.
			 *
			 * Distinct from the stall below, and detectable far sooner. The 45-minute stall threshold is high on
			 * purpose: a 15-minute one once re-queued six projects as "stalled" while the model seat was answering
			 * steadily. But that false-alarm case always had a LIVE SESSION — a slow seat still shows `running` or
			 * `awaiting_review`. A wedge shows neither, indefinitely.
			 *
			 * Live 2026-09-10, twice in one afternoon. Project 41's `kill-result-ordering` tripped the turn-loop
			 * guard and was parked, leaving it held in Review with capture unsettled; project 50's decompose card
			 * was parked by `RepeatedToolCallGuard` after three identical rejected `decompose_project` calls. Both
			 * boards then had cards sitting in working lanes with no session at all, issued not one further
			 * request, and burned the full 45 minutes before the stall watchdog would say anything — 41 was
			 * discarded 4 of 7 cards done.
			 *
			 * Same remedy as a stall (exit 3 → the run re-queues the project once), reached sooner and on a fact
			 * that cannot be confused with slowness.
			 */
			const anyLiveSession = lanes.some((lane) =>
				[...lane.sessionStates.values()].some((state) => state === "running" || state === "awaiting_review"),
			);
			const anyCardInWorkingLane = lanes.some((lane) => lane.workingCardCount > 0);
			wedgeState = observeDriveProgress(
				anyCardInWorkingLane && !anyLiveSession ? wedgeState : { ...EMPTY_DRIVE_STALL_STATE, unchangedSince: Date.now() },
				{ at: Date.now(), fingerprint: "wedged" },
				wedgeMs,
			).state;
			if (anyCardInWorkingLane && !anyLiveSession && Date.now() - wedgeState.unchangedSince >= wedgeMs) {
				stalledFor = Date.now() - wedgeState.unchangedSince;
				stalled = true;
				log(
					`⚠️  WEDGED: card(s) sitting in a working lane with NO live session for ` +
						`${(stalledFor / 60000).toFixed(1)} min (--wedge-ms ${wedgeMs}). A guard has parked the card and ` +
						`nothing will restart it — stopping now rather than burning the stall deadline.\n`,
				);
				break;
			}

			// Nothing about the drive changed this tick — not a card, not a session state, not a message. Repeated
			// past `stallMs` that is a dead model seat, and waiting out the rest of the deadline only delays the news.
			const progress = observeDriveProgress(
				stallState,
				{ at: Date.now(), fingerprint: fingerprintDriveLanes(lanes) },
				stallMs,
			);
			stallState = progress.state;
			if (progress.stalled) {
				stalledFor = progress.silentMs;
				stalled = true;
				log(
					`⚠️  STALLED: no card, session-state or message change for ${(progress.silentMs / 60000).toFixed(1)} min ` +
						`(--stall-ms ${stallMs}). The model endpoint is not answering — stopping instead of waiting out the deadline.\n`,
				);
				break;
			}
		}

		// ── Evidence report (success AND failure) — the harvest that feeds todo.md. Built ONCE as structured data,
		//    then both printed (human view) and persisted as JSON (the analyzable foundation for §5.AI auto-collect). ──
		const verdictLabels: Record<RailLaneEvidence["verdict"], string> = {
			delivered: "✅ delivered (awaiting_review)",
			failed_to_start: "❌ FAILED TO START",
			failed: "❌ failed",
			non_terminal: "⚠️ non-terminal in window",
		};
		const laneEvidence = lanes.map(buildLaneEvidence);
		const report: RailEvidenceReport = {
			schemaVersion: 1,
			at: new Date().toISOString(),
			model,
			maxWaitMs,
			...(stalledFor === null ? {} : { stalledForMs: stalledFor }),
			concurrency,
			projectCount: laneEvidence.length,
			delivered: laneEvidence.filter((evidence) => evidence.verdict === "delivered").length,
			anomalyProjects: laneEvidence.filter((evidence) => evidence.narrationLeaks > 0).length,
			lanes: laneEvidence,
		};
		log("════════════════════ DEV-TEST RAIL EVIDENCE ════════════════════");
		for (const evidence of laneEvidence) {
			log("");
			log(`■ ${evidence.label}  →  ${verdictLabels[evidence.verdict]}`);
			log(`    start: ${evidence.startedOk ? "ok" : `FAILED(${evidence.startError})`}   cards: ${evidence.cards}   decomposed: ${evidence.decomposed ? "yes" : "no"}   WS frames: ${evidence.wsFrames}`);
			log(`    session states: ${JSON.stringify(Object.fromEntries(Object.entries(evidence.sessionStates).map(([id, state]) => [id.slice(0, 8), state])))}`);
			log(`    tool calls (${evidence.totalToolCalls}): ${Object.entries(evidence.toolCalls).map(([name, count]) => `${name}×${count}`).join(", ") || "(none)"}`);
			log(`    anomalies: narration-leaks=${evidence.narrationLeaks}${evidence.narrationLeaks ? " ⚠️" : ""}  hot-repeats=${evidence.hotRepeats}${evidence.hotRepeats ? " ⚠️" : ""}`);
		}
		log("");
		log(`SUMMARY: ${report.delivered}/${report.projectCount} delivered to review · ${report.anomalyProjects} project(s) with narration anomalies · model ${model}`);
		if (stalledFor !== null) {
			log(`STALLED: the drive showed no movement for ${(stalledFor / 60000).toFixed(1)} min — treat these lanes as UNJUDGED, not as failures of the model's work.`);
		}
		try {
			const evidenceDir = resolveRailEvidenceDir();
			mkdirSync(evidenceDir, { recursive: true });
			const evidencePath = join(evidenceDir, `rail-${report.at.replace(/[:.]/g, "-")}.json`);
			writeFileSync(evidencePath, JSON.stringify(report, null, 2), "utf8");
			log(`Evidence report (structured JSON) written: ${evidencePath}`);
		} catch (error) {
			log(`(could not persist evidence JSON: ${error instanceof Error ? error.message : String(error)})`);
		}
		log("(Anomalies / non-terminal / failed-to-start cases are the evidence to fold into todo.md as §5.O/§5.AI items.)");
	} finally {
		log("\nrestoring model + concurrency + removing throwaway projects…");
		await cleanup();
		log("done.");
	}
	// Exit 3 = STALLED, and it is deliberately not 0. A stalled drive produced whatever traffic it managed before
	// the model seat went quiet, and a caller that reads exit 0 will happily record that stub as if it were a
	// drive — which is exactly what happened to projects 39 and 40 on 2026-09-08, twice each. "Not judged" needs
	// its own signal; 0 means the board settled and 2 stays a real error.
	process.exit(stalled ? 3 : 0);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
