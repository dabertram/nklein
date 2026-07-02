/**
 * FLEET SWARM e2e — drive a complex dev-test project across the HETEROGENEOUS local fleet.
 *
 * Unlike verify-multi-card-pipeline.mts (one model pinned to every role), this exercises the REAL fleet:
 *   architect (decompose)  = a strong LARGE model (default the m5max 27b)
 *   worker   (implement)   = a fast coder + a POOL of the other loaded workers (auto free-first fan-out)
 *   reviewer               = a mid model
 * plus the §5.AB auto-selection that already offers every LOADED model as a candidate. It then OBSERVES which
 * model each card actually ran on and whether each card DELIVERED a result branch — so we learn not just
 * "did the cascade finish" but "did something that works come out, and did the fleet actually spread".
 *
 * The project workspace is PRESERVED (path printed) so the produced code can be inspected.
 *
 * Run:  HOME=/tmp/nklein-fleet tsx scripts/verify-fleet-swarm.mts
 *   env: NKLEIN_FLEET_ARCHITECT (default qwopus3.6-27b-v2-mlx), NKLEIN_FLEET_WORKER (default coder-gpu),
 *        NKLEIN_FLEET_WORKER_POOL (comma list, default "qwen9-m4,v3-cpu"), NKLEIN_FLEET_REVIEWER (default qwen9-m4),
 *        NKLEIN_VERIFY_PRESET (default complex_dag), NKLEIN_VERIFY_TIMEOUT_MS (default 2_700_000 = 45 min),
 *        NKLEIN_FLEET_MAX_CONCURRENT (default 3), NKLEIN_VERIFY_BASE_URL (default http://127.0.0.1:1234/v1).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";
import { resolvePowerAwareTimeoutMs } from "../src/core/power-aware-timeout";
import type { BackendUnderTest } from "../test/contract/helpers/index.js";
import { connectRuntimeStream, initGitRepository, requestJson, startTsBackend } from "../test/contract/helpers/index.js";

const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const PROVIDER_ID = "lmstudio";
const ARCHITECT = process.env.NKLEIN_FLEET_ARCHITECT?.trim() || "gptoss120-m5";
const WORKER = process.env.NKLEIN_FLEET_WORKER?.trim() || "coder-gpu";
const WORKER_POOL = (process.env.NKLEIN_FLEET_WORKER_POOL?.trim() || "qwen9-m4,v3-cpu")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const REVIEWER = process.env.NKLEIN_FLEET_REVIEWER?.trim() || "qwen9-m4";
const PRESET = process.env.NKLEIN_VERIFY_PRESET?.trim() || "complex_dag";
const BASE_TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "2700000");
const MAX_CONCURRENT = Number(process.env.NKLEIN_FLEET_MAX_CONCURRENT ?? "3");

const TERMINAL_COLUMN_IDS = new Set(["review", "completed", "done"]);
const ACTIVE_COLUMN_IDS = new Set(["backlog", "planning", "in_progress", "in-progress"]);

function log(line: string): void {
	process.stdout.write(`${line}\n`);
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
function reportLedger(homeDir: string): void {
	const files = findFiles(homeDir, "agent-attempt-ledger").filter((f) => f.endsWith(".jsonl") || f.endsWith(".log"));
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
			try {
				const ev = JSON.parse(line) as Record<string, unknown>;
				const model = String(ev.modelId ?? ev.model ?? ev.modelKey ?? "?");
				const outcome = String(ev.outcome ?? ev.result ?? ev.kind ?? ev.type ?? "?");
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
			}
		} else {
			log("   NO result branches — no card captured a deliverable (nklein/tasks/* absent).");
		}
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
	for (const model of [ARCHITECT, WORKER, ...WORKER_POOL, ...(REVIEWER === "none" ? [] : [REVIEWER])]) {
		await assertModelLoaded(BASE_URL, model);
	}

	const power = await resolvePowerAwareTimeoutMs(BASE_TIMEOUT_MS);
	const TIMEOUT_MS = power.timeoutMs;

	let server: BackendUnderTest | null = null;
	let stream: Awaited<ReturnType<typeof connectRuntimeStream>> | null = null;
	const latestActivityByTask = new Map<string, { state: string; activity: string }>();
	let lastProgressAt = Date.now();
	let workspacePath: string | null = null;
	try {
		server = await startTsBackend({
			cwd,
			homeDir,
			// Fleet-spread env: tell LM-Link machines (all on one :1234 endpoint) apart by machineId, and let free-first
			// use real `lms ps` busy state so worker cards spread across machines instead of piling on one model.
			extraEnv: {
				NODE_ENV: "development",
				NKLEIN_PER_MACHINE_MAX_CONCURRENCY: "2",
				NKLEIN_QUEUE_AWARE_FREE_FIRST: "1",
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
				`  FLEET  architect=${ARCHITECT}  worker=${WORKER} (+pool ${WORKER_POOL.join(",") || "none"})  reviewer=${REVIEWER}\n` +
				`  preset=${PRESET}  maxConcurrent=${MAX_CONCURRENT}  timeout=${TIMEOUT_MS}ms (power=${power.mode}×${power.multiplier})`,
		);

		// Global selected provider = the WORKER model (cascade cards with no per-card provider default to it; a fast coder).
		const provRes = await requestJson<{ ok?: boolean; error?: string }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinProviderSettings",
			type: "mutation",
			payload: { providerId: PROVIDER_ID, modelId: WORKER, baseUrl: BASE_URL },
		});
		log(`saveNKleinProviderSettings(worker=${WORKER}): ok=${provRes.payload.ok ?? "?"}`);

		// Heterogeneous roles: strong architect for decompose, fast coder + pool for workers, mid reviewer.
		const cfgRes = await requestJson({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveConfig",
			type: "mutation",
			payload: {
				maxConcurrentTasks: MAX_CONCURRENT,
				modelRoles: {
					architect: { providerId: PROVIDER_ID, modelId: ARCHITECT },
					worker: {
						providerId: PROVIDER_ID,
						modelId: WORKER,
						additionalModels: WORKER_POOL.map((modelId) => ({ providerId: PROVIDER_ID, modelId })),
					},
					// REVIEWER="none" leaves the reviewer role UNCONFIGURED — exercising the W2.5a lineage-diverse
					// reviewer AUTO-PICK (previously the silent worker-reviews-itself fallback).
					...(REVIEWER === "none" ? {} : { reviewer: { providerId: PROVIDER_ID, modelId: REVIEWER } }),
				},
			},
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
		});
		if (!createRes.payload.ok || !createRes.payload.project || !createRes.payload.task) {
			throw new Error(`createDevTestProject failed (HTTP ${createRes.status}): ${JSON.stringify(createRes.payload)}`);
		}
		const workspaceId = createRes.payload.project.id;
		workspacePath = createRes.payload.workspacePath;
		const task = createRes.payload.task;
		log(`Project workspace: ${workspaceId}\n  path: ${workspacePath}\n  seed (decompose) card: ${task.id}`);

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
		let stalled = false;
		let lastSummary = "";
		let decomposed = false;
		let allTerminal = false;
		let consecutivePollErrors = 0;
		const MAX_CONSECUTIVE_POLL_ERRORS = 6;
		while (Date.now() < deadline) {
			try {
				const stateRes = await requestJson<BoardState>({
					baseUrl: server.baseUrl,
					procedure: "workspace.getState",
					type: "query",
					workspaceId,
				});
				consecutivePollErrors = 0;
				const columns = stateRes.payload.board?.columns ?? [];
				const { summary, total, active, terminal } = summarizeColumns(columns);
				if (summary !== lastSummary) {
					log(`[${new Date().toISOString().slice(11, 19)}] ${summary}  (total=${total} active=${active} terminal=${terminal})`);
					lastSummary = summary;
					lastProgressAt = Date.now();
				}
				if (total > 1) decomposed = true;
				if (decomposed && active === 0 && terminal > 0) {
					allTerminal = true;
					break;
				}
				if (Date.now() - lastProgressAt > stallMs) {
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
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}

		log("");
		log(`=== Live agent activity per card (WS, ${latestActivityByTask.size} sessions) ===`);
		for (const [id, info] of latestActivityByTask) {
			log(`   ${id}  state=${info.state}  activity="${info.activity}"`);
		}
		log("");
		reportLedger(homeDir);
		log("");
		if (workspacePath) reportDeliverables(workspacePath);

		log("");
		log("=== Fleet swarm result ===");
		log(`Decomposed into multiple cards: ${decomposed ? "YES" : "NO"}`);
		log(`All cards reached a terminal lane: ${allTerminal ? "YES" : "NO"}`);
		log(
			`SWEEP-ROW | ${new Date().toISOString()} | fleet ${PRESET} | architect=${ARCHITECT} worker=${WORKER} | ` +
				`decompose=${decomposed ? "YES" : "NO"} | result=${allTerminal ? "PASS ✓" : stalled ? "STALLED 🧱" : "INCOMPLETE ⏳"} | ` +
				`power=${power.mode}×${power.multiplier}`,
		);
		log(`Workspace PRESERVED for inspection: ${workspacePath}`);
		log(`Home (ledger) PRESERVED: ${homeDir}`);
		process.exitCode = allTerminal ? 0 : 1;
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
