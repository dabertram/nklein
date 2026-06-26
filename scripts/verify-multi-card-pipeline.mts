/**
 * §5.V MULTI-CARD PIPELINE e2e — full-runtime, live (qwen3-8b + Docker).
 *
 * Drives the REAL cli.ts server (via startTsBackend) end to end: configure the agent → create a dev-test
 * project (seeds a decompose card) → start that card → then OBSERVE the runtime's own auto-start cascade
 * (autoStartTaskIds / moveStartedQueuedTask) run the generated cards to a terminal lane. This proves the
 * orchestration integrates with the already-proven agent capability (decompose + single-card completion).
 *
 * Unlike the in-memory verify-*.mts harnesses, this exercises the full HTTP + board/lane orchestration.
 *
 * Run:  HOME=/tmp/nklein-verify tsx scripts/verify-multi-card-pipeline.mts
 *   env: NKLEIN_VERIFY_MODEL (default qwen/qwen3-8b-m5max), NKLEIN_VERIFY_PROVIDER (default lmstudio),
 *        NKLEIN_VERIFY_PRESET (default deep_chain), NKLEIN_VERIFY_TIMEOUT_MS (default 1_800_000 = 30 min).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendUnderTest } from "../test/contract/helpers/index.js";
import { initGitRepository, requestJson, startTsBackend } from "../test/contract/helpers/index.js";

const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "qwen/qwen3-8b-m5max";
const PROVIDER_ID = process.env.NKLEIN_VERIFY_PROVIDER?.trim() || "lmstudio";
const PRESET = process.env.NKLEIN_VERIFY_PRESET?.trim() || "mid_task";
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "1800000");

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

async function main(): Promise<void> {
	const cwd = mkdtempSync(join(tmpdir(), "nklein-multicard-cwd-"));
	const homeDir = mkdtempSync(join(tmpdir(), "nklein-multicard-home-"));
	initGitRepository(cwd);

	let server: BackendUnderTest | null = null;
	try {
		server = await startTsBackend({ cwd, homeDir, extraEnv: { NODE_ENV: "development" } });
		log(`Server: ${server.baseUrl}  model: ${MODEL_ID}@${PROVIDER_ID}  preset: ${PRESET}  timeout: ${TIMEOUT_MS}ms`);

		// 1) Configure the agent globally so the cascade's auto-started cards resolve the live model.
		const roleSettings = { providerId: PROVIDER_ID, modelId: MODEL_ID };
		const cfgRes = await requestJson({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveConfig",
			type: "mutation",
			payload: { modelRoles: { architect: roleSettings, worker: roleSettings, reviewer: roleSettings } },
		});
		log(`saveConfig(modelRoles): HTTP ${cfgRes.status}`);

		// 2) Create a dev-test project (seeds the decompose card). Requires NODE_ENV=development (set above).
		const createRes = await requestJson<{
			ok: boolean;
			project: { id: string } | null;
			task: { id: string; prompt: string } | null;
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
		const seedTaskId = createRes.payload.task.id;
		log(`Project workspace: ${workspaceId}   seed (decompose) card: ${seedTaskId}`);

		// 3) Start the decompose seed card → the runtime decomposes, then auto-starts the generated cards.
		const startRes = await requestJson({
			baseUrl: server.baseUrl,
			procedure: "runtime.startTaskSession",
			type: "mutation",
			workspaceId,
			payload: {
				taskId: seedTaskId,
				prompt: createRes.payload.task.prompt,
				baseRef: "HEAD",
				startInPlanMode: true,
			},
		});
		log(`startTaskSession(seed): HTTP ${startRes.status}`);

		// 4) Observe the board: wait until the deck has decomposed (>1 card) AND no card is still active.
		const deadline = Date.now() + TIMEOUT_MS;
		let lastSummary = "";
		let decomposed = false;
		let allTerminal = false;
		while (Date.now() < deadline) {
			const stateRes = await requestJson<BoardState>({
				baseUrl: server.baseUrl,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			const columns = stateRes.payload.board?.columns ?? [];
			const { summary, total, active, terminal } = summarizeColumns(columns);
			if (summary !== lastSummary) {
				log(`[${new Date().toISOString().slice(11, 19)}] ${summary}  (total=${total} active=${active} terminal=${terminal})`);
				lastSummary = summary;
			}
			if (total > 1) {
				decomposed = true;
			}
			if (decomposed && active === 0 && terminal > 0) {
				allTerminal = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}

		log("");
		log("=== Multi-card pipeline result ===");
		log(`Decomposed into multiple cards: ${decomposed ? "YES" : "NO"}`);
		log(`All cards reached a terminal lane (review/completed): ${allTerminal ? "YES" : "NO"}`);
		log(
			allTerminal
				? "PASS ✓ full-runtime multi-card pipeline ran decompose → cascade → all cards terminal."
				: "INCOMPLETE — see board trace above (decompose and/or cascade did not finish within the timeout).",
		);
		process.exitCode = allTerminal ? 0 : 1;
	} finally {
		await server?.stop().catch(() => null);
		rmSync(cwd, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
