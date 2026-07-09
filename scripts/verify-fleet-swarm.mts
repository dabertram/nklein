/**
 * FLEET SWARM e2e — drive a complex dev-test project across the HETEROGENEOUS local fleet.
 *
 * This verifier opts into explicit primary role pins so the "configured model was observed" assertions are meaningful:
 *   architect (decompose)  = a pinned strong LARGE model (default the m5max 27b)
 *   worker   (implement)   = a pinned fast coder primary + configured pool members for guardrail/advisor coverage
 *   reviewer               = a pinned mid model unless NKLEIN_FLEET_REVIEWER=auto|none|empty
 * Product defaults stay auto-selection; this script is the mixed pinned/auto regression. It then OBSERVES which model each
 * card actually ran on and whether each card DELIVERED a result branch — so we learn not just "did the cascade finish"
 * but "did the requested role pins hold while unpinned roles still auto-select".
 *
 * The project workspace is PRESERVED (path printed) so the produced code can be inspected.
 *
 * Run:  HOME=/tmp/nklein-fleet tsx scripts/verify-fleet-swarm.mts
 *   env: NKLEIN_FLEET_ARCHITECT (default gptoss120-m5), NKLEIN_FLEET_WORKER (default coder-gpu),
 *        NKLEIN_FLEET_WORKER_POOL (comma list, default "qwen9-m4,v3-cpu"; set empty to disable),
 *        NKLEIN_FLEET_REVIEWER (default qwen9-m4; auto|none|empty leaves reviewer unconfigured),
 *        NKLEIN_VERIFY_PRESET (default complex_dag), NKLEIN_VERIFY_TIMEOUT_MS (default 2_700_000 = 45 min),
 *        NKLEIN_FLEET_MAX_CONCURRENT (default 3), NKLEIN_VERIFY_BASE_URL (default http://127.0.0.1:1234/v1),
 *        NKLEIN_FLEET_PER_MACHINE_MAX_CONCURRENCY (default 1; raise only with measured capacity evidence),
 *        NKLEIN_VERIFY_MODEL_IDLE_STALL_MS (default 90s), NKLEIN_VERIFY_MODEL_ACTIVE_STALL_MS (default 10min).
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultLmsRunner, fetchLmsPsModels, type LmsPsModel } from "../src/core/lms-ps-json";
import {
	evaluateFleetReviewerObservation,
	extractFleetReviewSessionModelObservation,
	hasModelUsage,
	isAutoReviewerSetting,
	isPromptReviewSessionId,
} from "../src/core/fleet-review-observation";
import {
	evaluateQuietRunningSessionStall,
	evaluateWorkspaceSessionProgress,
	isWorkspaceSessionAliveForVerifier,
} from "../src/core/lms-session-stall";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";
import { extractPersistedPromptSessionModel } from "../src/core/persisted-prompt-session-models";
import { resolvePowerAwareTimeoutMs } from "../src/core/power-aware-timeout";
import type { BackendUnderTest } from "../test/contract/helpers/index.js";
import { connectRuntimeStream, initGitRepository, requestJson, startTsBackend } from "../test/contract/helpers/index.js";

const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const PROVIDER_ID = "lmstudio";
const ARCHITECT = process.env.NKLEIN_FLEET_ARCHITECT?.trim() || "gptoss120-m5";
const WORKER = process.env.NKLEIN_FLEET_WORKER?.trim() || "coder-gpu";
const WORKER_POOL = (process.env.NKLEIN_FLEET_WORKER_POOL === undefined
	? "qwen9-m4,v3-cpu"
	: process.env.NKLEIN_FLEET_WORKER_POOL)
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const REVIEWER = process.env.NKLEIN_FLEET_REVIEWER === undefined ? "qwen9-m4" : process.env.NKLEIN_FLEET_REVIEWER.trim();
const REVIEWER_AUTO = isAutoReviewerSetting(REVIEWER);
const PRESET = process.env.NKLEIN_VERIFY_PRESET?.trim() || "complex_dag";
const BASE_TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "2700000");
const MAX_CONCURRENT = Number(process.env.NKLEIN_FLEET_MAX_CONCURRENT ?? "3");
const PER_MACHINE_MAX_CONCURRENCY = positiveIntegerEnv(process.env.NKLEIN_FLEET_PER_MACHINE_MAX_CONCURRENCY, 1);
const RPC_REQUEST_TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_RPC_TIMEOUT_MS ?? "30000");

const TERMINAL_COLUMN_IDS = new Set(["review", "completed", "done"]);
const ACTIVE_COLUMN_IDS = new Set(["backlog", "planning", "in_progress", "in-progress"]);

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

function positiveIntegerEnv(value: string | undefined, fallback: number): number {
	if (!value?.trim()) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return Math.floor(parsed);
}

interface BoardCard {
	id?: string;
	state?: string;
}
interface BoardColumn {
	id?: string;
	cards?: BoardCard[];
}
interface BoardState {
	board?: { columns?: BoardColumn[] };
	/** Every session summary incl. SYNTHETIC ::review/::merge/::spec ones (invisible on the WS card stream). */
	sessions?: Record<
		string,
		{
			state?: string;
			reviewReason?: string | null;
			modelId?: string | null;
			lastHookAt?: number | null;
			lastOutputAt?: number | null;
			updatedAt?: number;
		}
	>;
}

function summarizeColumns(columns: BoardColumn[]): { summary: string; total: number; active: number; terminal: number } {
	let total = 0;
	let active = 0;
	let terminal = 0;
	const parts: string[] = [];
	for (const col of columns) {
		const count = col.cards?.length ?? 0;
		total += count;
		const id = col.id ?? "?";
		if (count > 0) {
			parts.push(`${id}:${count}`);
		}
		if (ACTIVE_COLUMN_IDS.has(id)) {
			active += count;
		} else if (TERMINAL_COLUMN_IDS.has(id)) {
			terminal += count;
		}
	}
	return { summary: parts.join("  ") || "(empty)", total, active, terminal };
}

/** Best-effort recursive find of files whose path contains a needle. */
function findFiles(root: string, needle: string, out: string[] = [], depth = 0): string[] {
	if (depth > 8) return out;
	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(root, entry);
		let st: ReturnType<typeof statSync>;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			findFiles(full, needle, out, depth + 1);
		} else if (full.includes(needle)) {
			out.push(full);
		}
	}
	return out;
}

/** Read the agent-attempt ledger (per-card model + outcome), tallying model usage. Best-effort. */
function reportLedger(homeDir: string): Set<string> {
	const files = findFiles(homeDir, "agent-attempt-ledger").filter((f) => f.endsWith(".jsonl") || f.endsWith(".log"));
	const byModel = new Map<string, { total: number; outcomes: Map<string, number> }>();
	const seenModels = new Set<string>();
	let rows = 0;
	for (const file of files) {
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			try {
				const ev = JSON.parse(line) as Record<string, unknown>;
				const model = String(ev.modelId ?? ev.model ?? ev.modelKey ?? "?");
				const outcome = String(ev.outcome ?? ev.result ?? ev.kind ?? ev.type ?? "?");
				seenModels.add(model);
				const rec = byModel.get(model) ?? { total: 0, outcomes: new Map() };
				rec.total += 1;
				rec.outcomes.set(outcome, (rec.outcomes.get(outcome) ?? 0) + 1);
				byModel.set(model, rec);
				rows += 1;
			} catch {
				/* ignore malformed */
			}
		}
	}
	log(`=== Agent-attempt ledger: ${rows} events across ${byModel.size} model(s) (fleet distribution) ===`);
	for (const [model, rec] of byModel) {
		const outcomes = [...rec.outcomes.entries()].map(([o, n]) => `${o}:${n}`).join(" ");
		log(`   ${model}  events=${rec.total}  [${outcomes}]`);
	}
	if (rows === 0) {
		log("   (no ledger events found — model-per-card distribution unavailable)");
	}
	return seenModels;
}

interface PersistedPromptSessionReport {
	seenModels: Set<string>;
	reviewModels: Set<string>;
}

function reportPersistedPromptSessions(homeDir: string): PersistedPromptSessionReport {
	const files = findFiles(homeDir, "data/sessions").filter((file) => file.endsWith(".json") && !file.endsWith(".messages.json"));
	const byModel = new Map<string, number>();
	const reviewByModel = new Map<string, number>();
	const seenModels = new Set<string>();
	const reviewModels = new Set<string>();
	let rows = 0;
	for (const file of files) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(file, "utf8"));
		} catch {
			continue;
		}
		const observation = extractPersistedPromptSessionModel(parsed);
		if (!observation) {
			continue;
		}
		rows += 1;
		seenModels.add(observation.modelId);
		byModel.set(observation.modelId, (byModel.get(observation.modelId) ?? 0) + 1);
		if (isPromptReviewSessionId(observation.sessionId)) {
			reviewModels.add(observation.modelId);
			reviewByModel.set(observation.modelId, (reviewByModel.get(observation.modelId) ?? 0) + 1);
		}
	}
	log(
		`=== Persisted prompt sessions: ${rows} session record(s), ${[...reviewByModel.values()].reduce((a, b) => a + b, 0)} review session(s), across ${byModel.size} model(s) ===`,
	);
	for (const [model, count] of byModel) {
		log(`   ${model}  sessions=${count}  reviewSessions=${reviewByModel.get(model) ?? 0}`);
	}
	if (rows === 0) {
		log("   (no persisted prompt-session model records found)");
	}
	return { seenModels, reviewModels };
}

interface ReviewSessionTelemetryReport {
	seenModels: Set<string>;
	reviewModels: Set<string>;
}

function reportReviewSessionTelemetry(homeDir: string): ReviewSessionTelemetryReport {
	const files = findFiles(homeDir, ".nklein/nklein/telemetry").filter((file) => file.endsWith(".jsonl"));
	const seenModels = new Set<string>();
	const reviewModels = new Set<string>();
	const byModel = new Map<string, { total: number; outcomes: Map<string, number> }>();
	let rows = 0;
	for (const file of files) {
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}
			const observation = extractFleetReviewSessionModelObservation(parsed);
			if (!observation) {
				continue;
			}
			rows += 1;
			seenModels.add(observation.modelId);
			reviewModels.add(observation.modelId);
			const rec = byModel.get(observation.modelId) ?? { total: 0, outcomes: new Map() };
			rec.total += 1;
			rec.outcomes.set(observation.outcome, (rec.outcomes.get(observation.outcome) ?? 0) + 1);
			byModel.set(observation.modelId, rec);
		}
	}
	log(`=== Durable review-session telemetry: ${rows} settled review turn(s) across ${byModel.size} model(s) ===`);
	for (const [model, rec] of byModel) {
		const outcomes = [...rec.outcomes.entries()].map(([outcome, count]) => `${outcome}:${count}`).join(" ");
		log(`   ${model}  reviewTurns=${rec.total}  [${outcomes}]`);
	}
	if (rows === 0) {
		log("   (no durable second-opinion review-session telemetry found)");
	}
	return { seenModels, reviewModels };
}

/** List task result branches (`nklein/tasks/*`) in the project workspace = the DELIVERABLES. */
function reportDeliverables(workspacePath: string): void {
	log(`=== Deliverables in workspace ${workspacePath} ===`);
	try {
		const refs = execFileSync(
			"git",
			["for-each-ref", "--format=%(refname:short) %(objectname:short) %(contents:subject)", "refs/heads/nklein/tasks"],
			{ cwd: workspacePath, encoding: "utf8" },
		).trim();
		if (refs) {
			log("   Result branches (delivered work):");
			for (const line of refs.split("\n")) {
				log(`     ${line}`);
				const branchName = line.split(/\s+/u)[0] ?? "";
				if (!branchName) {
					continue;
				}
				const changedFiles = execFileSync("git", ["show", "--name-only", "--format=", branchName], {
					cwd: workspacePath,
					encoding: "utf8",
				})
					.split("\n")
					.map((entry) => entry.trim())
					.filter(Boolean);
				const treeFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", branchName], {
					cwd: workspacePath,
					encoding: "utf8",
				})
					.split("\n")
					.map((entry) => entry.trim())
					.filter(Boolean);
				log(
					`       changed files: ${
						changedFiles.length > 0 ? changedFiles.slice(0, 20).join(", ") : "(empty patch)"
					}`,
				);
				log(
					`       branch tree sample: ${
						treeFiles.length > 0 ? treeFiles.slice(0, 20).join(", ") : "(empty tree)"
					}`,
				);
			}
		} else {
			log("   NO result branches — no card captured a deliverable (nklein/tasks/* absent).");
		}
		const status = execFileSync("git", ["status", "--short"], { cwd: workspacePath, encoding: "utf8" }).trim();
		log(
			status
				? `   Host checkout has uncommitted files:\n${status.split("\n").map((line) => `     ${line}`).join("\n")}`
				: "   Host checkout is clean; captured work is on result branches until delivery merges it.",
		);
		const branches = execFileSync("git", ["branch", "-a"], { cwd: workspacePath, encoding: "utf8" }).trim();
		log(`   All branches:\n${branches.split("\n").map((b) => `     ${b.trim()}`).join("\n")}`);
	} catch (error) {
		log(`   (git inspection failed: ${error instanceof Error ? error.message : String(error)})`);
	}
}

async function main(): Promise<void> {
	const cwd = mkdtempSync(join(tmpdir(), "nklein-fleet-cwd-"));
	const homeDir = mkdtempSync(join(tmpdir(), "nklein-fleet-home-"));
	initGitRepository(cwd);

	// Refuse any non-resident fleet model up front (never load — user directive).
	for (const model of [ARCHITECT, WORKER, ...WORKER_POOL, ...(REVIEWER_AUTO ? [] : [REVIEWER])]) {
		await assertModelLoaded(BASE_URL, model);
	}

	const power = await resolvePowerAwareTimeoutMs(BASE_TIMEOUT_MS);
	const TIMEOUT_MS = power.timeoutMs;
	const lmsRunner = createDefaultLmsRunner();

	let server: BackendUnderTest | null = null;
	let stream: Awaited<ReturnType<typeof connectRuntimeStream>> | null = null;
	const latestActivityByTask = new Map<string, { state: string; activity: string }>();
	const seenRuntimeModels = new Set<string>();
	let lastProgressAt = Date.now();
	let workspacePath: string | null = null;
	// WATCH MODE (user directive 2026-07-02): the live-board link is READ-ONLY for browsers. The harness holds a
	// per-run mutation token — its own orchestration calls attach it (requestJson reads this env), while UI
	// mutations without it are rejected 403, so an observer can't disturb the sweep (e.g. change a model role).
	process.env.NKLEIN_WATCH_MODE_MUTATION_TOKEN = randomUUID();
	try {
		server = await startTsBackend({
			cwd,
			homeDir,
			// Fleet-spread env: tell LM-Link machines (all on one :1234 endpoint) apart by machineId, and let free-first
			// use real `lms ps` busy state so worker cards spread across machines instead of piling on one model. The default
			// machine cap is deliberately conservative because `lms ps` reports parallel=1 on the current three-host fleet.
			extraEnv: {
				NODE_ENV: "development",
				NKLEIN_PER_MACHINE_MAX_CONCURRENCY: String(PER_MACHINE_MAX_CONCURRENCY),
				NKLEIN_QUEUE_AWARE_FREE_FIRST: "1",
				NKLEIN_WATCH_MODE_MUTATION_TOKEN: process.env.NKLEIN_WATCH_MODE_MUTATION_TOKEN,
			},
			onLog: (chunk, source) => {
				if (/auto-start|could not|skipped|rootTask|queued|decompos|begin_implementation|routing|selection|model=|→|review|delivery|acceptance|diverse|lineage|re-driving|deferred|held/i.test(chunk)) {
					for (const line of chunk.split("\n")) {
						if (line.trim()) {
							log(`   [server:${source}] ${line.trim().slice(0, 240)}`);
						}
					}
				}
			},
		});
		log(
			`Server: ${server.baseUrl}\n` +
				`  FLEET  architect=${ARCHITECT}  worker=${WORKER} (+pool ${WORKER_POOL.join(",") || "none"})  reviewer=${REVIEWER_AUTO ? "auto" : REVIEWER}\n` +
				`  preset=${PRESET}  maxConcurrent=${MAX_CONCURRENT}  perMachineCap=${PER_MACHINE_MAX_CONCURRENCY}  timeout=${TIMEOUT_MS}ms (power=${power.mode}×${power.multiplier})  rpcTimeout=${RPC_REQUEST_TIMEOUT_MS}ms`,
		);

		// Global selected provider = the WORKER model (cascade cards with no per-card provider default to it; a fast coder).
		const provRes = await requestJson<{ ok?: boolean; error?: string }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinProviderSettings",
			type: "mutation",
			payload: { providerId: PROVIDER_ID, modelId: WORKER, baseUrl: BASE_URL },
			timeoutMs: RPC_REQUEST_TIMEOUT_MS,
		});
		log(`saveNKleinProviderSettings(worker=${WORKER}): ok=${provRes.payload.ok ?? "?"}`);

		// Heterogeneous pinned roles: this regression needs explicit pins because configured role models are auto candidates
		// by default. If auto would choose differently, runtime telemetry should report a recommendation without overriding.
		const cfgRes = await requestJson({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveConfig",
			type: "mutation",
			payload: {
				maxConcurrentTasks: MAX_CONCURRENT,
				modelRoles: {
					architect: { providerId: PROVIDER_ID, modelId: ARCHITECT, modelSelectionMode: "pinned" },
					worker: {
						providerId: PROVIDER_ID,
						modelId: WORKER,
						modelSelectionMode: "pinned",
						additionalModels: WORKER_POOL.map((modelId) => ({ providerId: PROVIDER_ID, modelId })),
					},
					// REVIEWER=auto|none|empty leaves the reviewer role UNCONFIGURED — exercising the W2.5a lineage-diverse
					// reviewer AUTO-PICK (previously the silent worker-reviews-itself fallback).
					...(REVIEWER_AUTO
						? {}
						: { reviewer: { providerId: PROVIDER_ID, modelId: REVIEWER, modelSelectionMode: "pinned" } }),
				},
			},
			timeoutMs: RPC_REQUEST_TIMEOUT_MS,
		});
		log(`saveConfig(fleet roles + maxConcurrent=${MAX_CONCURRENT}): HTTP ${cfgRes.status}`);

		const createRes = await requestJson<{
			ok: boolean;
			project: { id: string } | null;
			workspacePath: string | null;
			task: {
				id: string;
				prompt: string;
				title?: string;
				filesLikelyTouched?: string[];
				startInPlanMode?: boolean;
				baseRef?: string;
				agentId?: string;
				nkleinSettings?: unknown;
			} | null;
			error?: string;
		}>({
			baseUrl: server.baseUrl,
			procedure: "projects.createDevTestProject",
			type: "mutation",
			payload: { preset: PRESET },
			timeoutMs: RPC_REQUEST_TIMEOUT_MS,
		});
		if (!createRes.payload.ok || !createRes.payload.project || !createRes.payload.task) {
			throw new Error(`createDevTestProject failed (HTTP ${createRes.status}): ${JSON.stringify(createRes.payload)}`);
		}
		const workspaceId = createRes.payload.project.id;
		workspacePath = createRes.payload.workspacePath;
		const task = createRes.payload.task;
		log(`Project workspace: ${workspaceId}\n  path: ${workspacePath}\n  seed (decompose) card: ${task.id}`);
		// The spawned backend serves the built web UI (src/server/assets.ts), so the LIVE project board is
		// browsable for the whole run — the link is re-printed on every board change so it is always at hand.
		const boardUrl = `${server.baseUrl}/${encodeURIComponent(workspaceId)}`;
		log(`\n  ┌─ LIVE BOARD (read-only watch mode) ───────────────────────\n  │  ${boardUrl}\n  └─ (open in a browser any time; mutations are disabled; dies when this harness exits)\n`);

		const startRes = await requestJson<{ ok?: boolean; error?: string; errorCode?: string; selectionReason?: string }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.startTaskSession",
			type: "mutation",
			workspaceId,
			payload: {
				taskId: task.id,
				prompt: task.prompt,
				taskTitle: task.title,
				filesLikelyTouched: task.filesLikelyTouched,
				startInPlanMode: task.startInPlanMode,
				baseRef: task.baseRef ?? "HEAD",
				agentId: task.agentId,
				nkleinSettings: task.nkleinSettings,
			},
			timeoutMs: RPC_REQUEST_TIMEOUT_MS,
		});
		log(
			`startTaskSession(seed): HTTP ${startRes.status} ok=${startRes.payload?.ok ?? "?"}` +
				`${startRes.payload?.error ? ` ERROR[${startRes.payload.errorCode ?? "?"}]=${startRes.payload.error}` : ""}` +
				`${startRes.payload?.selectionReason ? ` | ${startRes.payload.selectionReason}` : ""}`,
		);

		stream = await connectRuntimeStream(
			`ws://${new URL(server.baseUrl).host}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceId)}`,
		);
		stream.socket.on("message", (raw: unknown) => {
			try {
				const msg = JSON.parse(String(raw)) as {
					type?: string;
					summaries?: Array<{
						taskId?: string;
						id?: string;
						state?: string;
						modelId?: string;
						latestHookActivity?: { toolName?: string; activityText?: string } | null;
					}>;
				};
				if (msg.type !== "task_sessions_updated") return;
				for (const session of msg.summaries ?? []) {
					const id = session.taskId ?? session.id;
					if (!id) continue;
					const act = session.latestHookActivity;
					const newActivity = `${session.modelId ? `[${session.modelId}] ` : ""}${act?.toolName ?? act?.activityText ?? "—"}`;
					if (session.modelId) {
						seenRuntimeModels.add(session.modelId);
					}
					const newState = session.state ?? "?";
					const prev = latestActivityByTask.get(id);
					latestActivityByTask.set(id, { state: newState, activity: newActivity });
					if (id !== task.id && (!prev || prev.activity !== newActivity || prev.state !== newState)) {
						log(`   [WS ${new Date().toISOString().slice(11, 19)}] ${id} state=${newState} act="${newActivity}"`);
						lastProgressAt = Date.now();
					}
				}
			} catch {
				/* ignore malformed */
			}
		});

		const deadline = Date.now() + TIMEOUT_MS;
		const stallMs = Math.round(Number(process.env.NKLEIN_VERIFY_STALL_MS ?? "420000") * power.multiplier);
		// FAST dead-stall (user 2026-07-02 "detect stalls earlier"): when NO session is alive (running/queued/
		// starting) the long stall window is pointless — nothing can make progress. A short window catches a dead
		// swarm in ~1.5min instead of 7min.
		const deadStallMs = Math.round(Number(process.env.NKLEIN_VERIFY_DEAD_STALL_MS ?? "90000") * power.multiplier);
		// RUNNING sessions need a model-aware lane: a long prefill/generation can be quiet, but "running" alone must
		// never waive stalls forever. `lms ps --json` distinguishes IDLE from active PROCESSINGPROMPT/GENERATING.
		const modelIdleStallMs = Math.round(
			Number(process.env.NKLEIN_VERIFY_MODEL_IDLE_STALL_MS ?? "90000") * power.multiplier,
		);
		const modelActiveStallMs = Math.round(
			Number(process.env.NKLEIN_VERIFY_MODEL_ACTIVE_STALL_MS ?? "600000") * power.multiplier,
		);
		const lmsProbeMs = Math.max(5_000, Number(process.env.NKLEIN_VERIFY_LMS_PROBE_MS ?? "30000"));
		const lmsProbeStartMs = Math.min(30_000, modelIdleStallMs, modelActiveStallMs);
		// awaiting_review is alive only for capture/finalization reasons (run23 false-positive: exit/hook handoffs were
		// mid host-side finalize/capture/review with no model activity). Operator-attention/error/interrupted
		// awaiting_review states are not live work and must not suppress the dead-stall lane.
		let stalled = false;
		let lastSummary = "";
		let decomposed = false;
		let allTerminal = false;
		let consecutivePollErrors = 0;
		const MAX_CONSECUTIVE_POLL_ERRORS = 6;
		// #36 (run36 false dead-stall): synthetic sessions (::review/::merge/::spec) never appear on the WS card
		// stream, so a live 10-minute reviewer looked like total silence and the dead-stall lane killed the run
		// mid-review. Track observable progress across ALL polled sessions. `updatedAt` is deliberately ignored here:
		// live evidence showed heartbeat/bookkeeping stamps can advance while the model is quiet, masking stalls.
		let lastSeenSessionActivityStamp = 0;
		let lastSessionStateById = new Map<string, string>();
		let lastLmsProbeAt = 0;
		let latestLmsPsModels: LmsPsModel[] = [];
		let lastLoggedLmsSummary = "";
		while (Date.now() < deadline) {
			try {
				const stateRes = await requestJson<BoardState>({
					baseUrl: server.baseUrl,
					procedure: "workspace.getState",
					type: "query",
					workspaceId,
					timeoutMs: RPC_REQUEST_TIMEOUT_MS,
				});
				consecutivePollErrors = 0;
				const columns = stateRes.payload.board?.columns ?? [];
				const { summary, total, active, terminal } = summarizeColumns(columns);
				if (summary !== lastSummary) {
					log(
						`[${new Date().toISOString().slice(11, 19)}] ${summary}  (total=${total} active=${active} terminal=${terminal})  board: ${boardUrl}`,
					);
					lastSummary = summary;
					lastProgressAt = Date.now();
				}
				if (total > 1) decomposed = true;
				if (decomposed && active === 0 && terminal > 0) {
					allTerminal = true;
					break;
				}
				const polledSessions = Object.entries(stateRes.payload.sessions ?? {});
				for (const [, session] of polledSessions) {
					if (session.modelId) {
						seenRuntimeModels.add(session.modelId);
					}
				}
				const anyPolledSessionAlive = polledSessions.some(([, s]) => isWorkspaceSessionAliveForVerifier(s));
				const sessionProgress = evaluateWorkspaceSessionProgress({
					sessions: polledSessions.map(([id, s]) => ({
						id,
						state: s.state,
						lastHookAt: s.lastHookAt,
						lastOutputAt: s.lastOutputAt,
						updatedAt: s.updatedAt,
					})),
					previousStatesBySessionId: lastSessionStateById,
					previousActivityStamp: lastSeenSessionActivityStamp,
				});
				lastSessionStateById = sessionProgress.statesBySessionId;
				if (sessionProgress.progressed) {
					lastSeenSessionActivityStamp = sessionProgress.activityStamp;
					lastProgressAt = Date.now();
				}
				const now = Date.now();
				const runningSessions = polledSessions
					.filter(([, s]) => s.state === "running")
					.map(([id, s]) => ({ id, modelId: s.modelId ?? null }));
				const quietMs = now - lastProgressAt;
				if (runningSessions.length > 0 && quietMs >= lmsProbeStartMs) {
					if (now - lastLmsProbeAt >= lmsProbeMs) {
						latestLmsPsModels = await fetchLmsPsModels(lmsRunner);
						lastLmsProbeAt = Date.now();
					}
					if (lastLmsProbeAt > 0) {
						const verdict = evaluateQuietRunningSessionStall({
							runningSessions,
							lmsModels: latestLmsPsModels,
							quietMs,
							idleStallMs: modelIdleStallMs,
							activeStallMs: modelActiveStallMs,
						});
						if (verdict.action === "abort") {
							stalled = true;
							log(
								`[${new Date().toISOString().slice(11, 19)}] MODEL-STALLED — ${verdict.reason}; lms ps: ${verdict.lmsSummary}; aborting.`,
							);
							break;
						}
						if (quietMs >= modelIdleStallMs && verdict.lmsSummary !== lastLoggedLmsSummary) {
							lastLoggedLmsSummary = verdict.lmsSummary;
							log(
								`[${new Date().toISOString().slice(11, 19)}] MODEL-WAIT — quiet running session(s) for ${Math.round(quietMs / 1000)}s; lms ps: ${verdict.lmsSummary}`,
							);
						}
					}
				}
				// The polled workspace state is canonical for liveness. Stale WS card summaries can outlive their backing
				// sessions (observed live: WS still implied work while `sessions` was `{}` and all models were IDLE), so they
				// are for diagnostics only and must not keep the dead-stall lane open.
				const anySessionAlive = anyPolledSessionAlive;
				const hasObservedWorkToWaitFor = latestActivityByTask.size > 0 || active > 0;
				if (!anySessionAlive && hasObservedWorkToWaitFor && Date.now() - lastProgressAt > deadStallMs) {
					stalled = true;
					log(
						`[${new Date().toISOString().slice(11, 19)}] DEAD-STALLED — every session is idle/terminal and no progress for ${Math.round(deadStallMs / 1000)}s; aborting early.`,
					);
					break;
				}
				if (runningSessions.length === 0 && Date.now() - lastProgressAt > stallMs) {
					stalled = true;
					log(`[${new Date().toISOString().slice(11, 19)}] STALLED — no progress for ${Math.round(stallMs / 1000)}s; aborting.`);
					break;
				}
			} catch (error) {
				consecutivePollErrors += 1;
				const detail = error instanceof Error ? error.message : String(error);
				log(`   [poll WARN ${consecutivePollErrors}/${MAX_CONSECUTIVE_POLL_ERRORS}] ${detail}`);
				if (consecutivePollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
					log("   [poll] server unreachable — aborting observation.");
					break;
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}

		log("");
		log(`=== Live agent activity per card (WS, ${latestActivityByTask.size} sessions) ===`);
		for (const [id, info] of latestActivityByTask) {
			log(`   ${id}  state=${info.state}  activity="${info.activity}"`);
		}
		log("");
		const seenLedgerModels = reportLedger(homeDir);
		const persistedPromptSessions = reportPersistedPromptSessions(homeDir);
		const reviewSessionTelemetry = reportReviewSessionTelemetry(homeDir);
		const reviewSessionModels = new Set([
			...persistedPromptSessions.reviewModels,
			...reviewSessionTelemetry.reviewModels,
		]);
		const seenModels = new Set([
			...seenRuntimeModels,
			...seenLedgerModels,
			...persistedPromptSessions.seenModels,
			...reviewSessionTelemetry.seenModels,
		]);
		log("");
		if (workspacePath) reportDeliverables(workspacePath);

		log("");
		log("=== Fleet swarm result ===");
		const architectSeen = hasModelUsage(seenModels, ARCHITECT);
		const workerSeen = hasModelUsage(seenModels, WORKER);
		const reviewerObservation = evaluateFleetReviewerObservation({
			configuredReviewer: REVIEWER,
			reviewSessionModels,
			workerModel: WORKER,
		});
		const reviewerSeen = reviewerObservation.observed;
		const fleetUsageOk = architectSeen && workerSeen && reviewerSeen;
		log(`Decomposed into multiple cards: ${decomposed ? "YES" : "NO"}`);
		log(`All cards reached a terminal lane: ${allTerminal ? "YES" : "NO"}`);
		log(`Configured architect model observed: ${architectSeen ? "YES" : "NO"} (${ARCHITECT})`);
		log(`Configured worker model observed: ${workerSeen ? "YES" : "NO"} (${WORKER})`);
		log(
			reviewerObservation.mode === "auto"
				? `Auto reviewer observed: ${reviewerSeen ? "YES" : "NO"} (${reviewerObservation.observedModels.join(",") || "none"}) — ${reviewerObservation.reason}`
				: `Configured reviewer model observed: ${reviewerSeen ? "YES" : "NO"} (${REVIEWER}) — ${reviewerObservation.reason}`,
		);
		log(`Fleet role usage gate: ${fleetUsageOk ? "PASS" : "FAIL"}`);
		log(
			`SWEEP-ROW | ${new Date().toISOString()} | fleet ${PRESET} | architect=${ARCHITECT} worker=${WORKER} | ` +
				`reviewer=${REVIEWER_AUTO ? "auto" : REVIEWER} | decompose=${decomposed ? "YES" : "NO"} | fleetUsage=${fleetUsageOk ? "YES" : "NO"} | result=${allTerminal && fleetUsageOk ? "PASS ✓" : stalled ? "STALLED 🧱" : "INCOMPLETE ⏳"} | ` +
				`power=${power.mode}×${power.multiplier}`,
		);
		log(`Workspace PRESERVED for inspection: ${workspacePath}`);
		log(`Home (ledger) PRESERVED: ${homeDir}`);
		process.exitCode = allTerminal && fleetUsageOk ? 0 : 1;
	} finally {
		await stream?.close().catch(() => null);
		await server?.stop().catch(() => null);
		// NB: deliberately DO NOT delete workspacePath / homeDir — they hold the produced code + ledger for inspection.
	}
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
