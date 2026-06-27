/**
 * §5.AI always-on dev-test evaluation rail DAEMON — the long-running background runner that, when the loaded models are
 * idle (no targeted work), starts sandboxed dev-test eval runs, yields to interactive work, and survives restart via a
 * durable lease checkpoint. It is the thin EFFECTFUL glue over the tested pure cores: `createBackgroundEvalRunner` (the
 * tick/recover brain + admission gate), `computeBackgroundEvalRunnerSignals` (live state → admission signals), and the
 * lease checkpoint store. ALL policy lives in those tested cores; this script only wires TRPC calls + a `setInterval`.
 *
 * Requires a runtime on :3484. **Dry-run by default** (logs the admission decision each tick + simulates run lifetimes,
 * starts NOTHING); `--live` actually creates+starts/removes dev-test runs (verify that in a focused live pass).
 * Run:  tsx scripts/dev-test-rail-daemon.mts                                   # dry-run — watch the admission decisions
 *       tsx scripts/dev-test-rail-daemon.mts --live --max-concurrent 2 --tick-ms 15000
 */
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { BackgroundEvalLease, BackgroundEvalRunner } from "../src/core/background-eval-runner.js";
import { createBackgroundEvalRunner } from "../src/core/background-eval-runner.js";
import { computeBackgroundEvalRunnerSignals } from "../src/core/background-eval-runner-signals.js";
import { resolveNKleinDevTestProjectScenario } from "../src/nklein-agent/nklein-dev-test-project.js";
import {
	loadBackgroundEvalRunnerLeases,
	saveBackgroundEvalRunnerLeases,
} from "../src/state/background-eval-runner-store.js";
import type { RuntimeAppRouter } from "../src/trpc/app-router";

const URL_BASE = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:3484";
const TRPC_URL = `${URL_BASE}/api/trpc`;
const MODELS_URL = process.env.NKLEIN_MODELS_URL?.trim() || "http://127.0.0.1:1234/v1/models";
const PRESETS = ["mid_task", "complex_dag", "audio_vst", "daw_foundation"] as const;
type Preset = Parameters<typeof resolveNKleinDevTestProjectScenario>[0];

function arg(name: string, fallback: string): string {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 && process.argv[index + 1] ? (process.argv[index + 1] as string) : fallback;
}
function log(line = ""): void {
	process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
	const live = process.argv.includes("--live");
	const maxConcurrent = Math.max(0, Number.parseInt(arg("max-concurrent", "1"), 10));
	const tickMs = Math.max(2_000, Number.parseInt(arg("tick-ms", "15000"), 10));
	const simRunMs = Math.max(5_000, Number.parseInt(arg("sim-run-ms", "20000"), 10));
	const runWindowMs = Math.max(60_000, Number.parseInt(arg("run-window-ms", "900000"), 10));
	const base = createTRPCProxyClient<RuntimeAppRouter>({ links: [httpBatchLink({ url: TRPC_URL })] });

	let runner: BackgroundEvalRunner;
	let runCounter = 0;

	const isModelLoaded = async (): Promise<boolean> => {
		try {
			const response = await fetch(MODELS_URL);
			const json = (await response.json()) as { data?: unknown[] };
			return Array.isArray(json.data) && json.data.length > 0;
		} catch {
			return false;
		}
	};

	const deps = {
		maxConcurrentEvals: maxConcurrent,
		now: () => Date.now(),
		getSignals: async () => {
			const [{ projects }, config] = await Promise.all([base.projects.list.query(), base.runtime.getConfig.query()]);
			const counts = projects.map((project) => ({
				workspaceId: project.id,
				runningSessionCount: project.runningSessionCount ?? 0,
			}));
			const ownedWorkspaceIds = new Set(
				runner
					.getLeases()
					.map((lease) => lease.workspaceId)
					.filter((id): id is string => id !== null),
			);
			return computeBackgroundEvalRunnerSignals({
				projects: counts,
				ownedWorkspaceIds,
				modelLoaded: await isModelLoaded(),
				maxConcurrentTasks: config.maxConcurrentTasks ?? 4,
				totalRunningSessions: counts.reduce((sum, project) => sum + project.runningSessionCount, 0),
			});
		},
		selectNextProject: () => PRESETS[Math.floor(Math.random() * PRESETS.length)] ?? null,
		startRun: async (project: string) => {
			runCounter += 1;
			if (!live) {
				log(`    [dry-run] would create+start ${project}`);
				return { runId: `dry-${runCounter}`, workspaceId: `dry-ws-${runCounter}`, deadlineAt: Date.now() + simRunMs };
			}
			const created = await base.projects.createDevTestProject.mutate({ preset: project });
			const workspaceId = created.project.id;
			const seedTaskId = created.task.id;
			const scenario = resolveNKleinDevTestProjectScenario(project as Preset);
			const ws = createTRPCProxyClient<RuntimeAppRouter>({
				links: [httpBatchLink({ url: TRPC_URL, headers: () => ({ "x-nklein-workspace-id": workspaceId }) })],
			});
			await ws.runtime.startTaskSession.mutate({
				taskId: seedTaskId,
				prompt: scenario.prompt,
				taskTitle: scenario.title,
				baseRef: "main",
				agentId: "nklein",
				startInPlanMode: false,
			});
			return { runId: seedTaskId, workspaceId, deadlineAt: Date.now() + runWindowMs };
		},
		stopRun: async (lease: BackgroundEvalLease) => {
			if (!live) {
				log(`    [dry-run] would stop ${lease.project} (${lease.workspaceId})`);
				return;
			}
			if (!lease.workspaceId) {
				return;
			}
			// Removing a project whose agent is still RUNNING can fail the first time, so retry + verify it's gone (the
			// rail's cleanup does the same). Without this, a force-stopped run leaks its throwaway project (verified).
			for (let attempt = 0; attempt < 4; attempt += 1) {
				await base.projects.remove.mutate({ projectId: lease.workspaceId }).catch(() => undefined);
				const stillThere = (await base.projects.list.query().catch(() => ({ projects: [] }))).projects.some(
					(project) => project.id === lease.workspaceId,
				);
				if (!stillThere) {
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 800));
			}
			log(`    (warning: could not remove ${lease.project} workspace ${lease.workspaceId} after retries)`);
		},
		isRunActive: async (lease: BackgroundEvalLease) => {
			if (!live) {
				return Date.now() < lease.deadlineAt; // simulated lifetime
			}
			const { projects } = await base.projects.list.query();
			return projects.some((project) => project.id === lease.workspaceId && (project.runningSessionCount ?? 0) > 0);
		},
		loadCheckpoint: () => loadBackgroundEvalRunnerLeases(),
		saveCheckpoint: (leases: readonly BackgroundEvalLease[]) => saveBackgroundEvalRunnerLeases(leases),
	};

	runner = createBackgroundEvalRunner(deps);
	await runner.recover();
	log(
		`Daemon: ${live ? "LIVE" : "DRY-RUN"} · max-concurrent ${maxConcurrent} · tick ${tickMs}ms · recovered ${runner.getLeases().length} lease(s)`,
	);

	let stopping = false;
	const timer = setInterval(() => {
		if (stopping) {
			return;
		}
		void runner
			.tick()
			.then((outcome) => {
				const parts = [`${outcome.reason}`, `active=${outcome.activeLeases}`];
				if (outcome.reaped.length > 0) {
					parts.push(`reaped=${outcome.reaped.map((lease) => lease.project).join(",")}`);
				}
				if (outcome.admitted) {
					parts.push(`admitted=${outcome.admitted.project}`);
				}
				log(`[${new Date().toISOString().slice(11, 19)}] ${parts.join("  ")}`);
			})
			.catch((error) => log(`tick error: ${error instanceof Error ? error.message : String(error)}`));
	}, tickMs);

	const shutdown = async (): Promise<void> => {
		if (stopping) {
			return;
		}
		stopping = true;
		clearInterval(timer);
		log("\nshutting down…");
		if (live) {
			for (const lease of runner.getLeases()) {
				await deps.stopRun(lease);
			}
		}
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
